# Drittkomponenten und Ressourcen

Der eigene Teilwerk-Anwendungscode steht unter der [MIT-Lizenz](LICENSE). Diese Lizenz ersetzt nicht die Bedingungen der folgenden Komponenten. Die Versionsangaben beziehen sich auf die im Lockfile festgehaltenen direkten Abhängigkeiten; die vollständigen Lizenztexte sind maßgeblich.

## Anwendung und Geometrie

| Komponente | Stand / Verwendung | Lizenz und mitgelieferter Text |
| --- | --- | --- |
| [Manifold](https://github.com/elalish/manifold) | `manifold-3d` 3.2.1; WebAssembly-Geometriekern | Apache-2.0 — [Manifold-Apache-2.0.txt](licenses/Manifold-Apache-2.0.txt) |
| [Three.js](https://github.com/mrdoob/three.js) | 0.180.0; 3D-Darstellung, Geometrie- und Dateihilfen | MIT — [Three-MIT.txt](licenses/Three-MIT.txt) |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | 0.9.15; räumliche Dreieckssuche | MIT — [Three-Mesh-BVH-MIT.txt](licenses/Three-Mesh-BVH-MIT.txt) |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3; ZIP- und Komprimierungsfunktionen | MIT — [fflate-MIT.txt](licenses/fflate-MIT.txt) |
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) | 2.4.0; Hashfunktionen | MIT — [noble-hashes-LICENSE.txt](licenses/noble-hashes-LICENSE.txt) |
| [Support Fins](https://github.com/gittrahan/support-fins) | übernommene Geometrie-/Orientierungsmodule, Commit `28ed79c48153399e7d3cd3089c981c457446c20c` | MIT, Copyright (c) 2026 gittrahan — [support-fins-MIT.txt](licenses/support-fins-MIT.txt) |

Die Support-Fins-Dateien liegen unter `src/vendor/support-fins/`. [UPSTREAM.txt](src/vendor/support-fins/UPSTREAM.txt) dokumentiert den Bezug und die übernommene `draw.js`. Die Teilwerk-Adapter und Prüfungen liegen außerhalb dieses Vendor-Verzeichnisses. Auch der gesonderte Hinweis [support-fins-pose-LICENSE.txt](src/support-fins-pose-LICENSE.txt) bleibt erhalten. Aus der Einbindung folgt keine automatische Finnenplatzierung in der Oberfläche.

## Schriften

**Sarabun** wird als Oberflächenschrift mitgeliefert: `public/brand/sarabun-regular.woff2` und `sarabun-bold.woff2`. Copyright 2018 The Sarabun Project Authors. Lizenz: **SIL Open Font License 1.1**, vollständig in [Sarabun-OFL.txt](licenses/Sarabun-OFL.txt). Herkunft: [Sarabun-Projekt](https://github.com/cadsondemak/Sarabun) und [lokaler Ressourcennachweis](public/brand/SOURCES.txt).

**Helvetiker Regular** wird über `three/examples/fonts/helvetiker_regular.typeface.json` für geometrische Schrift verwendet. Die eingebetteten Fontmetadaten nennen Version 1.00, 2004, und MAGENTA Ltd. Es gilt die eigene **MAGENTA/MgOpen-Schriftlizenz**, nicht die MIT-Lizenz von Three.js. Der vollständige Text liegt in [Helvetiker-Font-LICENSE.txt](licenses/Helvetiker-Font-LICENSE.txt). Er enthält insbesondere Anforderungen zum Erhalt der Hinweise, zur Benennung geänderter Schriften und zum Verkauf der Schrift als Bestandteil eines größeren Pakets.

**Myriad Pro und Stara sind nicht enthalten.** Proprietäre Schriftdateien einer anderen Teilwerk-Ausgabe sind kein Bestandteil dieses öffentlichen Repositorys.

## Entwicklungswerkzeuge

| Komponente | Stand | Lizenz und Hinweis |
| --- | --- | --- |
| [Vite](https://github.com/vitejs/vite) | 7.3.6 | MIT; [Vite-LICENSE.txt](licenses/Vite-LICENSE.txt) enthält außerdem Hinweise zu darin enthaltenen Drittkomponenten |

Weitere transitive Entwicklungsabhängigkeiten werden durch `package-lock.json` festgelegt. Deren Paket-Lizenztexte gelten weiterhin. Dieses Dokument ist keine Behauptung, dass alle Entwicklungsabhängigkeiten unter MIT stehen. Die mitgelieferten automatisierten Tests verwenden Node.js; Browserprogramme sind nicht Bestandteil dieses Repositorys.

## Prinjekt-Markenressourcen

`public/brand/prinjekt-light.png`, `prinjekt-dark.png` und `favicon.png` sind Prinjekt-Markenressourcen. Quellen und Herkunft sind in [SOURCES.txt](public/brand/SOURCES.txt) festgehalten. Logos, Favicon und Markenkennzeichen sind **von der MIT-Lizenz des Anwendungscodes ausgenommen**. Diese Dokumentation erteilt keine allgemeine Erlaubnis, einen unabhängigen Dienst als Prinjekt-Angebot darzustellen.

Diese Browserausgabe enthält keine CGAL-/libigl-Binärpakete, keinen nativen Exact-Dienst und kein zugehöriges Desktop-Laufzeitarchiv. Solche getrennten Pakete dürfen nicht als Teil dieser MIT-Anwendung dargestellt werden.

## English

Application code is MIT. Third-party code and fonts retain the licenses listed above; preserve their complete notices when redistributing them. Sarabun is SIL OFL 1.1. Helvetiker uses its own MAGENTA/MgOpen font license. Prinjekt logos, favicon and brand identifiers are excluded from the application's MIT license. Proprietary Myriad Pro/Stara fonts and native CGAL/libigl runtimes are not included.
