# REST-API-Referenz

Basis-URL: `http://localhost:3000`  
Content-Type Requests: `application/json`  
Antworten (Banking): meist Wrapper `{ success, exitCode, durationMs, data }` wobei `data` das COBOL-JSON ist.

CORS: `Access-Control-Allow-Origin: *` (GET/POST/OPTIONS).

---

## Banking

### `GET /api/accounts`

Listet Konten und Aggregates via COBOL `LIST_ACCOUNTS`.

**Erfolg (`data`):**

```json
{
  "status": "ok",
  "total_accounts": 4,
  "total_liquidity": 66801.5,
  "accounts": [
    {
      "id": 1,
      "account_no": "DE89370400440532013000",
      "holder_name": "Max Mustermann",
      "account_type": "GIRO",
      "balance": 4250.5,
      "currency": "EUR",
      "interest_rate": 0.0,
      "status": "ACTIVE",
      "created_at": "…"
    }
  ]
}
```

### `GET /api/transactions`

Transaktionsjournal via `LIST_TRANSACTIONS`.

### `POST /api/transfer`

```json
{
  "from_account": "DE…",
  "to_account": "DE…",
  "amount": 10.5,
  "description": "Miete"
}
```

Queued COBOL `TRANSFER`. Fehler z. B. unzureichende Deckung, Konto nicht gefunden.

### `POST /api/deposit`

```json
{
  "to_account": "DE…",
  "amount": 100,
  "description": "Bareinzahlung"
}
```

### `POST /api/accounts`

Neues Konto:

```json
{
  "account_no": "DE…",
  "holder_name": "Name",
  "account_type": "GIRO",
  "initial_balance": 0,
  "interest_rate": 0
}
```

### `POST /api/calc-interest`

Body optional/leer. Startet Zinslauf-Batch für Konten mit `interest_rate > 0`.

---

## Stress-Test (Admin)

### `POST /api/stress-test`

```json
{ "count": 100, "type": "TRANSFER" }
```

- `count`: 1–200  
- `type`: `TRANSFER` | `READ`  
- Transfers wechseln die Richtung zwischen zwei Konten.

**Antwort (Auszug):** `successes`, `failures`, `total_elapsed_ms`, `throughput_req_per_sec`, `success_rate_percent`, `concurrency`.

---

## Live-Status

### `GET /api/system-status`

```json
{
  "status": "online",
  "sql_engine": "GixSQL 1.0.20b with PostgreSQL",
  "journal_mode": "MVCC",
  "database": "postgresql://cobol@127.0.0.1:5432/cobolbank",
  "live": {
    "clients_active": 3,
    "tcp_connections": 5,
    "connections_active": 5,
    "http_requests_active": 2,
    "http_requests_peak": 12,
    "transactions_per_sec": 8.4,
    "transactions_window_sec": 5,
    "clients_ttl_sec": 45
  },
  "queue": {
    "depth": 0,
    "active_workers": 2,
    "concurrency": 16,
    "total_processed": 120,
    "total_failed": 1,
    "avg_latency_ms": 45.2,
    "peak_depth": 14
  },
  "simulator": { },
  "last_execution": { }
}
```

### `GET /api/last-execution`

Details des letzten COBOL-CLI-Aufrufs (`command`, `args`, `stdout`, `durationMs`, `timestamp`).

---

## Simulate {#simulate}

### `POST /api/simulate/start`

```json
{
  "clients": 25,
  "txs_per_client": 10,
  "delay_ms": 0,
  "amount": 0.01,
  "mix": "mixed"
}
```

| Feld | Default / Limit |
|---|---|
| `clients` | Default 10, Clamp 1–200 |
| `txs_per_client` | Default 5, Clamp 1–500 |
| `delay_ms` | Default 0, Clamp 0–10000 |
| `amount` | Default 0.01, min 0.01 |
| `mix` | `transfer` \| `deposit` \| `mixed` \| `read` |

**200:** `{ "ok": true, "config": { … } }`  
**409:** `{ "ok": false, "error": "Simulator läuft bereits" }`

Header der simulierten Requests: `X-Sim-Client-Id: <n>` (für LiveMetrics).

### `POST /api/simulate/stop`

Stoppt die laufende Simulation (wartet auf Ende der Client-Loops).

**200:** `{ "ok": true, "status": { … } }`  
**409:** wenn nichts läuft.

### `GET /api/simulate/status`

```json
{
  "running": true,
  "stop_requested": false,
  "started_at": "…",
  "finished_at": null,
  "config": { "clients": 25, "txs_per_client": 10, "mix": "mixed", "…" },
  "stats": {
    "clients_configured": 25,
    "clients_active": 12,
    "clients_finished": 13,
    "transactions_ok": 180,
    "transactions_failed": 5,
    "transfers_ok": 60,
    "deposits_ok": 60,
    "reads_ok": 60,
    "last_error": null,
    "elapsed_ms": 4200,
    "tps": 44.0
  }
}
```
