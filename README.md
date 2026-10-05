# Teilwerk von Prinjekt

Teilwerk bereitet große 3D-Modelle für Druck und Montage vor. Die deutschsprachige Arbeitsoberfläche führt durch **Modell → Aufteilen → Nummern → Drucklage → Stifte → Export**. Schnittvorschläge werden zunächst angezeigt und erst nach Berechnung und ausdrücklicher Übernahme angewendet.

Diese Ausgabe ist eine statische Browseranwendung. Geometrie wird mit Manifold WebAssembly auf dem eigenen Gerät berechnet. Sie enthält keinen CGAL-Dienst, keinen nativen Desktop-Helfer und keine privaten Modell- oder Projektdateien.

## Starten

Für die Entwicklung: **Node.js 22 ab Version 22.12** und npm. Für die Anwendung: ein aktueller Browser mit WebGL2 und WebAssembly.

Im heruntergeladenen oder geklonten Projektverzeichnis:

```sh
npm ci
npm run dev
```

Die vom Terminal angezeigte lokale Adresse öffnen. Node.js wird für Entwicklung und Build benötigt; Besucher einer statisch bereitgestellten Ausgabe brauchen keinen Node-Server auf ihrem Rechner.

```sh
npm test
npm run build
```

Der Build liegt in `dist/`. Zum Bereitstellen den Inhalt dieses Verzeichnisses über einen statischen HTTP-/HTTPS-Server ausliefern, einschließlich der Worker-, WASM-, Schrift- und Lizenzdateien. `index.html` nicht unmittelbar über `file://` öffnen. `npm run preview` startet eine lokale Vorschau des fertigen Builds.

Für GitHub Pages im Repository unter **Settings → Pages → Build and deployment → Source** die Option **GitHub Actions** wählen. Der mitgelieferte [Pages-Workflow](.github/workflows/pages.yml) prüft und baut die App bei einem Push auf `main` oder einem manuellen Start. Nach erfolgreicher Bereitstellung steht die tatsächliche App-Adresse beim Deployment. Ein vorhandenes Repository allein bedeutet noch keine erfolgreiche Veröffentlichung der App.

## Einstieg und Bedienung

Teilwerk öffnet direkt die Arbeitsoberfläche. Unter **Modell** eine STL-/OBJ-Datei importieren, ein gespeichertes Projekt öffnen oder **Beispiel ausprobieren** wählen. Das Beispiel ist eine Montageplatte mit zwei Bohrungen.

**Tutorial** im Kopfbereich erklärt den Ablauf. Die kleinen **?**-Schaltflächen bieten Hilfe zum jeweiligen Schritt. `?tutorial=1` in der App-Adresse öffnet die Einführung, ohne ein Modell zu laden. „Weiter“ wechselt nur den Arbeitsschritt; es startet keine Berechnung.

| Schritt | Funktionen |
| --- | --- |
| **Modell** | STL/OBJ importieren, Maße als Millimeter verwenden, Druckraum und Rand einstellen. Innenflächen auswählen, auf denen automatische Nummern liegen dürfen. |
| **Aufteilen** | Automatische Schnittvorschläge prüfen, offene Vorschau berechnen und schließen, Ergebnis übernehmen oder verwerfen. Zusätzliche manuelle Schnittwerkzeuge stehen unter „Erweitert“. |
| **Nummern** | Nummern auf ausgewählten Innenflächen platzieren und als echte Geometrie gravieren. Gemeinsame Schrifthöhe und Gravurtiefe einstellen; einzelne Texte und Positionen manuell bearbeiten. Standardtiefe: 0,4 mm. |
| **Drucklage** | Teile drehen oder eine Fläche aufs Bett legen, Schwerpunktreserve und Überhänge prüfen. Änderungen übernehmen oder verwerfen. Finnen werden von Hand gesetzt oder mit zwei Punkten gezeichnet. |
| **Stifte** | Passstiftverbindungen mit Bohrungen und Einsteckwegen berechnen. Standard: gekaufte DIN-6325-Stifte Ø 3 × 10 mm, Bohrungen Ø 3,3 mm und 7 mm tief je Teil. Maße sind einstellbar; gedruckte Stifte sind eine eigene Option. |
| **Export** | Projekt zum Weiterarbeiten speichern; Druckpaket mit STL-Teilen, farbiger 3MF, HTML-Montageanleitung und Prüfbericht erstellen. Kaufstifte erscheinen in der Einkaufsliste, nicht als Stift-STL. |

Vorgemerkte Nummern sind noch keine Gravuren. Vor Stiftplanung oder Druckexport werden erforderliche vorgemerkte Kennzeichnungen berechnet; ungeeignete Stellen bleiben mit einem Hinweis offen. Neue Schnittflächen werden nicht automatisch zu erlaubten Innenflächen.

Farben und Notizen gehören zum Projekt. Eine einfarbige Ansicht ändert die gespeicherten Teilfarben nicht. Rückgängig stellt frühere Bearbeitungsstände innerhalb der Sitzung wieder her.

## Projekte, Verarbeitung und PDF

Modelle und Rechenaufträge werden nicht an einen Rechendienst hochgeladen. Der Webhost liefert die App und ihre Ressourcen; Berechnungen laufen in Browser-Workern. **Projekte ausdrücklich als Datei speichern:** Es gibt keine automatische Projektsicherung. Ein Neuladen oder Schließen kann ungespeicherte Arbeit verlieren.

Die PDF-Aktion öffnet die Montageanleitung in einer Druckansicht. Dort **Drucken / als PDF speichern** wählen, Hintergrundgrafiken aktivieren und Browser-Kopf-/Fußzeilen ausschalten. Erlaubt der Browser keinen neuen Tab, die HTML-Anleitung herunterladen und separat öffnen. Das ZIP enthält die HTML-Anleitung; für PDF ist kein serverseitiger Renderer enthalten.

## Grenzen und Prüfung vor dem Druck

- Die Aufteilungs- und Lagesuche ist begrenzt; sie garantiert weder die kleinste Teilezahl noch ein globales Optimum.
- Schwerpunkt und Auflage werden geometrisch bewertet. Druckfortschritt, Füllmuster, Bettanhaftung und tatsächliche Materialfestigkeit sind damit nicht nachgewiesen. Überhänge und Finnen im Slicer prüfen.
- Finnen entstehen nicht automatisch. Sie sind an die Drucklage gebunden und werden beim Wiederöffnen beziehungsweise Export erneut geprüft. Eine unverbindliche Vorschau ersetzt keine erfolgreiche Übernahme.
- Ein vorhandener unvollständiger Stiftplan sperrt Druckpaket und Montageanleitung. Offene Kontakte bleiben sichtbar. Ohne Stifte weiterzuarbeiten ist eine ausdrückliche Einstellung; vorhandene Bohrungen werden dadurch nicht still entfernt.
- Die reale Stiftpassung zunächst mit einem Testdruck prüfen. Standardmaße ersetzen keine Kalibrierung des Druckers.
- Modellimport ist auf 150 MiB, eine Projektdatei auf 200 MiB begrenzt. Große Modelle können deutlich mehr Arbeitsspeicher benötigen. Ungültige Geometrie oder nicht unterstützte Operationen können abgewiesen werden.
- Projekte anderer Ausgaben können zusätzliche exakte Geometriefunktionen benötigen. Diese Browserausgabe stellt dafür keinen lokalen oder entfernten Dienst bereit und konvertiert sie nicht still in Standardgeometrie.
- STL enthält keine Farben. Die ausgegebene 3MF ist keine fertig geslicte, druckerspezifische Plattenkonfiguration. Materialien, Druckplatten und Schichtvorschau im Slicer prüfen.

Speichern oder Exportieren macht offene Prüfhinweise nicht zu einer Druckfreigabe.

## Mitentwickeln und Lizenzen

Beiträge: [CONTRIBUTING.md](CONTRIBUTING.md). Der eigene Anwendungscode steht unter [MIT](LICENSE). Drittkomponenten und Schriften behalten ihre jeweiligen Lizenzen: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Die öffentliche Oberfläche verwendet **Sarabun unter SIL OFL 1.1**. Proprietäre Myriad-Pro- und Stara-Schriftdateien sind nicht enthalten. Prinjekt-Logos, Favicon und Markenkennzeichen werden nicht durch die MIT-Lizenz des Anwendungscodes lizenziert; ihre Herkunft steht in [public/brand/SOURCES.txt](public/brand/SOURCES.txt).

## English summary

Teilwerk is a German-language browser tool for splitting 3D models, engraving part numbers, checking print orientation, adding manual support fins, planning dowel connections and exporting assembly instructions. Geometry runs locally in browser workers using Manifold WebAssembly. This repository contains no native CGAL service or desktop runtime.

Use Node.js 22.12 or later in the Node 22 line, then `npm ci`, `npm run dev`, `npm test` and `npm run build`. Save projects explicitly. Print the HTML assembly guide through the browser to create a PDF. Results still require slicer and physical-fit checks. Application code is MIT; third-party components, fonts and brand assets have separate terms listed above.
