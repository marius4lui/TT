# Änderungen

## Unreleased

### Behoben

- Erfolgreiche Änderungen im Trainer-Web starten Planung und Versand im Worker-Hintergrund. Terminänderungen warten dadurch nicht mehr auf die nächste WhatsApp-Nachricht oder den nächsten Cron.
- Fehlgeschlagene oder lesende Traineranfragen starten keinen Versand; Pausen und unklare Provider-Schreibausgänge werden weiterhin respektiert.

### Open Source und eigener Betrieb

- AGPL-3.0-only, öffentlich konfigurierbarer Quellcode-Link und Lizenzmetadaten.
- Neutrale Cloudflare-Vorlage und separate ignorierte Produktionskonfiguration.
- Eigene öffentliche Origin und alternative Konfigurationsdatei im Setup; keine feste Betreiber-Botnummer in den Helfern.
- README sowie Installations-, Konfigurations-, Architektur-, Betriebs-, Datenschutz- und Beitragsdokumentation.
- Neutrale Testdomains; neue Datenbanken übernehmen keine Adresse einer bestehenden Installation.

Die Produktionskonfiguration vor dem Update aus der bisherigen `wrangler.jsonc` in `wrangler.production.jsonc` übernehmen. Die bestehende D1, Owner-Einrichtung und gespeicherte Origin bleiben bei einem normalen Update erhalten. Die Änderung der Startwerte in Migration 0001 wirkt nur bei neu angelegten Datenbanken.
