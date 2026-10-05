# Zu Teilwerk beitragen

Danke für Beiträge zu Bedienung, Geometrie und Dokumentation. Diese Ausgabe bleibt eine Browseranwendung: Modelle und Berechnungen gehören auf das Gerät der Nutzer. Neue Funktionen dürfen keine Modell-Uploads oder einen vorausgesetzten nativen Rechendienst einführen.

## Entwicklung

Node.js 22 ab Version 22.12 und npm verwenden:

```sh
npm ci
npm run dev
npm test
npm run build
```

`package-lock.json` mitführen, wenn Abhängigkeiten geändert werden. Die Oberfläche liegt in `src/`, die Einstiegsseite in `index.html`. Browser-Worker führen Geometrieoperationen aus. `public/brand/` enthält die mitgelieferten Oberflächenressourcen; Lizenztexte liegen in `licenses/`.

## Fehler melden

Bitte beschreiben:

- Browser, Betriebssystem und verwendeten Stand;
- genaue Schritte, erwartetes und tatsächliches Verhalten;
- gegebenenfalls Fehlermeldung und ein Bild der betroffenen Ansicht;
- bei Geometrieproblemen möglichst ein kleines, selbst erstelltes Beispiel mit Maßeinheit und Druckraum.

Nur Dateien veröffentlichen, deren Weitergabe erlaubt ist. Kundendaten, private Projekte, Zugangsdaten und personenbezogene Pfade gehören nicht in Issues, Tests oder Commits. Ein reproduzierbarer Quader oder eine kleine synthetische Montage ist oft hilfreicher als ein vollständiges großes Modell.

## Änderungen prüfen

Kleine, zusammenhängende Änderungen sind leichter zu prüfen. Eine Änderung sollte das Problem, das neue Verhalten und die ausgeführte Prüfung nennen.

- **Geometrie:** Materialerhalt, geschlossene Körper, Transformationen und betroffene Schnittstellen prüfen. Keine fehlgeschlagene Kontakt- oder Wandprüfung durch ein pauschales Epsilon oder ein gespeichertes Erfolgsflag ersetzen.
- **Projekte:** Kennzeichnungen, Innenflächenauswahl, Posen, Farben, Notizen und manuelle Finnen erhalten. Änderungen am Dateiformat brauchen einen nachvollziehbaren Lade-/Speichertest.
- **Aufträge:** Abbruch, veraltete Ergebnisse und Fehler müssen den letzten übernommenen Stand erhalten. Vorschauen dürfen nicht unbemerkt zum Projektergebnis werden.
- **Oberfläche:** Bestehende DOM-IDs und Aktionshandler beachten. Relevante Schritte mit Tastatur, kleinem Fenster sowie hellem und dunklem Erscheinungsbild prüfen. Hilfe soll die tatsächlichen Schaltflächen benennen.
- **Export:** Kaufstifte nicht als Drucknetze ausgeben; offene Verbindungen und Qualitätswarnungen erhalten. Die Anleitung muss zur gespeicherten Teile- und Montagereihenfolge passen.

Gezielte Regressionstests ergänzen, wenn ein Fehler oder neues Verhalten sie rechtfertigt. Danach `npm test` und `npm run build` ausführen. Zusätzliche Browserprüfungen und ihre Voraussetzungen im Änderungsbericht nennen; nicht durchgeführte Prüfungen nicht als bestanden ausweisen.

## Abhängigkeiten und Ressourcen

Neue Drittquellen mit Version oder Commit, Herkunft und Lizenz dokumentieren. Bestehende Copyright- und Lizenzhinweise erhalten. Änderungen an übernommenem Code als solche erkennbar halten; Support-Fins-Herkunft steht in `src/vendor/support-fins/UPSTREAM.txt`.

Keine proprietären Myriad-Pro-/Stara-Schriftdateien, nativen Helfer, privaten Modelle oder erzeugten Kundenprojekte hinzufügen. Sarabun besitzt eine eigene OFL-Lizenz. Die MIT-Lizenz des Codes erteilt keine allgemeinen Rechte zur eigenen Verwendung der Prinjekt-Markenkennzeichen. Für einen eigenständig benannten Fork entsprechende Logos und Namen ersetzen und eigene zulässig verwendbare Ressourcen einsetzen.

## English

Contributions are welcome. Use Node.js 22.12+ in the Node 22 line, run the relevant tests and build, and include a minimal reproducible example. Keep computation in the browser and preserve project geometry, annotations and explicit review/commit behavior. Do not upload private customer files or add proprietary fonts/native runtimes. Document dependency licenses and retain attribution. Describe tests actually performed and any remaining limitations.
