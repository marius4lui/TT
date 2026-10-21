# Änderungen

## Unreleased

### Neu

- Kompakte Top 3 (standardmäßig sechs Monate) und kurze, sieben Tage gültige Links zur vollständigen Tabelle mit Zeitraumwahl. Demo-Links enden mit der Übungsrunde.
- Ranglisten verwenden nur erste Namensteile aus der jeweiligen Gruppe; unbekannte Angaben erscheinen als „Mitglied“.

- WhatsApp-Statistiken und Analysen für rollierend einen, sechs oder zwölf Monate: Ranglisten nach Zusagen mit optionalen Trainerkorrekturen, ohne aktuelle Trainer und mit Hinweis auf unvollständige Historie.
- Rückmeldungen und Trainerkorrekturen bleiben 400 Tage nach Trainingsende verfügbar; persönliche Datenexporte enthalten Korrekturen. Bereits gelöschte Daten werden nicht wiederhergestellt.

- Trainer über einen kopierbaren oder in WhatsApp teilbaren Link zur eigenen Übungsgruppe einladen.
- Übungsmenü mit drei klaren Schritten, einer Situationsauswahl statt vieler Aktionsknöpfe und eingeklappter Textprobe.

- Eigene Übungsgruppe pro Trainerperson unter Mehr: Gruppenanlage, Einladung, Verspätung, Verschiebung, Absage und Textprobe mit isolierten Rückmeldungen.

### Behoben

- `Stats`, `/stats` und `Analysen` antworten auch in aktiven Übungsgruppen: aktuelle Übungsantworten und klar gekennzeichnete fiktive Beispielranglisten, vollständig getrennt von echten Trainings.

- Trainingseinladungen zeigen Datum, Zeit und Ort auf eigenen Zeilen, einen einzelnen Link zu den Trainingsinfos und den Hinweis auf „Wer kommt?“.
- Verspätungserinnerungen wiederholen das Uhr-Symbol nicht im Text; die anklickbare Reaktion bleibt erhalten. Trainerübersichten verwenden übersichtliche Zahlenzeilen.
- „Wer kommt?“ und verwandte Fragen liefern eine lesbare Zusagenliste mit Verspätungen. Private Fragen berücksichtigen ausschließlich eigene aktive Gruppen und fragen bei mehreren Gruppen nach.

- Kurze deutsche Antworten wie „Kann doch“ und „ich kann“ nutzen eine aktuelle eigene Rückmeldung oder die direkt beantwortete Einladung als Kontext. Fragen, Unsicherheit und Aussagen über andere Personen werden nicht zu Zusagen umgedeutet.
- Bestehende Browsersitzungen öffnen auch benutzte oder abgelaufene Login-Links ohne erneute Anmeldung. Für geschützte Aktionen gibt es eine ausdrückliche Neuanmeldung mit `/login neu`.
- Einmal-Links gelten fünf Minuten. Nach Nutzung oder Ablauf wird die ursprüngliche private Nachricht innerhalb des Provider-Bearbeitungsfensters durch einen dauerhaften Zugangslink ersetzt; unklare Bearbeitungen werden nicht als neue Nachricht wiederholt.

- Erfolgreiche Änderungen im Trainer-Web starten Planung und Versand im Worker-Hintergrund. Terminänderungen warten dadurch nicht mehr auf die nächste WhatsApp-Nachricht oder den nächsten Cron.
- Fehlgeschlagene oder lesende Traineranfragen starten keinen Versand; Pausen und unklare Provider-Schreibausgänge werden weiterhin respektiert.

### Open Source und eigener Betrieb

- AGPL-3.0-only, öffentlich konfigurierbarer Quellcode-Link und Lizenzmetadaten.
- Neutrale Cloudflare-Vorlage und separate ignorierte Produktionskonfiguration.
- Eigene öffentliche Origin und alternative Konfigurationsdatei im Setup; keine feste Betreiber-Botnummer in den Helfern.
- README sowie Installations-, Konfigurations-, Architektur-, Betriebs-, Datenschutz- und Beitragsdokumentation.
- Neutrale Testdomains; neue Datenbanken übernehmen keine Adresse einer bestehenden Installation.

Die Produktionskonfiguration vor dem Update aus der bisherigen `wrangler.jsonc` in `wrangler.production.jsonc` übernehmen. Die bestehende D1, Owner-Einrichtung und gespeicherte Origin bleiben bei einem normalen Update erhalten. Die Änderung der Startwerte in Migration 0001 wirkt nur bei neu angelegten Datenbanken.

Für dieses Update zusätzlich die Migrationen 0008 und 0009 vor dem Worker-Deployment anwenden. Die Bearbeitung von WhatsApp-Nachrichten und Gruppenanlage auf der eigenen Evolution-Version anhand der Abnahmeliste prüfen.
