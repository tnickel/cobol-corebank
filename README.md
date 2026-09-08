# COBOL CoreBank (GnuCOBOL + PostgreSQL + Web-Dashboard)

Enterprise Core Banking System mit **GnuCOBOL 3.2**, **GixSQL Embedded SQL**, **PostgreSQL 16**, **Admin Interface** und **Kunden-Simulator**.

Ausführliche Dokumentation: **[doc/README.md](doc/README.md)** (Architektur, Admin, Simulator, API, Betrieb).

---

## 1. Schnellstart

Voraussetzung: **Docker Desktop** (für PostgreSQL).

### System starten (Admin Interface):
Doppelklick auf `startadmin.bat` oder im Terminal:
```cmd
startadmin.bat
```
- Startet PostgreSQL per Docker Compose (`localhost:5432`, DB `cobolbank`, User/Pass `cobol`/`cobol`).
- Prüft automatisch, ob das COBOL-Binary (`bin/cobol_bank.exe`) existiert (baut es bei Bedarf nach).
- Prüft per Port-Scan (Port 3000), ob das Backend bereits läuft, um **Doppelstarts zu verhindern**.
- Startet bei Bedarf das Backend im Hintergrund (Schema-INIT via COBOL).
- Öffnet das **Admin Interface** automatisch: **http://localhost:3000**

### Kunden-Simulator:
```cmd
startsimmulator.bat
```
Öffnet **http://localhost:3000/simulator/** — konfigurierbare N parallele Kunden (Überweisungen, Einzahlungen, Reads).

(`start.bat` ist ein Alias auf `startadmin.bat`.)

### System beenden:
```cmd
stop.bat
```
- Beendet den Node.js-Prozess auf Port 3000.
- PostgreSQL-Container bleibt laufen (`docker compose down` zum Stoppen der DB).

---

## 2. Architektur & Komponenten

```
┌─────────────────────────────────────────────────────────┐
│                     Admin Interface                         │
│    (HTML5 / Dark Glassmorphic CSS / Vanilla JS)             │
│    Kontenverwaltung, Audit-Journal, Lasttests, Inspector    │
└────────────────────────────┬────────────────────────────┘
                             │ HTTP / JSON API
┌────────────────────────────▼────────────────────────────┐
│   Node.js API-Bridge (Port 3000, 16 parallele Worker)   │
│    - Spawnt COBOL-Prozesse parallel                     │
│    - Deadlock-Retry bei Row-Lock-Konflikten             │
└────────────────────────────┬────────────────────────────┘
                             │ CLI Arguments & JSON Stdio
┌────────────────────────────▼────────────────────────────┐
│           COBOL Core Banking Engine (Native EXE)        │
│    - Atomare balance = balance ± amount Updates (ACID)          │
└────────────────────────────┬────────────────────────────┘
                             │ Embedded SQL (libgixsql-pgsql)
┌────────────────────────────▼────────────────────────────┐
│              PostgreSQL 16 (Docker Compose)             │
│    - MVCC, Row-Level Locks, echte Parallelität          │
│    - Tabellen: accounts, transactions                   │
└─────────────────────────────────────────────────────────┘
```

---

## 3. COBOL Core Engine (`cobol_bank.exe`)

| Aktion | Befehl | Beschreibung |
|---|---|---|
| **INIT** | `.\bin\cobol_bank.exe INIT` | Erstellt Tabellen und Demo-Daten |
| **LIST_ACCOUNTS** | `.\bin\cobol_bank.exe LIST_ACCOUNTS` | Konten + Summen als JSON |
| **LIST_TRANSACTIONS** | `.\bin\cobol_bank.exe LIST_TRANSACTIONS` | Transaktionshistorie als JSON |
| **TRANSFER** | `.\bin\cobol_bank.exe TRANSFER DE1001 DE1002 150.00 "Miete"` | Atomare Überweisung |
| **DEPOSIT** | `.\bin\cobol_bank.exe DEPOSIT DE1001 500.00 "Einzahlung"` | Bareinzahlung |
| **CALC_INTEREST** | `.\bin\cobol_bank.exe CALC_INTEREST` | Monatliche Zinsen für Sparkonten |

Verbindung: `pgsql://127.0.0.1:5432/cobolbank` / Auth `cobol.cobol` (GixSQL-Format `user.password`).

---

## 4. Kompilierung & Build

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build_cobol.ps1
```

Nur DB starten:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_postgres.ps1
```

---

## 5. Umgebung & Werkzeuge
- **GnuCOBOL 3.2+** inkl. `libgixsql-pgsql.dll` und `libpq.dll`
- **GixSQL 1.0.20b**: Precompiler & Runtime für Embedded SQL
- **PostgreSQL 16** (Docker Image `postgres:16-alpine`)
- Parallelität konfigurierbar: `TX_CONCURRENCY=16` (Default)
