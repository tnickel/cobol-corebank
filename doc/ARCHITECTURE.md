# COBOL CoreBank — Systemarchitektur

> Für KI-Assistenten und Entwickler: Zweck, Schichten, Dateien, Datenmodell und Nebenläufigkeit.

---

## 1. Zweck

Referenz-**Core-Banking**-Anwendung im Mainframe-Stil (COBOL + Embedded SQL), angebunden an:

- **PostgreSQL 16** (echter Parallelbetrieb / MVCC)
- **Node.js-API-Bridge** (Prozess-Spawn der COBOL-Engine)
- **Admin Interface** (Betriebssteuerung + Live-Telemetrie)
- **Kunden-Simulator** (N parallele simulierte Bankkunden)

Domäne: Giro-/Spar-/Geschäftskonten, Überweisungen, Bareinzahlungen, Zinslauf-Batch.

---

## 2. Schichtenmodell

```text
┌─────────────────────────────────────────────────────────────────┐
│  Admin UI (/)              Kunden-Simulator (/simulator/)       │
│  frontend/index.html       frontend/simulator/                  │
│  Live: Clients, TCP, TPS   N Clients, Mix, Start/Stop           │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP / JSON
┌───────────────────────────────▼─────────────────────────────────┐
│  backend/server.js  (Port 3000)                                 │
│  · BankTransactionQueue (parallele COBOL-Worker)                │
│  · LiveMetrics (Client-IPs / sim:N, Verbindungen, TPS)          │
│  · CustomerSimulator (HTTP-Loopback mit X-Sim-Client-Id)        │
└───────────────────────────────┬─────────────────────────────────┘
                                │ CLI + JSON stdout
┌───────────────────────────────▼─────────────────────────────────┐
│  bin/cobol_bank.exe  ← src/cobol/cobol_bank.sqb                 │
│  GnuCOBOL 3.2 + GixSQL (libgixsql-pgsql.dll, libpq.dll)         │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Embedded SQL
┌───────────────────────────────▼─────────────────────────────────┐
│  PostgreSQL 16 (Docker Compose)                                 │
│  DB cobolbank · User/Pass cobol/cobol · Port 5432               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Dateistruktur

```text
cobol/
├── startadmin.bat                 # Postgres + Backend + Admin UI
├── startsimmulator.bat            # Postgres + Backend + Simulator UI
├── startsimulator.bat             # Alias → startsimmulator.bat
├── start.bat                      # Alias → startadmin.bat
├── stop.bat                       # Node auf Port 3000 beenden
├── docker-compose.yml             # postgres:16-alpine
├── package.json
│
├── bin/
│   ├── cobol_bank.exe             # Kompilierte Engine
│   └── cobol_bank.cbl             # GixSQL-Ausgabe
│
├── src/cobol/
│   └── cobol_bank.sqb             # COBOL + EXEC SQL (Quelle)
│
├── backend/
│   ├── server.js                  # HTTP-API, Queue, Metrics, Static
│   └── simulator.js               # CustomerSimulator-Klasse
│
├── frontend/
│   ├── index.html / css/ / js/    # Admin Interface
│   └── simulator/                 # Simulator UI
│       ├── index.html
│       ├── css/simulator.css
│       └── js/simulator.js
│
├── scripts/
│   ├── build_cobol.ps1            # gixpp + cobc
│   └── start_postgres.ps1         # docker compose + Healthcheck
│
└── doc/                           # Diese Dokumentation
    ├── README.md
    ├── ARCHITECTURE.md
    ├── ADMIN.md
    ├── SIMULATOR.md
    ├── API.md
    └── OPERATIONS.md
```

---

## 4. COBOL Engine (`cobol_bank.sqb`)

| Eigenschaft | Wert |
|---|---|
| Programm-ID | `COBOLBANK` |
| Format | Fixed (Spalten 8–72) |
| DSN | `pgsql://127.0.0.1:5432/cobolbank?native_cursors=off` |
| Auth | `cobol.cobol` (GixSQL: `username.password`) |
| Precompiler | GixSQL `gixpp -e -S` |
| Compiler | `cobc -x … -llibgixsql` |

### CLI-Aktionen

| Action | Parameter | Wirkung |
|---|---|---|
| `INIT` | — | DDL + Seed (4 Demo-Konten) |
| `LIST_ACCOUNTS` | — | JSON Konten + Summen |
| `LIST_TRANSACTIONS` | — | JSON Journal |
| `CREATE_ACCOUNT` | IBAN, Name, Typ, Saldo, Zins | Neues Konto |
| `TRANSFER` | From, To, Betrag, Text | Atomare Überweisung |
| `DEPOSIT` | To, Betrag, Text | Bareinzahlung |
| `CALC_INTEREST` | — | Zinsgutschrift Sparkonten |

### GixSQL-Fallen (kritisch)

1. Host-Variablen nur in `DECLARE SECTION`, **ohne Bindestriche** in SQL-Namen.
2. Keine SQL-Keywords als Variablen (`DESC` → `TXNOTE`).
3. `TRIM(:HOSTVAR)` in WHERE-Klauseln (COBOL space-padded).
4. **`native_cursors=off`** in der DSN — sonst leere Cursor-Ergebnisse unter PostgreSQL.
5. **`FOR UPDATE` nicht verwenden** — GixSQL erzeugt ungültiges SQL (`… TRIM($1) UPDATE`). Stattdessen: `UPDATE … SET balance = balance ± :amt [AND balance >= :amt]`.
6. Timestamps: `CAST(created_at AS VARCHAR(25))` (kein `TO_CHAR` mit `HH24:MI` — `:MI` wird als Host-Variable gelesen).
7. JSON nur über `DISPLAY … NO ADVANCING`.

### Paragraphs

- `MAIN-LOGIC` — Connect, `EVALUATE` Action, Disconnect
- `DO-INIT-DB` — `SERIAL`-Tabellen, Seed
- `DO-LIST-ACCOUNTS` / `DO-LIST-TRANSACTIONS` — Cursor + JSON
- `DO-CREATE-ACCOUNT` — Unique-Check, Insert, optional Ersteinlage
- `DO-TRANSFER` — `BEGIN WORK`, Validierung, atomare Debit/Credit-Updates, `COMMIT`/`ROLLBACK`
- `DO-DEPOSIT` — Gutschrift + Journal
- `DO-CALC-INTEREST` — Batch über verzinste Konten

---

## 5. PostgreSQL-Schema

### `accounts`

| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | `SERIAL` PK | Fortlaufende ID |
| `account_no` | `VARCHAR(34)` UNIQUE | IBAN |
| `holder_name` | `VARCHAR(60)` | Kontoinhaber |
| `account_type` | `VARCHAR(20)` | `GIRO`, `SPARKONTO`, `BUSINESS` |
| `balance` | `NUMERIC(12,2)` | Saldo EUR |
| `currency` | `VARCHAR(5)` | Default `EUR` |
| `interest_rate` | `NUMERIC(5,2)` | Zinssatz p.a. % |
| `status` | `VARCHAR(15)` | z. B. `ACTIVE` |
| `created_at` | `TIMESTAMP` | Default `CURRENT_TIMESTAMP` |

### `transactions`

| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | `SERIAL` PK | Buchungsreferenz |
| `from_account` | `VARCHAR(34)` | Absender / `SYSTEM_INIT` / `BAR_EINZAHLUNG` / `ZINSLAUF` |
| `to_account` | `VARCHAR(34)` | Empfänger |
| `amount` | `NUMERIC(12,2)` | Betrag |
| `tx_type` | `VARCHAR(20)` | `TRANSFER`, `DEPOSIT`, `INTEREST`, … |
| `description` | `VARCHAR(100)` | Verwendungszweck |
| `status` | `VARCHAR(15)` | Default `SUCCESS` |
| `created_at` | `TIMESTAMP` | Buchungszeit |

Docker: Service `postgres`, Container `cobolbank-postgres`, Volume `cobolbank_pgdata`.

---

## 6. Backend-Concurrency

### Worker-Pool (`BankTransactionQueue`)

- Default-Concurrency: **`TX_CONCURRENCY=16`** (env).
- Schreibende API-Calls laufen über den Pool; Lesen (`LIST_*`) parallel ungequeued.
- Retry (max. 3) bei Deadlock / Serialize / Lock-Timeout.

### LiveMetrics

Siehe [ADMIN.md](ADMIN.md). Clients werden an `remoteAddress` bzw. Header `X-Sim-Client-Id` (`sim:N`) erkannt.

### CustomerSimulator

Siehe [SIMULATOR.md](SIMULATOR.md). Startet N parallele HTTP-Clients gegen dieselbe API (Loopback), damit Admin-Telemetrie echte Last sieht.

---

## 7. Frontend-Oberflächen

| Pfad | Rolle | Doku |
|---|---|---|
| `/` | Admin Interface | [ADMIN.md](ADMIN.md) |
| `/simulator/` | Kunden-Simulator | [SIMULATOR.md](SIMULATOR.md) |

Beide nutzen Vanilla HTML/CSS/JS und das gemeinsame Design-Token-System in `frontend/css/style.css`.

---

## 8. Weiterführend

- API-Verträge: [API.md](API.md)
- Betrieb (Start, Build, Env): [OPERATIONS.md](OPERATIONS.md)
