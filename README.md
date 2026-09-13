<div align="center">

# COBOL CoreBank

### Lauffähiges lokales Showcase — **echte COBOL-Geschäftslogik** mit moderner Weboberfläche

**GnuCOBOL 3.2** · **GixSQL Embedded SQL** · **PostgreSQL 16** · **Node.js Bridge** · **Admin UI** · **Kunden-Simulator**

[![License: MIT](https://img.shields.io/badge/License-MIT-22d3ee.svg)](LICENSE)
[![GnuCOBOL](https://img.shields.io/badge/Engine-GnuCOBOL%203.2-34d399.svg)](https://gnucobol.sourceforge.io/)
[![GixSQL](https://img.shields.io/badge/SQL-GixSQL%20Embedded-06b6d4.svg)](https://github.com/mridoni/gixsql)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Node.js](https://img.shields.io/badge/Bridge-Node.js-339933.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0ea5e9.svg)](#schnellstart)

[Dokumentation](doc/README.md) · [Architektur](doc/ARCHITECTURE.md) · [Qualität & Teststand](doc/QUALITY_ASSURANCE.md) · [Admin](doc/ADMIN.md) · [Simulator](doc/SIMULATOR.md) · [API](doc/API.md) · [Projektbericht](https://tnickel-ki.de/blogs/blog-cobol-corebank.html)

<br/>

<img src="doc/assets/tech-stack.svg" alt="Tech Stack — COBOL im Zentrum" width="900" />

</div>

---

## Warum dieses Projekt?

Viele Banken betreiben jahrzehntealte **COBOL-Cores**. Dieses Repo zeigt praxisnah:

1. **Geschäftslogik bleibt COBOL** — Konten, Überweisungen, Einzahlungen, Zinslauf, Journal  
2. **Datenbank ist modern** — PostgreSQL 16 mit MVCC statt Single-Writer-SQLite  
3. **Betrieb ist beobachtbar** — Admin mit Live-Last, Worker-Pool, Journal; Simulator im Dauerbetrieb  

Kein Mock der Banklogik: `cobol_bank.exe` ist kompiliertes **GnuCOBOL** mit **Embedded SQL (GixSQL)**.

Das Projekt ist eine lokale Arbeitsprobe für das Zusammenspiel von Fachlogik, Datenhaltung und Webschnittstelle. Es zeigt, wie sich ein COBOL-Kern nachvollziehbar anbinden und sein Verhalten unter simulierter Last untersuchen lässt. Der fachliche Kontext ist bewusst vereinfacht: keine produktive Banksoftware und kein Nachweis für eine bestimmte Fachdomäne. Übertragbar sind die Arbeit an bestehenden Strukturen, klare Schnittstellen, dokumentierte Fehleranalyse und überprüfbare Änderungen.

**Prüfstand 13.09.2026:** 5 Simulator-Unit-Tests bestanden; die erneute Ausführung der vollständigen Anwendung war ohne gestarteten Docker-Dienst und Backend nicht möglich. Bekannte Grenzen und die genaue Reichweite der Tests stehen im [Qualitätsbericht](doc/QUALITY_ASSURANCE.md).

---

## Tech Stack (Hervorhebung COBOL)

| Schicht | Technologie | Rolle |
|---|---|---|
| **★ Engine** | **GnuCOBOL 3.2** + **GixSQL** | Banking-Logik in `src/cobol/cobol_bank.sqb` — `EXEC SQL`, Transaktionssteuerung, JSON über STDOUT |
| Datenbank | **PostgreSQL 16** (Docker) | Persistenz, parallele Transaktionen (MVCC) |
| Bridge | **Node.js** (ohne schweres Framework) | Spawn COBOL-Prozesse, Worker-Pool (`TX_CONCURRENCY`), REST, LiveMetrics, Simulator |
| UI | Vanilla **HTML / CSS / JS** | Admin Interface + Kunden-Simulator (Canvas-Visualisierungen) |
| Build / Ops | `gixpp` → `cobc`, Docker Compose, `.bat`-Starter | Windows-Demo-Setup |

### Was COBOL konkret macht

| Paragraph / Action | Bedeutung |
|---|---|
| `INIT` | Schema (`accounts`, `transactions`) + Seed-Konten |
| `LIST_ACCOUNTS` / `LIST_TRANSACTIONS` | Cursor + JSON für Admin/API |
| `TRANSFER` | Debit/Credit-Updates in einer DB-Transaktion + Summenvergleich + Journal; Nebenläufigkeitsgrenzen siehe Qualitätsbericht |
| `DEPOSIT` | Gutschrift + Journal |
| `CALC_INTEREST` | Batch-Verzinsung (`balance = balance + Zins`) |
| `CREATE_ACCOUNT` | Kontoanlage mit SQLCODE-Prüfung |

Quelle: [`src/cobol/cobol_bank.sqb`](src/cobol/cobol_bank.sqb) → [Build-Skript](scripts/build_cobol.ps1) → lokales `bin/cobol_bank.exe` (Build-Artefakte sind nicht im Git-Repository).

Geldbeträge sind im COBOL-Quellcode als dezimale Felder wie `PIC S9(9)V99` definiert; die Datenbank verwendet `NUMERIC(12,2)`. `COMP-3` wird in dieser Implementierung nicht verwendet. Die Datentypen allein ersetzen keine Prüfung von Grenzwerten, Rundung und Buchungsregeln.

<p align="center">
  <img src="doc/assets/architecture.svg" alt="Architektur: UI → Node → COBOL → PostgreSQL" width="860" />
</p>

```mermaid
flowchart TB
  subgraph UI["Präsentation"]
    A["Admin Interface /"]
    S["Kunden-Simulator /simulator/"]
  end
  subgraph API["Node.js Bridge"]
    Q["Worker-Pool TX_CONCURRENCY=16"]
    M["LiveMetrics"]
    SIM["CustomerSimulator Dauerbetrieb"]
  end
  subgraph CORE["★ COBOL Engine"]
    C["cobol_bank.exe<br/>GnuCOBOL + GixSQL EXEC SQL"]
  end
  subgraph DB["Datenhaltung"]
    P[("PostgreSQL 16 MVCC")]
  end
  A --> Q
  S --> SIM --> Q
  Q -->|CLI + JSON stdout| C
  C -->|Embedded SQL| P
  M -.-> A
```

---

## Konzeptgrafiken

Die folgenden SVGs illustrieren die Oberflächen. Ihre Beispielwerte sind keine Messergebnisse oder Screenshots eines Testlaufs.

| Admin — Last & Parallelbetrieb | Simulator — Dauerbetrieb |
|---|---|
| <img src="doc/assets/admin-preview.svg" alt="Admin Last-Studio" width="420" /> | <img src="doc/assets/simulator-preview.svg" alt="Simulator Orbit" width="420" /> |

- **Admin:** Konten, Transaktionsjournal (live), Worker-Pool, TPS, Stress-Test, COBOL Inspector
- **Simulator:** Dauerbetrieb (Loop), Mix **Betrieb** (~55 % Transfer / 35 % Deposit), echte PostgreSQL-Writes  

---

## Schnellstart

**Voraussetzung:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) · [Node.js](https://nodejs.org/) · **GnuCOBOL 3.2** inkl. GixSQL + PostgreSQL-Treiber (Windows).

Die Build- und Backend-Konfiguration enthält derzeit einen lokalen GnuCOBOL-Pfad. Vor dem Start auf einem anderen Rechner ist dieser an die Installation anzupassen; siehe [Betrieb](doc/OPERATIONS.md#voraussetzungen).

| Aktion | Befehl | URL |
|---|---|---|
| **Admin** | `startadmin.bat` | http://127.0.0.1:3000/ |
| **Simulator** | `startsimmulator.bat` | http://127.0.0.1:3000/simulator/ |
| **Stop Backend** | `stop.bat` | — |

```text
startadmin.bat
  ├─ Docker: PostgreSQL 16 (cobol / cobol / cobolbank @ :5432)
  ├─ gixpp + cobc → bin/cobol_bank.exe   ← COBOL-Build
  ├─ node backend/server.js  (COBOL INIT)
  └─ Browser → Admin UI
```

> Starter: `startadmin.bat` · `startsimmulator.bat` · `stop.bat`  
> Postgres stoppen: `docker compose down`

---

## Demo in 5 Minuten

1. `startadmin.bat` — Demokonten & KPIs  
2. `startsimmulator.bat` — Preset **Produktion** (Dauerbetrieb, Mix Betrieb)  
3. Im Admin: Worker-Pool, TPS, Journal zählen hoch  
4. Im Simulator: Orbit + Event-Feed mit echten `TRANSFER` / `DEPOSIT`  

```mermaid
sequenceDiagram
  participant You as Du
  participant Sim as Simulator
  participant Node as Node Worker-Pool
  participant Cobol as cobol_bank.exe
  participant PG as PostgreSQL
  You->>Sim: Dauerbetrieb starten
  Sim->>Node: HTTP TRANSFER/DEPOSIT
  Node->>Cobol: execFile TRANSFER …
  Cobol->>PG: EXEC SQL UPDATE/INSERT
  Note over You: Admin zeigt Workers · TPS · Journal
```

---

## COBOL CLI (ohne UI)

```cmd
powershell -ExecutionPolicy Bypass -File .\scripts\build_cobol.ps1
.\bin\cobol_bank.exe INIT
.\bin\cobol_bank.exe LIST_ACCOUNTS
.\bin\cobol_bank.exe TRANSFER DE89370400440532013000 DE89370400440532013001 10.00 "Demo"
.\bin\cobol_bank.exe DEPOSIT DE89370400440532013000 50.00 "Cash"
.\bin\cobol_bank.exe CALC_INTEREST
```

DSN: `pgsql://127.0.0.1:5432/cobolbank?native_cursors=off` · User/Pass: `cobol` / `cobol`

---

## REST API (Kurz)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/accounts` | Konten (via COBOL) |
| GET | `/api/transactions` | Journal (`total_transactions` + letzte 200) |
| POST | `/api/transfer` / `/api/deposit` | Schreibende COBOL-Jobs |
| POST | `/api/simulate/start` | Batch oder `continuous: true` |
| GET | `/api/system-status` | Queue, LiveMetrics, Simulator |

Vollständig: **[doc/API.md](doc/API.md)**

---

## Tests

```cmd
npm test                 # Unit (Mock) + Integration (Server muss laufen)
npm run test:unit
npm run test:integration
```

Die Suite enthält **5 Simulator-Tests gegen eine Mock-Bank**, **5 Server-Integrationstests** und **4 Datenvertragsprüfungen für die Admin-Anzeige**. Die letzten beiden Gruppen benötigen das laufende Backend; Integration erzeugt echte Demo-Buchungen und stoppt gegebenenfalls eine laufende Simulation. Die Admin-Checks prüfen API-Felder, keine gerenderte Browseroberfläche.

### Qualitätssicherung mit KI

Ich nutze KI für Implementierung, Gegenprüfung und die Suche nach Randfällen. Nach meiner beschriebenen Arbeitsweise kombiniere ich dafür teilweise mehrere Modelle mit Unit-Tests, Regressionstests und manuellen Prüfungen in wiederholten Korrekturzyklen. Die Verantwortung für Anforderungen, Bewertung der Ergebnisse und Freigabe bleibt bei mir.

Für dieses Repository ist konkret nachprüfbar, welche Tests existieren und welche davon ausgeführt wurden. Ein positives KI-Review ist kein Testnachweis; mehrere zustimmende Modelle garantieren keine Fehlerfreiheit. Der [Qualitätsbericht](doc/QUALITY_ASSURANCE.md) trennt diesen Arbeitsansatz, gemessene Ergebnisse und offene Prüfaufgaben. Er enthält auch einen neu gefundenen Nebenläufigkeitsfall, den die vorhandenen Tests nicht absichern.

---

## Projektstruktur

```text
cobol-corebank/
├── src/cobol/cobol_bank.sqb     ★ COBOL + EXEC SQL (Herzstück)
├── scripts/build_cobol.ps1      # gixpp + cobc
├── bin/cobol_bank.exe           # gebaute Engine
├── backend/server.js            # API, Worker-Pool, Metrics
├── backend/simulator.js         # Dauerbetrieb / Batch
├── frontend/                    # Admin + Simulator
├── tests/                       # node:test Suite
├── docker-compose.yml           # PostgreSQL 16
├── doc/                         # Architektur, Ops, API, …
└── startadmin.bat / startsimmulator.bat / stop.bat
```

---

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [doc/README.md](doc/README.md) | Inhaltsverzeichnis |
| [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) | Schichten, **COBOL-Engine**, Schema, Concurrency |
| [doc/ADMIN.md](doc/ADMIN.md) | Admin UI & Telemetrie |
| [doc/SIMULATOR.md](doc/SIMULATOR.md) | Dauerbetrieb, Mix Betrieb, Live-Feed |
| [doc/API.md](doc/API.md) | REST-Referenz |
| [doc/OPERATIONS.md](doc/OPERATIONS.md) | Start, Build, Tests, Troubleshooting |
| [doc/CODE_REVIEW.md](doc/CODE_REVIEW.md) | Review-Findings |
| [doc/QUALITY_ASSURANCE.md](doc/QUALITY_ASSURANCE.md) | Datierter Teststand, KI-gestützte Arbeitsweise und offene fachliche Prüfungen |

### Grafiken im Repo

| Datei | Motiv |
|---|---|
| [doc/assets/tech-stack.svg](doc/assets/tech-stack.svg) | Tech Stack — COBOL hervorgehoben |
| [doc/assets/architecture.svg](doc/assets/architecture.svg) | End-to-End-Architektur |
| [doc/assets/admin-preview.svg](doc/assets/admin-preview.svg) | Admin Last-Studio |
| [doc/assets/simulator-preview.svg](doc/assets/simulator-preview.svg) | Simulator Aktivitätsraum |

---

## Hinweise (GixSQL / Demo)

- DSN: **`native_cursors=off`** · kein `FOR UPDATE` (Precompiler) · Timestamps via `CAST(… AS VARCHAR(25))`  
- Parallelität: `TX_CONCURRENCY` (Default **16** parallele COBOL-Prozesse)  
- Demo bindet default auf `127.0.0.1` (keine Auth)  
- Transfer-Konflikte können unter Last auftreten; der vorhandene Summenvergleich sichert nicht jede konkurrierende Buchungsfolge ab. Details und Gegenbeispiel: [Qualitätsbericht](doc/QUALITY_ASSURANCE.md).

---

## Lizenz

MIT — Demo- und Lernprojekt. Siehe [LICENSE](LICENSE).
