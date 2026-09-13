# COBOL CoreBank — Dokumentation

Technische Dokumentation für Entwickler und KI-Assistenten.  
Einstieg auch über das ausführliche Root-**[README.md](../README.md)** (Tech Stack, COBOL, Grafiken).

## Inhaltsverzeichnis

| Dokument | Inhalt |
|---|---|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Gesamtarchitektur, **COBOL-Engine**, PostgreSQL-Schema, Concurrency |
| **[ADMIN.md](ADMIN.md)** | Admin Interface: UI, Live-Telemetrie, Journal-Poll, Worker-Pool |
| **[SIMULATOR.md](SIMULATOR.md)** | Dauerbetrieb (Loop), Mix Betrieb, echte DB-Writes, `startsimmulator.bat` |
| **[API.md](API.md)** | REST-API (Banking, Status, Stress, Simulate inkl. `continuous`) |
| **[OPERATIONS.md](OPERATIONS.md)** | Start/Stop, Build, Docker, Umgebungsvariablen, **Tests** |
| **[CODE_REVIEW.md](CODE_REVIEW.md)** | Review-Findings, behobene Bugs, Demo-Sicherheit |
| **[QUALITY_ASSURANCE.md](QUALITY_ASSURANCE.md)** | Test-/Reviewstand vom 13.09.2026, KI-gestützte Arbeitsweise, belegte Ergebnisse und offene Fälle |

## Schnellstart

| Aktion | Befehl | URL |
|---|---|---|
| Admin Interface | `startadmin.bat` | http://127.0.0.1:3000/ |
| Kunden-Simulator | `startsimmulator.bat` | http://127.0.0.1:3000/simulator/ |
| Stoppen | `stop.bat` | — (Postgres bleibt) |
| Tests | `npm test` | Server für Integration nötig |

Voraussetzung: **Docker Desktop** (PostgreSQL 16) · **GnuCOBOL 3.2** + GixSQL · Node.js.

## Komponenten

```text
  Admin UI / Simulator UI
           │
           ▼
  Node.js :3000  (Worker-Pool, LiveMetrics, CustomerSimulator)
           │  execFile
           ▼
  ★ cobol_bank.exe   GnuCOBOL + GixSQL Embedded SQL
           │  EXEC SQL
           ▼
  PostgreSQL 16 (Docker)
```

## Grafiken

| Datei | Inhalt |
|---|---|
| [assets/tech-stack.svg](assets/tech-stack.svg) | Tech Stack — COBOL im Zentrum |
| [assets/architecture.svg](assets/architecture.svg) | Architektur-Übersicht |
| [assets/admin-preview.svg](assets/admin-preview.svg) | Admin Last-Studio |
| [assets/simulator-preview.svg](assets/simulator-preview.svg) | Simulator Aktivitätsraum |
