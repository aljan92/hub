# Plan: einheitliche Artwork-Ausgabe aus SVG

Status: implementiert und lokal getestet; NAS-Vergleich und Live-Amazon-Abnahme offen.

## Ziel und feste Vorgaben

- Final freigegebenes SVG als Quelle für das normale transparente Master-PNG und sämtliche Resize-Varianten. Keine Hochskalierung eines Master-/Trimmed-PNGs bei vorhandener SVG-Quelle.
- Master: bisherige 4500 × 5400, bisherige Positionierung und transparente Ränder; bestehender `_mba.png`-Pfad und bisheriger Erzeugungszeitpunkt nach SVG-Freigabe bleiben erhalten.
- Poster: 6480 × 8100. Blanket: 8904 × 10584. Andere Maße, Hintergründe, Abstände, doppelseitige Platzierungen und Brush-Gestaltung bleiben bestehen.
- Kein zusätzliches Master mit Hintergrund: Todo-Punkt 6 entfällt auf Nutzerwunsch.
- Kein neues Trimmed-PNG. Sichtbare Motivgrenzen werden intern bestimmt; keine neue veröffentlichte Zwischen-Datei.
- Bestehende Verzeichnisse, normale Varianten-Dateinamen, technische Varianten-IDs, Artifact-Keys, Queue-/Upload-Auflösung und manueller Wiederholungsablauf bleiben kompatibel. Eindeutige Generation-Pfade beim manuellen Wiederholen bleiben erhalten.
- Produktzuordnung ausschließlich aus Katalog und persistenten Overrides gemäß extra.md. Kein Eingriff in den SyncEngine.

## Beschlossene Quellenregel: Updates ohne SVG

Im aktuellen Update-Ablauf lädt `UpdatePipelineService` über `AmazonInspectService.downloadDesignArtwork` das Amazon-Artwork als PNG. `stepU7_Enqueue` übergibt `localMbaPngPath || localImagePath` an den gemeinsamen Finalisierer; eine SVG-Beschaffung ist nicht vorgesehen.

Vom Nutzer bestätigt: SVG direkt rendern; PNG-Motive nur verkleinern, niemals vergrößern. Transparente Außenränder intern ermitteln und sichtbares Motiv höchstens 1:1 zentrieren. Ganze Pixelpositionen vermeiden zusätzliche Unschärfe bei 1:1-Ausgabe. Die komplette Zielfläche erhält den konfigurierten Hintergrund. PNG-Master bleibt unverändert. Keine automatische Neu-Vektorisierung oder ungesicherte Zuordnung fremder SVGs.

Fehlt eine ausdrücklich hinterlegte SVG-Datei, kein stiller PNG-Fallback. Tasks ohne SVG-Zuordnung nutzen den expliziten PNG-Pfad.

## Paket 1 – Quellen- und Ausgabe-Verträge, Referenztests

1. Autoritative freigegebene SVG-Version und Dateiinhalte identifizieren; Änderungen zwischen Vorbereitung und Übernahme erkennen. Kein Rückgriff auf `_original.svg` nach Hintergrundentfernung.
2. Quellenart, Inhalts-Hash, Renderer-Version und Profil-Hash als Generation-Metadaten definieren. Bestehende Assets weiterhin lesbar halten; Neugenerierung versioniert kennzeichnen.
3. Referenzfälle sichern: transparentes Master, Contain, beide Two-Sided-Formate, Brush, Schatten/Filter, Masken, Konturen, Innenlöcher und asymmetrische Ränder.
4. Bestehende Ausgabe als Vergleich messen: Motivausschnitt, Positionen, Laufzeit, Dateigröße und tatsächlicher Render-Prozess-Spitzen-RAM. Node-RSS allein genügt nicht.

## Paket 2 – Gemeinsamer Renderer

1. Implementierungsentscheidung: zunächst Chromium für gleiche SVG-/Filterdarstellung beibehalten. Master und Varianten verwenden dieselbe Runtime und denselben global serialisierten, isolierten Renderprozess. Native Engine als spätere Benchmark-Option, keine neue native Deployment-Abhängigkeit in diesem Austausch.
2. Sichtbaren Motivbereich einmal pro Quelle bestimmen, einschließlich Konturen/Filter/Masken. Geometrisches getBBox allein ist kein hinreichender Ersatz für sichtbare Alpha-Grenzen. Master-Layout und Varianten-Motivgrenzen ausdrücklich trennen.
3. Generische Ausgabeprofile für Master, Contain und Two-Sided. SVG-Artwork direkt in Zielgröße rasterisieren; keine Raster-Zwischenquelle für Vektorbestandteile. Brush-Textur bleibt als Rastereffekt gesondert betrachtet und visuell geprüft.
4. Große Renderjobs global serialisieren, vom API-Eventloop isolieren, Timeout/Abbruch und Ressourcenfreigabe sicherstellen. Dateien statt großer Base64-Ketten zwischen Prozessen verwenden.
5. Ausgabe vollständig decodieren und Maße/Transparenz nach Profil prüfen; zuerst temporär schreiben, erst nach erfolgreicher Prüfung übernehmen. Fehler dürfen alte gültige Dateien nicht unkontrolliert überschreiben.

## Paket 3 – Bestehende Pipeline umstellen

1. `SvgRenderService.renderSvgToMbaPng` behält seinen Aufrufvertrag; intern denselben Renderer verwenden. Design-, Freigabe- und Recovery-Aufrufer prüfen.
2. `ArtworkResizeService` ersetzt seinen PNG-Trim/Resize-Ablauf durch die gemeinsame Ausgabeplanung. Keine dauerhafte zweite Legacy-Pipeline.
3. Finalisierung erzeugt weiterhin alle vereinbarten Varianten. Cache nur bei passendem Quell-/Profil-/Renderer-Hash und geprüften Dateien; manuelle Wiederholung erzwingt neue Generation.
4. `trimmedPath` aus neuen Ergebnissen und Pflichtprüfungen entfernen; gespeicherte alte Felder dürfen eingelesen werden. Katalog-Overrides auf tatsächlich konfigurierte Trimmed-Verbraucher prüfen, bevor Unterstützung entfernt wird. Nicht still auf ein anderes Artwork umleiten.
5. AssetValidation, Finalisierung, Recovery, Task-/Queue-Typen, manuelle Wiederholung und Prompt-Log-Zählung gemeinsam anpassen. Bestehende Queue-Einträge nicht pauschal invalidieren.
6. Upload- und Task-Sperren, kein neuer Queue-Eintrag beim Wiederholen, sichere Übernahme und Fehlererhalt bleiben erhalten. Keine automatischen Altdatei-Löschungen.

## Paket 4 – Abnahme und Dokumentation

- Tests mit tatsächlichem Rendering: Master-Layout, scharfe Vektorkanten bei hoher Auflösung, korrekte Maße/Farben/Alpha-Grenzen, unveränderte doppelseitige Positionierung und Brush-Effekt.
- Integration: neue Designs, bestehende Updates gemäß Quellenentscheidung, alte Queue-Daten, Wiederholung, veränderte SVG-/Profilinhalte, fehlende Quelle, Renderabbruch, beschädigte Ausgabe und konkurrierender Upload.
- Deployment-Build und Architektur-Guard; saubere Dateipfade auf lokaler Entwicklung und NAS.
- Vorher-/Nachher-Messung auf NAS bei gleicher Ausgabegröße; kein unbelegtes Performance-Versprechen. Blanket hat bei 200% je Achse rund 94 Megapixel bzw. 377 MB reine RGBA-Pixeldaten, zusätzliche Renderer-Puffer nicht eingerechnet.
- Live-Amazon-Abnahme bleibt erforderlich: Poster bestätigen, Blanket 200% testen. Kein automatischer Publish im Test.
- brain.md, PERFORMANCE_AUDIT.md und persönliche Todo-Liste nach tatsächlichem Abschluss aktualisieren. Punkte 4/5 erst nach entsprechender Abnahme abschließen.

## Aktueller Implementierungsstand

Umgesetzt: gemeinsame Profile/Runtime, SVG-Direktausgabe, PNG-No-Upscale, acht Varianten ohne Trimmed-Datei, Master-Aufrufvertrag, Fingerprint-/Dateihash-Cache, Quellenänderungsschutz, separate Generation bei vorhandenen Assets, Größenversuch, Quellenanzeige in den Finalisierungsdetails und gemeinsame Render-Sperre. Bestehende Pfade/IDs bleiben erhalten; Altdateien werden nicht gelöscht. `trimmedPath` bleibt ausschließlich für alte gespeicherte Daten typkompatibel.

Alpha-Grenzen für SVG werden einmal im bisherigen Master-Koordinatensystem gemessen, einschließlich sichtbarer Konturen/Filter/Masken. Diese Analyse rasterisiert temporär; keine Variante verwendet diese Analysepixel als Motivquelle. Brush-Textur verwendet weiterhin die vorhandene Rasterkontur-Logik; Motiv darüber direkt aus SVG. Zufallsstempel sind reproduzierbar. Speckbereinigung betrifft nur die Brush-Maske, nicht mehr das eigentliche Motiv. Live-Brush-Vergleich bleibt Teil der Abnahme.

Tests: `artworkSvgPipeline.test.ts` (mit `ARTWORK_FULL_SIZE_TEST=1` alle acht Produktionsgrößen), `artworkFinalizationIntegration.test.ts`, `manualFinalization.test.ts`, `productResizeV2.test.ts`, `unifiedFinalizationAndCustomResize.test.ts` und Architektur-Guard. Master-Testmotiv pixelgleich zur bisherigen Referenz. Keine pauschale Zusicherung für jedes SVG oder die reale Druckqualität.

Ressourcen: pro Variante Maße/Laufzeit/PNG-Bytes; pro Job Laufzeit und im 1-s-Takt gesampeltes maximales aggregiertes Chromium-Prozessbaum-RSS (MiB). Shared Memory kann mehrfach gezählt werden, kurze Spitzen können fehlen. Getrennt von Upload-/Screencast-Sessions. Zehn-Minuten-Joblimit, Browser-Abbau bei Fehlern, 100-MP-Pixelbudget. NAS-Vorher-/Nachher-Benchmark und praktische Abnahme stehen aus; Todo 4/5 noch nicht vollständig abschließen.
