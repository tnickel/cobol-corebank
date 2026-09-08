# COBOL CoreBank — Dokumentation

Technische Dokumentation für Entwickler und KI-Assistenten. Einstieg hier; Details in den verlinkten Dateien.

## Inhaltsverzeichnis

| Dokument | Inhalt |
|---|---|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Gesamtarchitektur, Dateien, COBOL-Engine, PostgreSQL-Schema, Concurrency |
| **[ADMIN.md](ADMIN.md)** | Admin Interface: UI, Live-Telemetrie, Bedienung |
| **[SIMULATOR.md](SIMULATOR.md)** | Kunden-Simulator: Konfiguration, Ablauf, API, Start mit `startsimmulator.bat` |
| **[API.md](API.md)** | REST-API-Referenz (Banking, Status, Stress-Test, Simulate) |
| **[OPERATIONS.md](OPERATIONS.md)** | Start/Stop, Build, Docker/PostgreSQL, Umgebungsvariablen |

## Schnellstart

| Aktion | Befehl | URL |
|---|---|---|
| Admin Interface | `startadmin.bat` | http://localhost:3000/ |
| Kunden-Simulator | `startsimmulator.bat` | http://localhost:3000/simulator/ |
| Stoppen | `stop.bat` | — (Postgres-Container bleibt) |

Voraussetzung: **Docker Desktop** (PostgreSQL 16).

## Komponenten auf einen Blick

```text
  startadmin.bat ──────────────► Admin UI (/)
  startsimmulator.bat ─────────► Simulator UI (/simulator/)
              │
              ▼
     Node.js Backend :3000
       ├── Worker-Pool (TX_CONCURRENCY=16)
       ├── LiveMetrics (Clients / TCP / TPS)
       └── CustomerSimulator (N HTTP-Loopback-Clients)
              │
              ▼
     cobol_bank.exe  ◄── GnuCOBOL + GixSQL (pgsql)
              │
              ▼
     PostgreSQL 16  (Docker: cobolbank-postgres)
```

Verwandte Einstiegsdateien im Repo-Root: [../README.md](../README.md), [../docker-compose.yml](../docker-compose.yml).
