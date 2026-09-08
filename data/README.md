# data/

Lokale Datenartefakte — **nicht** die produktive Demo-Datenbank.

| Inhalt | Bedeutung |
|---|---|
| `bank.db*` | Legacy-SQLite aus der Zeit vor PostgreSQL (Referenz/Archiv) |
| Live-DB | PostgreSQL 16 via Docker (`docker-compose.yml`, Volume) |

Die laufende Bank nutzt ausschließlich PostgreSQL (`cobolbank` / User `cobol`).  
SQLite-Dateien hier werden von der Anwendung **nicht** mehr gelesen.
