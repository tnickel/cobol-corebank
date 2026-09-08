# Code Review — Findings & Maßnahmen

Review-Stand: 2026-09-08 (Demo-Projekt COBOL CoreBank).  
Scope: Backend, Simulator, Admin/Simulator-Frontend, COBOL-Engine, Start-Skripte.

---

## Zusammenfassung

| Schwere | Gefunden | Behoben in diesem Pass |
|---|---|---|
| Critical / High | 7 | 5 behoben, 2 dokumentiert (Demo-Auth, JSON-Escape in COBOL) |
| Medium | mehrere | Body-Limit, Localhost-Bind, Kommentar-Korrektur |
| Low | nits | teilweise |

Das Projekt bleibt ein **lokales Demoprojekt** ohne Login — Absicherung erfolgt über **Bind an `127.0.0.1`**.

---

## Behobene High-Issues

### Transfer: 0-Row-Debit konnte trotzdem Credit auslösen
**Problem:** `UPDATE … AND balance >= :amt` liefert bei 0 betroffenen Zeilen oft trotzdem `SQLCODE = 0` (GixSQL/PG). Unter Parallelität konnte Geld „erzeugt“ werden.  
**Fix:** Nach Debit+Credit Summenerhaltung prüfen (`OLDSUM` vs. `CHECKFROM + CHECKTO`); bei Abweichung `ROLLBACK` + Fehler `Transfer conflict`. Journal-INSERT prüft jetzt ebenfalls `SQLCODE`.

### CREATE_ACCOUNT ohne INSERT-Prüfung
**Fix:** `SQLCODE` nach Account-INSERT und Seed-Transaktion; bei Fehler `ROLLBACK` und Error-JSON.

### Zinslauf überschrieb parallele Salden (Lost Update)
**Fix:** `SET balance = balance + :CALCINT` statt absolutes `SET balance = :NEWBAL`.

### XSS in Admin-UI
**Fix:** Toasts nutzen `textContent`; Konto-Aktionen über `data-iban` + Event-Delegation; `escapeHtml` / `escapeAttr` inkl. `'`.

### Offenes Lauschen + Credential-Leak in Telemetrie
**Fix:** Server bindet default auf `127.0.0.1` (`BIND_HOST`). `/api/system-status` zeigt DB ohne User/Passwort und weist auf fehlende Auth hin.

---

## Offen / bewusst (Demo)

| Thema | Status |
|---|---|
| Keine Authentifizierung an der API | Demo — nur localhost |
| COBOL-JSON escaped Feldinhalte nicht (`"` in Namen) | Bekannt; Demo-Daten ohne Quotes |
| `lastExecutionInfo` last-writer-wins unter Parallelität | Akzeptabel für Inspector |
| Simulator-`stop` wartet auf laufende Clients | Bewusst; UI zeigt Stop-Status |
| TPS zählt alle COBOL-Jobs inkl. Reads | Telemetrie-Definition so dokumentiert |
| `GNUCOBOL_BASE` hardcodiert | Windows-Entwicklerpfad; siehe OPERATIONS |
| Dateiname `startsimmulator.bat` | Bewusst (Anforderung) |

---

## Medium (teilweise adressiert)

- **Body-Limit:** `MAX_BODY_BYTES` (Default 64 KiB) in `readJsonBody`
- **CORS `*`:** für reines Localhost-Demo ok; nicht für öffentliches Deployment
- Stress/Simulate sind Lastgeneratoren — nur lokal nutzen

---

## Was solide ist

- `execFile` mit Argument-Array (kein Shell-Injection)
- Host-Variablen / Embedded SQL (kein SQL-String-Concat)
- `UNIQUE(account_no)`, Worker-Pool, Simulator-Caps
- Event-Feed + Client-State für die Simulator-UI

---

## Empfohlene nächste Schritte (optional)

1. JSON-Escape-Hilfsparagraph in COBOL für String-Felder  
2. Optionale Basic-Auth / API-Token wenn nicht nur localhost  
3. `GET DIAGNOSTICS ROW_COUNT`, falls GixSQL-Version das zuverlässig liefert  
4. CI: Build + Smoke-Test TRANSFER unter Parallelität  

Siehe auch: [OPERATIONS.md](OPERATIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md).
