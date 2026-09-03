# MBA Hub – Performance Audit & Optimization Baseline

> Zentrale Wissensbasis für spätere Performance-Arbeit. Dieses Dokument beschreibt gemessene Fakten, behobene Regressionen, offene Kandidaten und Sicherheitsgrenzen. Es soll aktualisiert werden, wenn neue Messungen oder Performance-Fixes hinzukommen.

**Erster Audit:** 3. September 2026

**Aktueller dokumentierter Stand:** Commit `8825f70` (`main`)

**Betroffene Phasen:** P1 Task UI/WebSocket, P2 SQLite, P3.1–P3.3 Queue/Recovery

## 1. Ausgangslage

Nach P1–P3 fühlte sich die Anwendung sichtbar langsamer an. Beobachtet wurden:

- ruckelige View- und Menüwechsel;
- mehrsekündige Draft/Live/Hybrid-Wechsel;
- wiederholte Full-Task-Refetches im Prompt Log;
- Scroll-Reset der geöffneten Task-Timeline;
- verspätete oder verschwindende Statusanzeigen;
- allgemein mehr UI-Arbeit bei Live-Updates.

Die Untersuchung zeigte: **SQLite war mit den vorhandenen Daten nicht der primäre Engpass.** Die größten sichtbaren Regressionen entstanden durch Frontend-Datenfluss, unnötige Refetches, widersprüchliche Statusprojektionen und eine nicht wirklich optimistische Queue-UI.

## 2. Baseline-Messwerte

Gemessen wurde auf einer isolierten Kopie der damaligen Repository-Daten. Die Werte sind eine Vergleichsbasis, keine Garantie für das TerraMaster-NAS.

| Messgröße | Ergebnis |
|---|---:|
| Queue Items | 28 (`WAITING`) |
| `upload_queue.json` | 85.303 Bytes |
| Atomic Queue Write, 25 Wiederholungen | Median 10,06 ms; p95 12,04 ms; max 14,72 ms |
| Rebalance + Write, erster Lauf | 251–340 ms |
| Rebalance + Write, warm | ca. 9,6–15,7 ms |
| SQLite Tasks | 58 |
| Summe `payload_json` | 1.093.585 Bytes |
| Task-Payload, Mittel / Maximum | 18.855 / 19.818 Bytes |
| Events gesamt / Maximum je Task | 1.110 / 20 |
| Full Task Read | Median 0,0195 ms; p95 0,0254 ms |
| Summary Read | Median 0,0158 ms; p95 0,0207 ms |
| Full-payload SQLite Update | Median 0,118 ms; p95 1,01 ms; max 9,80 ms |
| Queue-Polling vor weiterer Optimierung | 2 Requests alle 3 s = 40 Requests/min |
| Client-Bundle | ca. 656–658 KB minifiziert; ca. 151 KB gzip |

Wichtige Interpretation:

- SQLite-Reads waren schnell und P2-Summary-Pagination funktionierte wie beabsichtigt.
- `DatabaseSync`, `synchronous=FULL` und Datei-fsync laufen trotzdem synchron auf dem Node Event Loop. Auf dem NAS können Lock- oder fsync-Zeiten deutlich höher liegen.
- Der Queue-Moduspfad umfasst neben Rebalancing einen Settings-Write und einen vollständigen crash-sicheren Queue-Write.
- Die Vite-Warnung für den großen Eager-Chunk bleibt ein Kandidat für spätere View-Startzeit-Optimierung.

## 3. Bestätigte Ursachen

### 3.1 Prompt Log: Refetch- und Scroll-Regression

Seit P1 führte jedes `TASK_UPDATED` des geöffneten Tasks unmittelbar zu `GET /api/v1/tasks/:id`. Sowohl `addEvent` als auch `updateTaskStatus` senden solche Events. Jeder Request setzte `loadingDetail=true` und ersetzte die gesamte Timeline durch einen Loader. Dadurch wurde die Timeline unmounted, neu gemounted und der Scroll-Container sprang nach oben. Schnelle Events brachen laufende Requests wiederholt ab.

### 3.2 Status: mehrere nicht monotone Projektionen

Task-Liste und WebSocket verwendeten `TaskSummary.status`, das geöffnete Detail dagegen den Status eines Full-Task-HTTP-Responses. Es gab keinen `updatedAt`-Vergleich. Zudem fehlte `AWAITING_RECOVERY_REVIEW` in der lokalen Awaiting-Liste der Tasks-View; `UPDATE_ANALYZED` fehlte in der initialen SQLite-Awaiting-Abfrage.

### 3.3 Queue-Modus: UI wartete sichtbar auf Durability

Der Klick setzte zwar lokalen State, aber `queueState.uploadMode` hatte Darstellungspriorität. Sichtbar wurde der neue Modus erst nach:

```text
click
→ PATCH /api/v1/queue/settings
→ Settings speichern
→ komplette Queue rebalancen
→ komplette Queue serialisieren
→ temp write + fsync
→ Backup kopieren + fsync + rename
→ target rename + directory fsync
→ komplette Queue als HTTP-Antwort
→ React State ersetzen
```

Lokal war der warme Pfad schnell. Auf NAS/bei Event-Loop-Blockade wurde seine gesamte Latenz aber als eingefrorener Schalter sichtbar.

### 3.4 Allgemeine verbleibende UI-Kosten

- Queue View: zwei Poll-Requests alle drei Sekunden und kompletter Root-State-Ersatz.
- Große monolithische Views ohne klare Memo-Grenzen für Queue Items und Prompt Events.
- Views werden beim Tabwechsel unmounted; Rückkehr startet State, Requests und Scrollposition neu.
- Das Client-Bundle wird weitgehend eager ausgeliefert und überschreitet die Vite-Warngrenze.

## 4. Bereits ausgelieferte Performance-Fixes

### Paket 1 – Prompt Log Live Refresh (`781eb3f`)

- Background-Refresh entfernt die bestehende Timeline nicht mehr.
- WebSocket-Updates werden 150 ms gebündelt.
- Pro Task läuft maximal ein Detail-Request; Events währenddessen erzeugen einen nachlaufenden Refresh.
- Requests werden nur beim echten Taskwechsel abgebrochen.
- Status/Checkpoint/Fehler werden sofort aus der Summary gepatcht.
- Detailantworten, die älter als die neueste WebSocket-Summary sind, werden verworfen.

**Behoben:** Scroll-Reset durch Live-Refresh, Abort-/Restart-Sturm, unnötiger Full-Page-Loader und sichtbarer Status-Lag im Prompt Log.

### Paket 2 – Status-Synchronisation (`bcd5960`)

- Zentrale Liste `TASK_STATUSES_AWAITING_USER_ACTION` und Helper `isTaskAwaitingUserAction` eingeführt.
- SQLite-Awaiting-Abfrage und WebSocket-Client verwenden dieselbe Projektion.
- `AWAITING_RECOVERY_REVIEW` und `UPDATE_ANALYZED` erscheinen initial und per Realtime konsistent.
- Tasks-Detailrequests sind abbrechbar und sequenziert.
- Veraltete HTTP-Details dürfen neuere WebSocket-Statuswerte nicht überschreiben.

**Behoben:** verschwindende Recovery-Tasks, inkonsistente initiale/realtime Review-Liste und Status-Race in der Tasks-View.

### Paket 3 – Optimistischer Queue-Modus (`8825f70`)

- `pendingMode` hat während der Speicherung Darstellungspriorität.
- Schalter und modusabhängige Inhalte reagieren sofort.
- `Speichert…` trennt optimistische UI von durable Bestätigung.
- Schnelle Klicks werden seriell verarbeitet; der letzte Wunsch gewinnt.
- Fehler rollen auf den letzten bestätigten Servermodus zurück.
- Queue-Polls während des Saves dürfen die Mutation nicht überschreiben.

**Behoben:** subjektiv eingefrorener Draft/Live/Hybrid-Schalter und Poll/PATCH-Race. Die P3-Durability wurde nicht reduziert.

## 5. Noch sinnvolle Optimierungspakete

### Upload-Pipeline: Reliability P0 umgesetzt (3. September 2026)

- Die Produkt-/Marktplatz-Matrix arbeitet jetzt fail-closed: gewünschte Checkboxen müssen existieren und ihren Sollzustand nachweislich erreichen.
- Der Produkteditor muss eindeutig zur aktuellen Produktkarte gehören; der frühere `proceed_anyway`-Pfad wurde entfernt.
- Fit- und Farbselektoren sind auf den verifizierten Editor begrenzt; Fit-Abweichungen werden als technischer Fehler an den Publish Guard übergeben.
- Zeitbudgets sind zustandsbasiert (Checkbox bis 3 s, Editor bis 3 × 5 s) statt über pauschale Langzeit-Sleeps gelöst.
- Noch offen: exakte Resize-Upload-Bestätigung, Listing-Readback, finaler Soll-Ist-Audit und fail-closed Save-Draft-Bestätigung.

### P1.1 WebSocket-Broadcasts deduplizieren – empfohlen als nächster Schritt

Einige API-Routen senden `TASK_UPDATED`, obwohl aufgerufene Services durch `addEvent` oder `updateTaskStatus` bereits senden. Künftig sollte gelten: **genau ein Broadcast pro persistierter Mutation**.

Vorgehen:

- Review-/Retry-/Recovery-Routen gegen interne Service-Broadcasts kartieren.
- Doppelte explizite Route-Broadcasts entfernen.
- Tests zählen Events pro fachlicher Aktion.
- Optional Mutationsart mitsenden: `STATUS`, `EVENT_APPENDED`, `DETAIL_INVALIDATED`.

Erwarteter Nutzen: weniger React-Renders, weniger Detailinvalidierungen und klarerer Eventvertrag.

### P1.2 Queue-Polling durch Revisions-Events ersetzen

Aktuell pollt die geöffnete Queue weiterhin häufig. Ziel:

- `QUEUE_REVISION_CHANGED` oder ein kleines Queue-Summary-Event;
- Full Queue nur bei neuer Revision, View-Open oder Reconnect laden;
- langsames Polling nur als Disconnect-Fallback (30–60 s);
- HTTP-Responses monoton anhand Revision/Request-ID anwenden.

Erwarteter Nutzen: im stabil verbundenen Zustand nahezu keine Idle-Requests und deutlich weniger komplette Queue-Renders.

### P1.3 Render- und Bundle-Grenzen

- `QueueItemCard` und `PromptLogEvent` als memo-fähige Komponenten extrahieren.
- Persistente Event-ID statt Array-Index als React-Key.
- Abgeleitete Berechnungen nur nach Profiler-Nachweis memoizen.
- Views mit `React.lazy`/dynamischen Imports aufteilen.
- View-Scrollposition speichern, statt alle schweren Views dauerhaft zu mounten.

### P2 Persistenz nur nach erneuter Messung umbauen

Noch **nicht** durch die Baseline gerechtfertigt:

- Queue vollständig nach SQLite migrieren;
- Task Events in eine append-only Tabelle auslagern;
- Heavy Payload und Task-Core trennen;
- Queue-Writes coalescen oder per-item journalen.

Diese Schritte werden erst sinnvoll, wenn reale NAS-Messungen zeigen, dass synchrone Writes, Payload-Wachstum oder Locks dominant sind.

## 6. Sicherheitsinvarianten

Performance-Optimierungen dürfen diese Regeln nicht verletzen:

- `REMOTE_REQUEST_INTENT` muss vor dem nicht-idempotenten Amazon-Request durable sein.
- Upload-/Recovery-Phasen, Amazon-ID und Human Overrides dürfen nicht nur im RAM liegen.
- Queue-Korruption bleibt fail-closed; keine automatische Leerung.
- Atomic rename, Backup-Recovery und erforderliche fsync-Grenzen werden nicht pauschal entfernt.
- Optimistische UI bedeutet nicht optimistische Ausführung: Der Worker darf einen Modus erst nach erfolgreichem durable Commit verwenden.
- Alte HTTP-Antworten dürfen neueren WebSocket-/Mutation-State nie überschreiben.
- Recovery-/Durability-Tests P3.1–P3.3 müssen bei jeder einschlägigen Optimierung grün bleiben.

## 7. Messplan für den nächsten Audit

Temporär und direkt auf dem NAS messen:

- Initialrender und React-Commit-Zahl je wichtiger View;
- Requests und WebSocket-Events pro normalem DESIGN-/UPDATE-Task;
- Full-detail Requests/min bei geöffnetem Prompt Log;
- Queue-Toggle: UI-Reaktion, HTTP-Gesamtdauer und durable Bestätigung;
- getrennte Dauer von `saveSettings`, Rebalance, stringify, temp write/fsync, Backup-fsync und Directory-fsync;
- Node Event-Loop Delay während Queue- und SQLite-Writes;
- SQLite Lock-Wartezeit und Auftreten des 5-s-`busy_timeout`;
- Größenverteilung von Queue JSON, `payload_json` und Events pro Task;
- Client-Chunk-Größen vor/nach View-Code-Splitting.

Instrumentierung nach der Messung entfernen oder klar als deaktivierbares Diagnosewerkzeug markieren.

## 8. Zielwerte / Abnahmekriterien

- Queue-Modus reagiert visuell in <50 ms.
- Durable Queue-Modusbestätigung lokal <200 ms; NAS p95 idealerweise <500 ms.
- Kein Timeline-Unmount und kein Scroll-Reset durch Live-Updates.
- Event-Bursts erzeugen höchstens einen aktiven plus einen nachlaufenden Detail-Request.
- Kein veralteter HTTP-State überschreibt neueren WebSocket-State.
- `AWAITING_RECOVERY_REVIEW` bleibt initial und realtime sichtbar.
- Queue erzeugt bei funktionierendem WebSocket keine 40 Idle-Requests/min.
- Jede fachliche Mutation erzeugt höchstens den dokumentierten WebSocket-Event.
- P1/P2/P3-Regressionstests und Production Build bleiben grün.

## 9. Historische Zuordnung

| Phase | Performance-Auswirkung |
|---|---|
| P1 `939bdde` | Gute Summary/Pagination-Basis, aber Full-detail Refetch pro `TASK_UPDATED` eingeführt. |
| P2 `67102a1` | Schnelle indexierte Summary-Queries; synchrones Full-payload Rewrite bleibt Skalierungsrisiko. |
| P3.1 `357af5c` | Queue-Durability stark verbessert; synchrone Full-Queue-fsync-Kette auf Hot Path. |
| P3.2 `91426d1` | Mehr Recovery-Mutationen verstärkten den bestehenden P1-Eventpfad. |
| P3.3 `9a62705` | Mehr Verification-Events; potenzielle Doppelbroadcasts in Route plus Service. |
| Fix `781eb3f` | Prompt Log stabilisiert. |
| Fix `bcd5960` | Statusprojektion vereinheitlicht. |
| Fix `8825f70` | Queue-Modus optimistisch und race-safe gemacht. |
