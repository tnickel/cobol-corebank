# Admin Interface

Betriebs- und Steuerungsoberfläche der CoreBank unter **http://localhost:3000/**.

## Start

```cmd
startadmin.bat
```

Alias: `start.bat` → ruft `startadmin.bat` auf.

Voraussetzungen und Ablauf: [OPERATIONS.md](OPERATIONS.md).

---

## Zweck

Das Admin Interface ist **kein** Endkunden-Frontend, sondern die Bankbetriebs-Konsole:

- Kontenverwaltung und Buchungsjournal (Audit)
- Manuelle Überweisungen / Einzahlungen / Kontoanlage
- Zinslauf-Batch
- Parallelbetrieb-Telemetrie und Stress-Test
- COBOL Core Inspector (letztes CLI-Kommando + stdout)
- Link zum [Kunden-Simulator](SIMULATOR.md)

---

## Dateien

| Datei | Rolle |
|---|---|
| `frontend/index.html` | Layout, KPI-Grid, Panels, Modals |
| `frontend/css/style.css` | Design System (Dark Glassmorphism) |
| `frontend/js/app.js` | Polling, Rendering, Formulare, Stress-Test |

---

## Live-Telemetrie

Polling: **jede Sekunde** gegen `GET /api/system-status`.

| KPI | Quelle (`live.*`) | Bedeutung |
|---|---|---|
| **Aktive Clients** | `clients_active` | Distinct Client-IPs bzw. `sim:N` in den letzten **45 s** |
| **Aktive Verbindungen** | `connections_active` / `tcp_connections` | Offene TCP-Sockets (max. mit HTTP-in-flight) |
| **HTTP in flight** | `http_requests_active` | Laufende HTTP-Requests |
| **Transaktionen / Sek.** | `transactions_per_sec` | Abgeschlossene COBOL-Jobs, gleitendes **5 s**-Fenster |

Zusätzlich im Panel „Last & Parallelbetrieb“:

- Warteschlangentiefe, aktive Worker, Peak, Ø-Latenz
- Verarbeitete / fehlgeschlagene Queue-Jobs
- One-Click-Stress-Test (100 Transfers / 100 Reads)

Simulierte Kunden (über den Simulator) erscheinen als Clients `sim:1` … `sim:N` und treiben TPS sowie Verbindungszahlen mit.

---

## Funktionsbereiche

### Kontenverwaltung

- Liste mit Suche und Typfilter (`GIRO` / `SPARKONTO` / `BUSINESS`)
- Neues Konto (Modal) → `POST /api/accounts`
- KPI: Liquidität, Kontenanzahl nach Typ

### Buchungsjournal (AUDIT)

- Historie mit Typfilter (`TRANSFER`, `DEPOSIT`, `INTEREST`)
- Daten aus `GET /api/transactions`

### Admin-Überweisung

- Formular → `POST /api/transfer`
- Schnellbeträge, Saldenhinweis

### Einzahlung / Zinslauf

- Modal Einzahlung → `POST /api/deposit`
- Button Zinslauf → `POST /api/calc-interest` (mit Bestätigung)

### COBOL Core Inspector (DEBUG)

- Letztes Kommando, Laufzeit (ms), pretty-printed stdout-JSON
- Wird bei API-Antworten und über `system-status.last_execution` aktualisiert

---

## Bedienungshinweise

1. Admin und Simulator können **parallel** offen sein (gleiche Backend-Instanz).
2. Nach Codeänderungen am Backend: `stop.bat`, dann erneut `startadmin.bat`.
3. Stress-Test und Simulator erzeugen Last — Salden und Journal aktualisieren sich nach Abschluss bzw. manuellem Refresh.
4. Button **Simulator** in der Header-Leiste öffnet `/simulator/`.
