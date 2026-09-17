# MBA Sync – Health-Watchdog und One-Click-Audit

## 1. Ziel

MBA HUB soll den produktiven Amazon-/Supabase-Sync dauerhaft und unbeaufsichtigt ausführen können. Das Dashboard soll zuverlässig zeigen, ob Produkt-Sync, Listingtexte, Child-ASIN-Resolver und Kontrollabgleiche gesund sind. Ein einzelner Audit-Button soll alle relevanten Prüfungen geordnet ausführen und einen dauerhaften, versendbaren Diagnosebericht mit atomaren Zwischenständen erzeugen.

Die bestehende produktive Datenstruktur bleibt erhalten. `mba_designs`, `published_products`, `ad_asins`, `asin_resolved`, `ad_status_us` und bestehende Cronjob-Verträge werden durch dieses Vorhaben nicht migriert oder umgebaut. Sales bleiben deaktiviert.

## 2. Höchste Betriebsinvariante

Die automatische Hintergrundaktualisierung einschließlich SNAP-Resolver muss nach der Einführung weiterhin zuverlässig funktionieren.

Ein Audit darf Auto-Sync während kritischer Phasen kontrolliert pausieren. Dafür gelten zwingend folgende Regeln:

1. Vor der Pause wird gespeichert, ob Auto-Sync zuvor aktiv oder inaktiv war.
2. Nur ein zuvor aktiver Auto-Sync wird nach dem Audit wieder aktiviert.
3. Wiederherstellung erfolgt bei Erfolg, Fehler und manuellem Abbruch in einem garantierten `finally`-Pfad.
4. Die Pause erhält eine persistente Lease mit Ablaufzeit. Ein Prozessabsturz kann keine dauerhafte Pause erzeugen.
5. Beim Serverstart wird eine unvollständige Audit-Lease erkannt. Ist sie abgelaufen oder gehört zu keinem aktiven Lauf, wird der vorherige Auto-Sync-Zustand wiederhergestellt.
6. Während der Audit-Pause wird `autoSyncEnabled` nicht als Nutzerpräferenz auf `false` gespeichert. Audit-Pause und Nutzereinstellung sind getrennte Zustände.
7. Nach Freigabe der Pause wird bei zuvor aktivem Auto-Sync sofort ein Catch-up-Tick angestoßen. Überfällige Produkt-, Text- und Resolverjobs warten nicht auf das nächste volle Intervall.
8. Der Audit darf laufende Writes nicht hart unterbrechen. Er wartet auf den aktiven Worker oder wird als `waiting_for_worker` vorgemerkt.
9. Tests müssen Neustart, Fehler, Abbruch und Timeout innerhalb jeder kritischen Phase simulieren und die Wiederaufnahme des Auto-Sync beweisen.

## 3. Nicht-Ziele

- Keine neue Supabase-Tabelle.
- Keine Migration von `mba_designs`.
- Keine Änderung der fachlichen Struktur von `ad_asins`.
- Keine Aktivierung von Sales.
- Kein Zurücksetzen vorhandener Daten.
- Keine automatische Reparatur allein aufgrund eines Audit-Befunds.
- Keine Entfernung bestehender Diagnosefunktionen, bevor der neue Audit produktiv nachgewiesen ist.

## 4. Aktueller bestätigter Ausgangszustand

Der produktive Ad-ASIN-Audit vom 17. September 2026 meldete:

- 67.911 gültige Werbeziele
- 27 offene Resolve-Produkte
- 0 Parent-Platzhalter
- 0 fehlende Einträge
- 0 Parent-Konflikte
- 0 verwaiste Einträge
- 0 Duplikate
- 0 inaktive Designs mit aktuellen Produktdaten
- 0 falsche `asin_resolved`-Flags

Die Resolverbeobachtung meldete 707 von 734 eindeutig aufgelöste Kombinationen. Offen waren 23 `parent_returned` und vier `http_not_found`. Die frühere Kennzahl „zweimal identisch bestätigt“ ist nach Einführung der unmittelbaren sicheren Übernahme fachlich veraltet und wird aus der produktiven Anzeige entfernt.

## 5. Zielarchitektur

### 5.1 Persistenter Health-Store

Neue lokale Datei:

```text
data/sync_health.json
```

Sie wird ausschließlich atomar und mit Backup geschrieben. Sie enthält keine Cookies, Tokens, Supabase-Schlüssel oder vollständigen Amazon-Antworten.

Vorgeschlagenes Schema:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-09-17T20:30:00.000Z",
  "workers": {
    "quick_products": {
      "lastStartedAt": null,
      "lastSuccessAt": null,
      "lastFailureAt": null,
      "lastFinishedAt": null,
      "lastDurationMs": null,
      "lastStatus": "never_run",
      "lastErrorCode": null,
      "lastErrorMessage": null,
      "consecutiveFailures": 0,
      "attempted": 0,
      "confirmed": 0,
      "pages": 0
    }
  },
  "queues": {
    "productJobs": 0,
    "textJobs": 0,
    "resolverRetries": 0,
    "oldestTextJobAt": null,
    "oldestResolverRetryAt": null
  },
  "scheduler": {
    "autoSyncUserEnabled": true,
    "auditPauseActive": false,
    "auditPauseLeaseUntil": null,
    "lastTickAt": null,
    "lastCatchUpAt": null
  }
}
```

Mindestens folgende Worker werden getrennt geführt:

- `quick_products`
- `full_products`
- `queued_texts`
- `snap_resolver`
- `ad_asin_audit`
- `lifecycle_audit`
- `system_audit`

Der häufig laufende Resolver darf den letzten Produkt-Sync-Status nicht überschreiben.

### 5.2 Einheitliche Worker-Instrumentierung

`beginWorker` und `finishWorker` werden um einen Health-Recorder ergänzt. Jeder Worker dokumentiert:

- Start und Ende
- Dauer
- Status
- Seiten
- geprüfte Datensätze
- bestätigte Writes
- Fehlercode und bereinigte Fehlermeldung
- aufeinanderfolgende Fehler

Ein unbekannter Write-Ausgang bleibt ein eigener kritischer Status und wird nicht als normaler Fehler kaschiert.

### 5.3 Ampellogik

Die Schwellen werden zentral konfiguriert und getestet.

#### Quick Products

- Grün: letzter Erfolg höchstens 45 Minuten alt
- Gelb: 45 bis 120 Minuten oder ein bis zwei aufeinanderfolgende Fehler
- Rot: älter als 120 Minuten oder mindestens drei aufeinanderfolgende Fehler

#### SNAP Resolver

- Grün: letzter erfolgreicher Lauf höchstens 15 Minuten alt oder keine offenen Resolve-Produkte
- Gelb: offene Produkte ohne Erfolg seit 15 bis 120 Minuten; ausschließlich bekannte Retries sind erlaubt
- Rot: Workerfehler, Write-Fehler oder mehr als 120 Minuten ohne funktionsfähigen Lauf bei offener Queue

`parent_returned`, 404 und regulärer Retry sind nicht automatisch rote Systemfehler. Sie werden als Datenbefund gezählt.

#### Listingtexte

- Grün: keine überfälligen Jobs
- Gelb: ältester Job älter als 24 Stunden
- Rot: mehrere Workerfehler oder beschädigte Queue

#### Full Refresh

- Grün: letzter vollständiger Erfolg höchstens acht Tage alt
- Gelb: acht bis zehn Tage
- Rot: älter als zehn Tage oder mehrfach fehlgeschlagen

#### Verbindungen

- Supabase und Amazon-Session werden getrennt bewertet.
- Ein kurzzeitiger Netzwerkfehler ist gelb; wiederholte Authentifizierungs- oder Account-Mismatch-Fehler sind rot.

### 5.4 Gesamtzustand

Der Gesamtstatus ist der höchste Schweregrad aller zwingenden Komponenten:

```text
healthy | warning | critical | paused | unknown
```

Eine bewusste Audit-Pause wird als `paused` mit Ursache und Restlaufzeit angezeigt, nicht als Fehler.

## 6. Scheduler und Sperrmodell

### 6.1 Trennung der Zustände

Die aktuelle globale Anzeige `isScanning` wird nicht mehr allein für alle UI-Entscheidungen verwendet. Künftig werden unterschieden:

- aktive Workerart
- Hintergrund- oder Vordergrundjob
- Amazon-Merch-API exklusiv belegt
- Supabase read-only Audit
- Audit-Pause
- Aktion wartend
- Aktion abbrechbar

### 6.2 Bestehende Intervalle

Die produktiven Intervalle bleiben zunächst fachlich unverändert:

- Quick Product Sync: alle 15 Minuten
- SNAP Resolver: kleine Batches im bestehenden kurzen Takt
- Text-Catch-up: alle fünf Minuten
- vollständiger Kontrollabgleich: wöchentlich

Die Implementierung darf die bewährten Intervalle nicht zusammen mit dem UI-Umbau neu erfinden. Optimierungen erfolgen erst nach einem stabilen Health-Nachweis.

### 6.3 Audit-Pause

Der Audit-Orchestrator verwendet eine separate persistente Audit-Lease:

```json
{
  "auditId": "uuid",
  "previousAutoSyncEnabled": true,
  "acquiredAt": "...",
  "leaseUntil": "...",
  "status": "active"
}
```

Ablauf:

1. Audit anlegen und als `queued` persistieren.
2. Auf laufenden Worker warten; keinen Worker abbrechen.
3. Vorherigen Auto-Sync-Zustand speichern.
4. Scheduler für neue Hintergrundjobs pausieren, ohne die Nutzerpräferenz zu ändern.
5. Auditphasen ausführen und Lease regelmäßig verlängern.
6. In `finally` Lease freigeben und vorherigen Zustand wiederherstellen.
7. Bei zuvor aktivem Auto-Sync sofort Catch-up auslösen.

Beim Start des Servers:

- laufenden Auditbericht auf `interrupted` setzen, falls kein aktiver Prozess dazu existiert
- abgelaufene Lease freigeben
- Auto-Sync gemäß gespeicherter Nutzerpräferenz starten
- überfällige Jobs als fällig markieren

## 7. One-Click-System-Audit

### 7.1 Eigenschaften

- ein Button
- read-only gegenüber Supabase und Amazon
- keine Produkt-, Text- oder ASIN-Reparatur
- sichtbarer Fortschritt
- sicher abbrechbar
- atomare Zwischenstände
- nach Neustart als unterbrochen erkennbar
- versendbare Diagnose ohne Secrets

### 7.2 Auditphasen

#### Phase A – Preflight

- App- und Berichtsversion
- aktuelle Zeit und Zeitzone
- Auto-Sync-Nutzerpräferenz
- aktiver Worker
- Health-Datei lesbar
- Sync-Runtime lesbar und Backup-Recovery-Status
- SQLite Sync-State lesbar
- Supabase-Konfiguration vorhanden
- Amazon Session 1 erreichbar
- Amazon Account-ID eindeutig und kompatibel

Erst nach erfolgreichem Preflight wird die Audit-Pause erworben.

#### Phase B – Scheduler- und Workerzustand

- letzter erfolgreicher Lauf je Worker
- letzte Fehler und Fehlerfolgen
- Laufzeiten und Seitenzahlen
- überfällige Jobs
- festhängender `running`-Status
- Audit- oder Scheduler-Lease
- letzter bestätigter Produkt-Watermark
- Alter des letzten Full Refresh

#### Phase C – Supabase-/Ad-ASIN-Datenqualität

Wiederverwendung des bestehenden read-only Ad-ASIN-Audits:

- gültige Ziele
- offene Resolve-Produkte
- Parent-Platzhalter
- fehlende und verwaiste Einträge
- Parent-Konflikte
- doppelte Produkt-/Ad-Schlüssel
- unsupported Ziele
- inaktive Designs mit aktuellen Daten
- falsche `asin_resolved`-Flags

#### Phase D – Resolveranalyse

- beobachtete Kombinationen
- gespeicherte Auflösungen
- offene Kombinationen
- Ursachenverteilung
- Produkttyp-/Marktplatzverteilung
- Versuche und nächster Retry
- Alter des letzten Fortschritts
- Write-Fehler getrennt von Amazon-Antworten

Die veraltete Zweitbestätigungskennzahl wird nicht mehr als Qualitätskriterium angezeigt.

#### Phase E – Produkt- und Textzustand

- offene Produktjobs
- offene Textjobs
- ältester Job
- Fingerprint-/Baseline-Status
- Egress-Metriken je Queryfamilie
- letzter vollständiger und inkrementeller Produktlauf
- unbestätigte oder unbekannte Write-Ausgänge

#### Phase F – Vollständiger Amazon-Lifecycle-Abgleich

Wiederverwendung des bestehenden Lifecycle-Audits mit vollständiger, sicherer Pagination:

- alle Amazon-Listings und Designs
- vollständig gelöschte Designs
- DB-Designs ohne Amazon-Ergebnis
- veraltete `published_products`
- betroffene `ad_asins`
- Amazon-Live-Produkte, die in Supabase fehlen

Leere Seiten mit Token, wiederholte Token, Abbruch, Nullergebnis oder Sicherheitslimit verhindern einen „gesund“-Abschluss.

#### Phase G – Bewertung und Abschluss

- Findings nach `info`, `warning`, `critical`
- Gesamtstatus
- Abgleich gegen definierte Schwellen
- Bericht finalisieren
- Audit-Pause im garantierten Abschluss freigeben
- Catch-up für zuvor aktiven Auto-Sync starten

## 8. Persistenter Auditbericht

Verzeichnis:

```text
data/audits/
```

Dateien:

```text
system_audit_YYYY-MM-DD_HH-mm-ss_<audit-id>.json
system_audit_latest.json
```

Optional wird zusätzlich eine kompakte Textfassung erzeugt:

```text
system_audit_YYYY-MM-DD_HH-mm-ss_<audit-id>.txt
```

### 8.1 Zwischenstände

Nach jeder Phase und innerhalb der langen Amazon-Pagination regelmäßig:

- neue temporäre Datei schreiben
- validieren
- atomar umbenennen
- Backup der vorherigen Version behalten

Der Bericht enthält:

```json
{
  "schemaVersion": 1,
  "auditId": "uuid",
  "status": "queued|waiting_for_worker|running|complete|complete_with_warnings|failed|cancelled|interrupted",
  "startedAt": "...",
  "updatedAt": "...",
  "finishedAt": null,
  "currentPhase": "lifecycle",
  "progress": {
    "completedPhases": 5,
    "totalPhases": 7,
    "pages": 146,
    "records": 72841
  },
  "autoSync": {
    "previouslyEnabled": true,
    "pauseActive": true,
    "restored": false
  },
  "health": {},
  "adAsinAudit": {},
  "resolverAudit": {},
  "syncAudit": {},
  "lifecycleAudit": {},
  "findings": []
}
```

### 8.2 Datenschutz und Diagnosewert

Erlaubt:

- Design-IDs
- ASINs
- Produkttypen und Marktplätze
- Status, Zeitpunkte, Zähler und bereinigte Fehler

Verboten:

- Supabase Service Role Key
- Amazon-Cookies und Sessiontokens
- Authorization-Header
- vollständige HTML-Seiten
- unbereinigte Requestheader
- lokale Passwörter oder API-Schlüssel

Vor dem Schreiben durchläuft der Bericht eine rekursive Secret-Redaktion mit Tests.

## 9. API

Geplante Endpunkte:

```text
POST /api/v1/sync/system-audit/start
POST /api/v1/sync/system-audit/cancel
GET  /api/v1/sync/system-audit/status
GET  /api/v1/sync/system-audit/latest/download
GET  /api/v1/sync/health
POST /api/v1/sync/run-now
```

Regeln:

- `start` ist idempotent: Ein laufender Audit erzeugt keinen zweiten Lauf.
- `cancel` setzt nur ein Abbruchsignal; laufende Requests werden sicher beendet.
- `status` liest den persistierten Zwischenstand.
- `download` liefert ausschließlich Dateien aus dem fest definierten Auditverzeichnis.
- Pfade aus Benutzereingaben werden nicht akzeptiert.
- `run-now` reiht einen produktiven Catch-up-Lauf ein und kollidiert nicht mit dem Audit.

## 10. Dashboard

### 10.1 Neue produktive Übersicht

```text
Hintergrund-Synchronisierung: Aktiv

Produkte       Gesund · zuletzt erfolgreich vor 6 Min.
Listingtexte   Gesund · keine offenen Aufgaben
ASIN Resolver  27 offen · letzter Erfolg vor 2 Min.
Full Refresh   zuletzt erfolgreich vor 4 Tagen
Supabase       Verbunden
Amazon         Session aktiv
```

Aktionen:

- Auto-Update an/aus
- Jetzt synchronisieren
- System-Audit erstellen

### 10.2 Auditfortschritt

```text
System-Audit läuft · keine Datenbankänderung

✓ Preflight
✓ Workerzustand
✓ Ad-ASIN-Datenqualität
✓ Resolveranalyse
● Produkt- und Textzustand
○ Vollständiger Amazon-Abgleich
○ Abschluss

Amazon-Seite 146 · 72.841 Datensätze
Laufzeit 04:18
```

Aktionen:

- Audit abbrechen
- nach Abschluss Bericht herunterladen
- Dateipfad kopieren

### 10.3 Button-Verfügbarkeit

Buttons werden nicht mehr pauschal wegen eines kurzen Resolverlaufs deaktiviert.

- „System-Audit erstellen“ wird bei einem Hintergrundlauf als wartend eingereiht.
- „Jetzt synchronisieren“ wird während eines Audits als für danach vorgemerkt.
- Nur tatsächlich unvereinbare oder destructive Aktionen bleiben gesperrt.
- Der konkrete Sperrgrund wird direkt am Button angezeigt.

### 10.4 Entfernen alter Prüffunktionen

Erst nach einem erfolgreichen produktiven One-Click-Audit werden aus dem normalen Menü entfernt:

- manueller SNAP-Einzeltest
- Shadow-/Zweitbestätigungsanzeige
- separater Ad-ASIN-Audit-Button
- separater Lifecycle-Audit-Button
- alter Resolver-Button
- Sales-Schaltflächen und Sales-Reset bleiben entfernt

Manuelle Full-Refresh-Funktionen bleiben unter „Erweiterte Wartung“ verfügbar.

## 11. Fehler- und Wiederanlaufverhalten

### Auditfehler

- Bericht wird `failed` mit abgeschlossener letzter Phase.
- Keine Datenbankreparatur wird ausgelöst.
- Audit-Pause wird freigegeben.
- Zuvor aktiver Auto-Sync wird wiederhergestellt.
- Catch-up wird angestoßen.

### Manueller Abbruch

- aktueller Request darf sicher enden
- Bericht wird `cancelled`
- Zwischenstand bleibt herunterladbar
- Auto-Sync wird wie zuvor wiederhergestellt

### Prozess-/Container-Neustart

- `running`/`waiting_for_worker` wird beim Start auf `interrupted` gesetzt
- verwaiste Lease wird freigegeben
- Nutzerpräferenz für Auto-Sync wird geladen
- Scheduler werden genau einmal gestartet
- Catch-up prüft überfällige Jobs

### Beschädigte Health-/Audit-Datei

- Backup-Recovery verwenden
- bei nicht reparierbarer Datei mit sicherem Default starten
- Auto-Sync nicht dauerhaft blockieren
- sichtbare Warnung und neuer Berichtseintrag

## 12. Teststrategie

### Unit-Tests

- Health-Ampeln an allen Zeitgrenzen
- Fehlerfolgen werden nach Erfolg zurückgesetzt
- Resolver-Datenbefund versus echter Workerfehler
- Secret-Redaktion
- Auditphasen und Finding-Schweregrade
- Berichtsschema und atomare Zwischenstände
- Pfadvalidierung beim Download

### Scheduler-/State-Tests

- Auto-Sync vorher an → nach Erfolg wieder an
- Auto-Sync vorher an → nach Fehler wieder an
- Auto-Sync vorher an → nach Abbruch wieder an
- Auto-Sync vorher aus → bleibt nach Audit aus
- Neustart mit aktiver Lease → sichere Wiederherstellung
- Audit wartet auf aktiven Quick Sync
- Catch-up läuft nach langer Audit-Pause
- keine doppelten Timer nach Wiederherstellung
- Resolver startet nach Audit erneut und kann Child-ASIN schreiben

### Audit-Tests

- vollständiger gesunder Lauf
- Supabase-Lesefehler
- Amazon Auth erforderlich
- leere Amazon-Seite mit Token
- wiederholter Token
- Nullergebnis
- manuelles Abbruchsignal während Pagination
- Bericht bleibt nach jeder Phase valide
- keinerlei Supabase-Update/Upsert/Delete

### Regressionen

- bestehender Quick Product Sync
- Full Product Refresh und Lifecycle-Reconciliation
- Text-Retryqueue
- unmittelbare Child-ASIN-Übernahme
- Parent-Wechsel invalidiert Child
- gelöschte Produkte entfernen `ad_asins`
- Egress-Optimierungsmodus
- Production Client-/Server-Build

## 13. Rollout

### Stufe 1 – Health nur beobachten

- Health-Store und Instrumentierung aktivieren.
- Bestehendes Menü unverändert lassen.
- Mehrere Hintergrundzyklen beobachten.
- Noch keine Audit-Pause und keine UI-Entfernung.

### Stufe 2 – One-Click-Audit parallel

- neuen Audit und Fortschrittsanzeige ergänzen.
- alte Einzelprüfungen bleiben weiterhin sichtbar.
- einen vollständigen produktiven Audit ausführen.
- Bericht gemeinsam auswerten.

### Stufe 3 – Pause-/Resume-Härtung

- Fehler-, Abbruch- und Neustartpfade produktionsnah testen.
- nachweisen, dass Quick Sync, Texte und Resolver danach weiterlaufen.
- mindestens einen neuen Design-/Child-ASIN-Zyklus nach Audit beobachten.

### Stufe 4 – Menü vereinfachen

- alte Test-/Einzelprüfbuttons entfernen.
- Wartungsfunktionen in „Erweiterte Wartung“ verschieben.
- Health-Übersicht, „Jetzt synchronisieren“ und One-Click-Audit werden Hauptoberfläche.

## 14. Abnahmekriterien

Die Umsetzung gilt erst als abgeschlossen, wenn alle folgenden Punkte erfüllt sind:

- Auto-Sync läuft nach normalem Audit weiter.
- Auto-Sync läuft nach fehlgeschlagenem Audit weiter.
- Auto-Sync läuft nach abgebrochenem Audit weiter.
- Auto-Sync erholt sich nach Containerneustart während eines Audits.
- Ein zuvor deaktivierter Auto-Sync wird nicht unbeabsichtigt aktiviert.
- Quick Product Sync aktualisiert neue Designs weiterhin innerhalb des vorgesehenen Intervalls.
- SNAP-Resolver löst neue Resolve-Produkte weiterhin auf und schreibt valide Child-ASINs.
- Text-Catch-up verarbeitet offene Jobs weiterhin.
- Wöchentlicher Full Refresh bleibt funktionsfähig.
- Audit führt keine Supabase-Mutation aus.
- Auditbericht ist nach jedem Zwischenstand valide und enthält keine Secrets.
- Dashboard zeigt konkrete Sperrgründe statt pauschal deaktivierter Buttons.
- Ein vollständiger Auditbericht lässt sich herunterladen und extern analysieren.
- Bestehende `mba_designs`-, `ad_asins`- und Cronjob-Verträge bleiben unverändert.

## 15. Implementierungsreihenfolge

1. Health-Schema, atomare Speicherung und Recovery implementieren.
2. Bestehende Worker instrumentieren, ohne Scheduling zu verändern.
3. Health-Auswertung und API ergänzen.
4. Auditbericht, Checkpoints und Secret-Redaktion implementieren.
5. Audit-Orchestrator zunächst ohne Lifecycle-Phase testen.
6. persistente Audit-Pause, Lease-Recovery und Catch-up implementieren.
7. vollständigen Lifecycle-Abgleich integrieren.
8. Status-/Download-/Cancel-API ergänzen.
9. Dashboard-Health und Auditfortschritt ergänzen.
10. vollständige Fehler-/Neustarttests ausführen.
11. Stufe 1 und 2 produktiv beobachten.
12. erst nach Bestätigung alte Einzelprüfungen aus dem Menü entfernen.
