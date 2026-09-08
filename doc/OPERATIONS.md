# Betrieb & Operations

## Voraussetzungen

| Komponente | Hinweis |
|---|---|
| Windows 10/11 | Entwickler-Host |
| Docker Desktop | Für PostgreSQL 16 |
| Node.js | Backend (`node backend/server.js`) |
| GnuCOBOL 3.2 | Pfad siehe unten, inkl. GixSQL + `libgixsql-pgsql.dll` + `libpq.dll` |

Standard-GnuCOBOL-Pfad:

`C:\Users\tnickel\AppData\Local\Programs\GnuCOBOL 3.2`

---

## Start-Skripte

| Skript | Wirkung |
|---|---|
| **`startadmin.bat`** | Postgres → Build falls nötig → Backend → Browser **Admin** `/` |
| **`startsimmulator.bat`** | Postgres → Build falls nötig → Backend → Browser **Simulator** `/simulator/` |
| **`stop.bat`** | Beendet Prozess auf Port **3000** (Postgres bleibt) |

Doppelstart-Schutz: Lauscht bereits etwas auf Port 3000, wird kein zweites Backend gestartet.

Lokale Artefakte: Ordner [`data/`](../data/README.md) (Legacy-SQLite-Archiv; Live-DB ist PostgreSQL).

PostgreSQL stoppen:

```cmd
docker compose down
```

---

## Manuelle Schritte

```powershell
# DB
powershell -ExecutionPolicy Bypass -File .\scripts\start_postgres.ps1

# COBOL bauen
powershell -ExecutionPolicy Bypass -File .\scripts\build_cobol.ps1

# Backend
node backend\server.js
```

Beim Start ruft das Backend COBOL `INIT` auf (Schema + Seed, falls leer).

---

## Build-Pipeline (`scripts/build_cobol.ps1`)

1. `gixpp.exe -e -S -i src/cobol/cobol_bank.sqb -o bin/cobol_bank.cbl`
2. `cobc.exe -x -o bin/cobol_bank.exe bin/cobol_bank.cbl -llibgixsql`

Nach Änderungen an `.sqb` immer neu bauen.

---

## PostgreSQL (Docker)

`docker-compose.yml`:

| Setting | Wert |
|---|---|
| Image | `postgres:16-alpine` |
| Container | `cobolbank-postgres` |
| Port | `5432` |
| User / Pass / DB | `cobol` / `cobol` / `cobolbank` |
| Volume | `cobolbank_pgdata` |

COBOL-DSN: `pgsql://127.0.0.1:5432/cobolbank?native_cursors=off`  
Auth: `cobol.cobol`

---

## Umgebungsvariablen

| Variable | Default | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port Backend |
| `BIND_HOST` | `127.0.0.1` | Listen-Adresse (Demo: nur localhost) |
| `TX_CONCURRENCY` | `16` | Max. parallele COBOL-Schreib-Worker |
| `MAX_BODY_BYTES` | `65536` | Max. JSON-Body-Größe |

### Tests

Voraussetzung Integration: Backend läuft (`startadmin.bat` oder `npm start`).

```cmd
npm test                 REM Unit (Mock) + Integration + Admin-Display
npm run test:unit        REM nur CustomerSimulator gegen Mock-Bank
npm run test:integration REM Live-Server: Simulator-Writes + system-status KPIs
```

Die Integration prüft u. a., dass unter Last `queue.active_workers` / `recent_active_workers`, `live.clients_active`, `simulator.stats.write_ok` und das Journal wachsen — also das, was das Admin-UI anzeigt.

Beispiel:

```cmd
set TX_CONCURRENCY=32
node backend\server.js
```

---

## Typische Betriebsabläufe

### Admin beobachten + Last erzeugen

1. `startadmin.bat` — Telemetrie offen lassen  
2. `startsimmulator.bat` (oder Link im Admin) — Szenario starten  
3. Im Admin steigen **Clients**, **Verbindungen**, **TPS**

### Sauberer Neustart nach Codeänderung

```cmd
stop.bat
startadmin.bat
```

Bei COBOL-Änderungen vorher `scripts\build_cobol.ps1` ausführen (oder Binary löschen und Starter neu bauen lassen).

### Datenbank zurücksetzen

```cmd
docker compose down -v
powershell -ExecutionPolicy Bypass -File .\scripts\start_postgres.ps1
```

Anschließend Backend starten → `INIT` legt Schema und Demo-Konten neu an.

---

## Troubleshooting

| Symptom | Ursache / Maßnahme |
|---|---|
| DB connect failed | Docker/Postgres nicht healthy → `start_postgres.ps1` |
| Leere `accounts:[]` trotz Count > 0 | DSN ohne `native_cursors=off` |
| GixSQL-Fehler `:MI` | Kein `TO_CHAR(… HH24:MI …)` — `CAST` nutzen |
| Transfer-SQL kaputt | Kein `FOR UPDATE` in Embedded SQL |
| Simulator 409 | Bereits laufende Simulation → Stop oder warten |
| Viele Transfer-Fehler unter Last | Salden / Kontenknappheit — kleiner Betrag oder Mix mit Deposits |
| Port 3000 belegt | `stop.bat` oder PID per `netstat` prüfen |
| Von anderem PC nicht erreichbar | Default `BIND_HOST=127.0.0.1` — nur lokal; bewusst ohne Auth |
