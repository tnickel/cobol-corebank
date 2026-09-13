# Kunden-Simulator

Lastgenerator mit eigenem Web-UI: **N parallele Bankkunden** im **Dauerbetrieb (Loop)** oder Batch — echte HTTP-Transaktionen, die **in PostgreSQL schreiben**.

URL: **http://127.0.0.1:3000/simulator/**

---

## Start

```cmd
startsimmulator.bat
```

1. PostgreSQL (Docker) · 2. COBOL-Build falls nötig · 3. Backend · 4. Browser `/simulator/`  
Admin parallel: http://127.0.0.1:3000/ (Worker-Pool, TPS, Journal).

---

## Konzept

```text
  Simulator UI  ──POST /api/simulate/start──►  CustomerSimulator (Node)
                                                    │
                         N parallele Loops ─────────┤
                         TRANSFER / DEPOSIT / READ  │
                         Header X-Sim-Client-Id     │
                                                    ▼
                                              Banking-API
                                              Queue → COBOL → PostgreSQL
                                              (DB-Transaktionen + Journal)
```

- **Dauerbetrieb:** Clients loopen bis Stop — simuliert laufenden Filial-/Online-Betrieb.
- **Writes:** `TRANSFER` und `DEPOSIT` ändern Salden und erzeugen Journal-Einträge.
- Salden werden periodisch neu geladen; nach Transfer-Konflikt folgt Deposit-Nachschub.

---

## Konfiguration (UI)

| Parameter | Default | Bedeutung |
|---|---|---|
| **Dauerbetrieb (Loop)** | an | Läuft bis Stop |
| Parallele Kunden | 25 | Gleichzeitige Clients |
| Tx pro Runde / Batch | 10 | Loop: Rundenlänge · Batch: Tx je Client |
| Denkzeit | 200 ms | Pause zwischen Buchungen |
| Basis-Betrag | 0,01 | leichte Streuung im Backend |
| Mix | **Betrieb (`ops`)** | Schreiblast |

### Mix

| Mix | Verhalten |
|---|---|
| **`ops`** | Auswahlzyklus: 55 % Transfer · 35 % Deposit · 10 % Read; tatsächlicher HTTP-Mix kann durch zusätzliche Kontenabfragen/Nachschub abweichen |
| `mixed` / `transfer` / `deposit` / `read` | wie bisher |

Preset **Produktion** = Dauerbetrieb + Mix `ops`.

Der Name dieses UI-Presets bezeichnet ein Lastszenario im Showcase. Er ist keine Aussage zur Produktionsreife. Ob einzelne Buchungen fachlich korrekt sind, muss zusätzlich geprüft werden; steigende Zähler allein belegen das nicht. Siehe [Qualitätsbericht](QUALITY_ASSURANCE.md).

---

## API

```json
POST /api/simulate/start
{
  "clients": 20,
  "txs_per_client": 10,
  "delay_ms": 200,
  "amount": 0.01,
  "mix": "ops",
  "continuous": true
}
```

`continuous` / `loop` / `mode: "continuous"` → Dauerbetrieb.  
Status: `stats.write_ok`, `stats.rounds_completed`, `config.continuous`.

`POST /api/simulate/stop` · `GET /api/simulate/status`

---

## Tipps

- Im Admin steigen Worker / TPS; im Journal erscheinen neue Buchungen.
- Enge Salden → Konflikte normal; Deposit-Anteil hält den Dauerlauf stabil.
- `TX_CONCURRENCY` (Default 16) begrenzt parallele COBOL-Prozesse.
- Nach Änderung an `backend/simulator.js` Backend neu starten.

## Tests

```cmd
npm test
```

Unit (Mock-Bank) + Integration gegen laufenden Server: Dauerbetrieb schreibt Journal, `system-status` zeigt Worker/Clients/TPS fürs Admin-UI. Details: [OPERATIONS.md](OPERATIONS.md#tests).
