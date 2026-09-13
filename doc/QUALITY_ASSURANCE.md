# Qualitätssicherung und überprüfter Projektstand

Stand: **13.09.2026** · geprüfter Quellstand: `0eb5c2a` · Plattform: Windows · Node.js `v22.12.0`.

COBOL CoreBank ist ein **lauffähiges lokales Showcase-Projekt** mit vereinfachter Bankfachlichkeit. Quellcode, Startskripte und eine lokal vorhandene EXE bilden eine durchgehende Anwendung von Weboberfläche über Node.js und COBOL bis PostgreSQL. Bei dieser Nachprüfung waren Docker-Dienst und Backend nicht gestartet; die vollständige Anwendung wurde deshalb heute nicht erneut ausgeführt. Ein produktiver Bankbetrieb oder eine umfassend validierte fachliche Korrektheit werden nicht behauptet.

## Arbeitsweise mit KI

Thomas Nickel beschreibt seine Arbeitsweise so: KI unterstützt Implementierung, Fehlersuche und Gegenprüfung. Teilweise werden mehrere Modelle in wiederholten Zyklen eingesetzt, Ergebnisse miteinander verglichen und mit Unit-Tests, Regressionstests sowie manuellen Prüfungen kontrolliert. Das Ziel ist, Fehler systematisch zu finden und ihre Wiederkehr zu verhindern.

Zum beschriebenen Vorgehen gehören auch KI-gestütztes Debugging und die Auswertung von Logdateien. Wenn ein Assistent nicht weiterkommt, prüft Thomas Nickel selbst den betroffenen Code und gibt konkrete Anweisungen für die weitere Fehlersuche oder Korrektur. An kritischen Stellen lässt er sich vorgeschlagenen Code zeigen und erklären, hinterfragt Annahmen und steuert die Überarbeitung. Die technische Beurteilung bleibt damit beim Entwickler; KI unterstützt die Analyse.

Diese Beschreibung stammt vom Projektentwickler und erläutert seine projektübergreifende Arbeitsweise. Das Repository enthält keine vollständigen Protokolle der einzelnen Modellaufrufe und keine lückenlosen manuellen Testprotokolle. Daraus lassen sich weder eine unabhängige Vierfachprüfung jeder Änderung noch eine Fehlerquote ableiten. Mehrere Modelle können denselben Fehler übersehen; entscheidend sind konkrete Prüffälle, reproduzierbare Ergebnisse und die fachliche Bewertung durch den Entwickler. Eine Zusicherung von Fehlerfreiheit wäre durch den aktuellen Stand nicht gedeckt.

## Vorhandene Tests

| Datei | Anzahl | Was sie prüft | Aussagegrenze |
|---|---:|---|---|
| `tests/simulator.unit.test.js` | 5 | Doppelstart, Batch-Ende, Dauerbetrieb/Stop, Transfer-Anfragen, Mix-Alias gegen HTTP-Mock | Keine echte COBOL-/PostgreSQL-Buchungslogik |
| `tests/server.integration.test.js` | 5 | Statusfelder, Demo-Konten, Simulator-Schreibaktivität/Journalwachstum, Batch-Abschluss, Leerlaufstatus | Kein vollständiger Salden-/Journalabgleich, keine gezielt erzwungenen Buchungs-Races |
| `tests/admin.display.test.js` | 4 | API-Datenstrukturen für Worker-KPIs, Telemetrie, Simulator und DB-Anzeige | Keine Browser-/Renderingtests |

Die Tests sind wiederholbar und können als Regressionstests dienen. Ihre Existenz ist kein Nachweis dafür, dass jeder in Reviews gefundene Fehler bereits einen eigenen Regressionstest besitzt. Das Repository enthält zum Prüfzeitpunkt keine Coverage-Auswertung und keine GitHub-Actions-Workflows; ein vollständiger historischer Testbericht war nicht vorhanden.

## Am 13.09.2026 tatsächlich ausgeführt

| Prüfung | Ergebnis |
|---|---|
| `npm run test:unit` | **5 bestanden, 0 fehlgeschlagen, 0 übersprungen**; TAP-Gesamtdauer ca. 1,35 Sekunden |
| `node --check` für die 11 JS-Dateien unter `backend`, `frontend`, `tests` und `scripts` | Alle Syntaxprüfungen bestanden |
| Installierter Compiler: `cobc.exe --version` | GnuCOBOL `3.2+svn.5686` vorhanden; kein neuer Build durchgeführt |
| Vorhandenes `bin/cobol_bank.exe` | Lokales Build-Artefakt vom 08.09.2026 vorhanden; nicht im Git-Repository enthalten |
| HTTP-Abfrage `http://127.0.0.1:3000/api/system-status` | Verbindung verweigert; Backend lief nicht |
| `docker ps` | Docker-Engine nicht erreichbar |
| Server-Integration und Admin-Datenvertragschecks | **Nicht ausgeführt**, weil Backend/Datenbank nicht bereit waren |
| GitHub-Repository | Öffentlich; Remote `https://github.com/tnickel/cobol-corebank`, Branch `master`; 0 Actions-Workflows zum Prüfzeitpunkt |

Syntaxtests sagen nichts über fachliche Korrektheit aus. Die 5 bestandenen Mock-Tests belegen das geprüfte Simulatorverhalten, nicht die Korrektheit der COBOL-Engine.

## Offene Befunde aus der Codeprüfung

### Transfer: Summenvergleich ersetzt keine Prüfung des Debits

Quelle: `src/cobol/cobol_bank.sqb`, Paragraph `DO-TRANSFER`.

Der Code liest zunächst die beiden Salden, führt anschließend einen bedingten Debit und einen Credit aus und vergleicht die neue Summe mit der alten. Die Anzahl tatsächlich geänderter Debit-Zeilen wird nicht geprüft. Das bisherige Review bezeichnete den Summenvergleich als Lösung für einen 0-Row-Debit; diese Aussage ist zu weitgehend.

**Statisch hergeleitetes Gegenbeispiel für konkurrierende Transaktionen bei READ COMMITTED:**

1. Vorgang T1 möchte 10 von A nach B buchen. Er liest A = 10 und B = 20; die gemerkte Summe ist 30.
2. Zwischen diesen Lesezugriffen und dem Debit von T1 überweist T2 die 10 von A auf ein drittes Konto C und bestätigt seine Transaktion.
3. T1 führt `UPDATE ... balance = balance - 10 ... AND balance >= 10` auf A aus. A hat jetzt 0; es wird keine Zeile geändert.
4. T1 erhöht B von 20 auf 30.
5. T1 liest A = 0 und B = 30. Die Summe ist wieder 30, der Vergleich schlägt nicht an.
6. T1 kann seinen Journal-Eintrag und den Credit bestätigen, obwohl kein eigener Debit erfolgt ist.

Das ist eine aus dem Kontrollfluss abgeleitete mögliche Ablaufreihenfolge, **kein heute an PostgreSQL ausgeführter Reproduktionstest**. Der Anwendungscode setzt keine abweichende Isolationsstufe; der tatsächlich konfigurierte Datenbankwert wurde heute nicht abgefragt. READ COMMITTED ist der PostgreSQL-Standard: aufeinanderfolgende SELECTs können zwischenzeitlich bestätigte Änderungen sehen, und UPDATE prüft seine Bedingung gegebenenfalls an der inzwischen geänderten Zeile erneut. Grundlage: [PostgreSQL-16-Dokumentation zur Transaktionsisolation](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-READ-COMMITTED).

Vor einer belastbaren Korrektheitsbehauptung muss der Ablauf in einer isolierten Testdatenbank gezielt erzwungen werden. Nötig sind eine mit dem konkreten GixSQL-Setup geprüfte Zeilenzähl-/Sperrstrategie oder eine andere konsistente Transaktionslösung und passende Regressionstests. Ein bloß erfolgreich abgeschlossener Lastlauf reicht nicht.

### SQL-Fehler und Rückmeldungen

- `DO-DEPOSIT` prüft nach dem Kontenlesen nicht konsequent die Ergebnisse von UPDATE, Journal-INSERT und COMMIT, bevor eine Erfolgsmeldung ausgegeben wird.
- `DO-CALC-INTEREST` prüft UPDATE, aber Journal-INSERT und COMMIT nicht durchgängig. Ein FETCH-Fehler wird wie das Ende der Ergebnismenge behandelt.
- Auch in `DO-TRANSFER` wird das COMMIT-Ergebnis nicht vor der Erfolgsmeldung geprüft.
- Die Rückgabe `new_balance` bei einer Einzahlung wird aus dem vorher gelesenen Saldo berechnet und kann bei parallelen Buchungen vom tatsächlichen aktuellen Saldo abweichen.

Das sind statische Kontrollflussbefunde. Fehlerfälle müssen gezielt ausgelöst und anhand von Datenbankzustand, Journal und API-Antwort überprüft werden.

### Fachliche und technische Grenzen

- **JSON:** COBOL schreibt Stringinhalte direkt nach STDOUT. Anführungszeichen und andere JSON-Sonderzeichen in Namen oder Buchungstexten werden nicht korrekt escaped; das ist bereits im bisherigen Review dokumentiert.
- **Zinsen:** Der Beispielbatch rechnet `balance * (interest_rate / 100) / 12` mit `ROUNDED` für Konten mit positivem Zinssatz und Saldo. Abrechnungsperioden, Wiederanlaufsicherheit und die Verhinderung doppelter Gutschriften sind nicht implementiert.
- **Beträge:** Die Geldfelder `PIC S9(9)V99` besitzen zwei Nachkommastellen; `COMP-3` wird nicht verwendet. Der Wertebereich ist kleiner als der von PostgreSQL `NUMERIC(12,2)`. Durchgängige Grenzwert-, Überlauf- und Eingabeprüfungen sind noch abzusichern.
- **Betrieb:** Die API hat keine Authentifizierung; das HTTP-Backend bindet standardmäßig an `127.0.0.1`. Das Compose-Portmapping für PostgreSQL lautet derzeit `5432:5432`; es ist nicht explizit auf Loopback beschränkt. Das Setup ist für lokale Demo-Daten vorgesehen.
- **Journal:** Das Transaktionsjournal unterstützt die Nachvollziehbarkeit im Showcase. Unveränderbarkeit, vollständige Auditierung und Revisionssicherheit sind nicht implementiert oder nachgewiesen.
- **Portabilität:** GnuCOBOL-Pfade sind in Buildskript und Backend fest auf den Entwicklerrechner eingestellt. Die Voraussetzungen sind in [OPERATIONS.md](OPERATIONS.md) beschrieben.

## Nächste überprüfbare Schritte

1. Anwendung mit isolierter Demo-Datenbank starten, COBOL neu bauen und die vorhandenen Live-Tests ausführen; Ergebnis einschließlich Umgebung und Quellstand sichern.
2. Den beschriebenen Transferablauf gezielt reproduzieren, korrigieren und als Regressionstest festhalten. Nicht nur Erfolgsquoten zählen, sondern Salden und Journal gegeneinander prüfen.
3. SQL-Fehlerpfade und JSON-Sonderzeichen systematisch testen; anschließend Betragsgrenzen und wiederholte Zinsläufe absichern.
4. Manuelle Abläufe mit erwarteten und beobachteten Ergebnissen dokumentieren: Kontoanlage, Überweisung, Einzahlung, Zinslauf, Simulator-Start/Stop und Fehleranzeigen.

Für ein Showcase ist die Stärke die nachvollziehbare Verbindung der Schichten und die offene Arbeit mit Befunden. Die vorhandene Testbasis ist ein Anfang; sie ersetzt keine fachliche Abnahme für produktive Software.
