# Weiterentwicklung

Die aktuelle Architektur steht in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), der Stand der öffentlichen Vorbereitung in [docs/OPEN_SOURCE_READINESS.md](docs/OPEN_SOURCE_READINESS.md).

## Vor der ersten öffentlichen Freigabe

- Git-Historie und veröffentlichbare Artefakte auf Secrets und persönliche Betriebsdaten prüfen.
- Öffentlichen Quellcodezugang herstellen und private Sicherheitsmeldungen aktivieren.
- Eine Installation auf einem unabhängigen Cloudflare-Account anhand der Anleitung nachvollziehen.
- Evolution-Version und echte Geräteabnahme dokumentieren.

## Nächste sinnvolle Verbesserungen

- Getestete Evolution-Versionsmatrix und Upgradeverfahren.
- Bessere Versanddiagnose für Cron-Ausfall, Warteschlangenrückstand und Providerlimits.
- Versionierte Releases mit Releasehinweisen und automatischer Abhängigkeitsprüfung.
- Echte Browser- und mobile Barrierefreiheitsprüfungen.
- Optional konfigurierbare Zeitzone und weitere Sprachen.

Ein Betrieb außerhalb von Cloudflare gehört derzeit nicht zum unterstützten Umfang. Die fachliche Logik ist teilweise getrennt; ein VPS-Port müsste Datenbankadapter, Scheduler, Hintergrundarbeit und Asset-Auslieferung ersetzen.
