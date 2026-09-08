# Kunden-Simulator

Lastgenerator mit eigenem Web-UI: **N parallele simulierte Bankkunden**, die echte HTTP-Transaktionen gegen die CoreBank-API ausführen.

URL: **http://localhost:3000/simulator/**

---

## Start

```cmd
startsimmulator.bat
```

Das Skript:

1. startet PostgreSQL (Docker Compose + Healthcheck),
2. baut `cobol_bank.exe` bei Bedarf,
3. startet das Backend auf Port 3000 (falls nicht schon aktiv),
4. öffnet den Browser auf `/simulator/`.

Alias (gleiche Wirkung): `startsimulator.bat`.

Admin parallel: http://localhost:3000/ — dort sind Clients, Verbindungen und TPS während der Simulation sichtbar.

---

## Konzept

```text
  Simulator UI  ──POST /api/simulate/start──►  CustomerSimulator (Node)
                                                    │
                         N parallele Loops ─────────┤
                         je Client:                 │
                           HTTP → 127.0.0.1:3000    │
                           Header X-Sim-Client-Id   │
                                                    ▼
                                              Banking-API
                                              (Queue + COBOL + PostgreSQL)
```

Warum HTTP-Loopback statt direktem `runCobol`?

- Jeder Client erzeugt **echte HTTP-Verbindungen**.
- Header `X-Sim-Client-Id` → LiveMetrics zählt **distinct Clients** (`sim:1` … `sim:N`).
- Admin-KPIs (Clients / Connections / TPS) spiegeln die Last realistisch.

---

## Dateien

| Datei | Rolle |
|---|---|
| `frontend/simulator/index.html` | UI: Slider, Mix, Presets, Monitor |
| `frontend/simulator/css/simulator.css` | Simulator-Layout |
| `frontend/simulator/js/simulator.js` | Start/Stop, Polling, Labels |
| `backend/simulator.js` | Klasse `CustomerSimulator` |
| `startsimmulator.bat` | Offizieller Starter |

---

## Konfiguration (UI)

| Parameter | Bereich / Werte | Default (UI) | Bedeutung |
|---|---|---|---|
| Parallele Kunden | 1–100 (API bis 200) | 25 | Anzahl gleichzeitiger Client-Loops |
| Transaktionen pro Kunde | 1–100 (API bis 500) | 10 | Buchungen je Client |
| Pause zwischen Buchungen | 0–2000 ms | 0 | Delay innerhalb eines Clients |
| Betrag | ≥ 0,01 EUR | 0,01 | Transfer-/Deposit-Betrag |
| Transaktionsmix | siehe unten | Gemischt | Welche Operationen |

### Transaktionsmix

| Mix | Verhalten |
|---|---|
| `mixed` | Rotierend: Transfer → Deposit → Read |
| `transfer` | Nur Überweisungen |
| `deposit` | Nur Einzahlungen |
| `read` | Nur `GET /api/accounts` |

### Schnellwahl-Presets

| Preset | Clients × Tx/Client |
|---|---|
| Leicht | 10 × 5 |
| Mittel | 25 × 10 |
| Stark | 50 × 20 |
| Burst | 100 × 5 |

Gesamtzahl Anfragen ≈ `clients × txs_per_client` (Reads/Transfers/Deposits je nach Mix).

---

## Ablauf einer Simulation

1. UI sendet `POST /api/simulate/start` mit Konfiguration.
2. Backend lädt Kontenliste (`GET /api/accounts`).
3. Es werden **N** asynchrone Client-Loops gestartet (`Promise.all`).
4. Jeder Loop führt `txs_per_client` Operationen aus (optional mit Delay).
5. UI pollt `GET /api/simulate/status` (~400 ms) für Fortschritt, TPS, Breakdown.
6. `POST /api/simulate/stop` setzt `stopRequested`; laufende Clients brechen nach der aktuellen Tx ab.

Es kann nur **eine** Simulation gleichzeitig laufen (HTTP 409 bei Doppelstart).

---

## Live-Monitor (UI)

- Aktive Clients, OK/Fehler, Durchsatz (TPS), Laufzeit
- Fortschrittsbalken relativ zu `clients × txs_per_client`
- Breakdown: Transfers OK, Einzahlungen OK, Reads OK, Clients fertig
- Ereignisprotokoll (Start-/Stop-/Ergebniszeilen)

---

## API (Kurz)

Vollständige Verträge: [API.md](API.md#simulate).

```http
POST /api/simulate/start
Content-Type: application/json

{
  "clients": 25,
  "txs_per_client": 10,
  "delay_ms": 0,
  "amount": 0.01,
  "mix": "mixed"
}
```

```http
POST /api/simulate/stop
GET  /api/simulate/status
```

Status enthält u. a. `running`, `config`, `stats.transactions_ok`, `stats.tps`, `stats.clients_active`.

`GET /api/system-status` enthält zusätzlich `simulator: { … }` für das Admin-Dashboard.

---

## Tipps & Grenzen

- Bei vielen parallelen **Transfers** auf denselben Konten: erwartbare Konflikte / „Insufficient funds“ wenn Salden eng sind — Mix mit Deposits oder kleiner Betrag hilft.
- Worker-Pool-Limit: `TX_CONCURRENCY` (Default 16) begrenzt gleichzeitige COBOL-Schreibprozesse; mehr Clients warten in der Queue (realistisch).
- Simulator-Clients teilen sich die Demo-Konten (Round-Robin über die Account-Liste).
- Backend-Neustart nötig, wenn `backend/simulator.js` geändert wurde.
