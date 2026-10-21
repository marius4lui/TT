# Prüfstand

Datum: 21. Oktober 2026. Diese Nachweise betreffen die lokale Open-Source-Vorbereitung sowie Versand nach Webänderungen, kontextabhängige Antworten, Übungsgruppen und den Login-Ablauf. Die separate Live-Prüfung steht unten.

- Typprüfung und Worker-Dry-Run erfolgreich.
- 858 Vitest-Tests in 31 Dateien erfolgreich, einschließlich Versand nach Webänderung ohne weiteren Webhook, Absage, fällig gewordener Einladung, Pausen, abgelehnter Änderungen und unklarem Provider-Ausgang.
- Zusätzliche Regressionen: Kurzantworten mit/ohne Kontext, deutsche Unicode-Zeichen, bestehende Sitzungen bei abgelaufenen Links, explizite Neuanmeldung, Bearbeitung der Login-Nachricht, isolierte Übungsdaten, unklare Gruppenanlage, Rollenentzug und atomare Rückmeldung mit Versandauftrag.
- Neun Operator-Tests erfolgreich: Konfigurationsauswahl, Origin-Validierung, Transportfehler und Demo-Journal.
- Formatprüfung und Prüfung lokaler Markdown-Verweise erfolgreich.
- Frische Quellkopie ohne Produktionskonfiguration: Installation mit eingefrorenem Lockfile unter pnpm 11.9.0, vollständiges `pnpm check`, lokale Migrationen und Owner-Bootstrap erfolgreich.
- Der lokale Smoke verwendet isolierten workerd, D1 und Evolution-Mock; er prüft zusätzlich die Zustellung nach einer Webverschiebung ohne anschließendes Chatereignis und den nachfolgenden Cron sowie Login-Bearbeitungen und die isolierte Gruppenanlage.
- Chromium mit lokalem Worker/D1 und Evolution-Mock: Anmeldung, wiederholte/ungültige Links bei vorhandenem Cookie, dauerhafter Zugang, Textprobe, Gruppenanlage, Übungsaktionen und explizite Neuanmeldung erfolgreich. Desktop- und Mobilansicht geprüft; bei 390 Pixeln kein horizontaler Überlauf.
- Aus der vorherigen Open-Source-Prüfung: `pnpm audit --prod`: keine gemeldeten bekannten Schwachstellen zum Prüfzeitpunkt.
- Aus der vorherigen Open-Source-Prüfung: Gitleaks 8.24.3: keine Treffer im bereinigten Quellbaum und in der vorhandenen Git-Historie (`--all`). Ein regelbasierter Scan ist kein Beweis für vollständige Geheimnisfreiheit und keine Prüfung auf personenbezogene Daten.

Geprüft mit Node.js 24.19.0; die frische Installation wurde mit pnpm 11.9.0 geprüft. Die CI ist auf Node.js 24 und pnpm 11.9.0 eingestellt. Der Windows-DPAPI-Test läuft als eigener CI-Job; dieser ist im unten verlinkten Lauf erfolgreich.

Nicht durch diese Prüfung abgedeckt: neues Cloudflare-Konto, echte Evolution-Version, WhatsApp-Endgeräte, vollständige Browser-/Barrierefreiheitsabnahme, Wiederherstellung echter Daten. Dafür [ACCEPTANCE.md](ACCEPTANCE.md) auf der eigenen Installation ausfüllen. Historische private Betriebsprotokolle wurden aus dieser Datei entfernt; sie bleiben in älteren Git-Revisionen enthalten.

## Live-Freigabe am 21. Oktober 2026

Quellstand `86ec272` wurde nach einer lokalen, außerhalb des Repositories abgelegten Datenbanksicherung mit den Migrationen 0008 und 0009 ausgerollt. Beide Migrationen sind in der Produktionsdatenbank bestätigt. Cloudflare meldet Worker-Version `b47017cd-6b68-40bb-931f-005f8b75e776` seit 09:01:57 UTC mit 100 Prozent Auslieferung.

Im Chromium-Browser geprüft: `/health` meldet `ok`; `/login` und `/trainer` liefern die neuen Oberflächen; der Hash der ausgelieferten `/app.js` stimmt mit dem lokalen geprüften Stand überein. Der produktive Minutenlauf ist nach dem Deployment erfolgreich weitergelaufen (D1-Nachweis 09:03:26 UTC). Einfache Python-HTTP-Aufrufe wurden durch Cloudflare mit Fehler 1010 blockiert; der reguläre Browserzugriff funktionierte.

Die neue WhatsApp-Gruppenanlage und das Bearbeiten von Login-Nachrichten wurden lokal mit dem Evolution-Mock geprüft, noch nicht interaktiv auf echten WhatsApp-Endgeräten. Eine produktive Übungsgruppe wird erst durch die jeweilige Trainerperson im Web angelegt. Temporäre Deployment-Zugangsdaten wurden außerhalb des Repositories verwendet und danach entfernt. Die GitHub-Sichtbarkeit wurde nicht geändert.

GitHub-CI für Commit `86ec272`: [Lauf 39573757875](https://github.com/marius4lui/TT/actions/runs/39573757875) erfolgreich. Sowohl „Typecheck, tests, Worker build and smoke“ als auch „Windows credential helpers“ sind grün.

## Nachtrag: lesbare Nachrichten und Teilnehmerfragen

Quellstand `02050a7` wurde als Worker-Version `a37535f5-12a0-4b64-af68-293d653611a2` ausgerollt. Keine neue Datenbankmigration war nötig. Lokale Typprüfung, 815 Tests, Operator-Tests, Worker-Build, Formatprüfung und kompletter Smoke erfolgreich. Neue Prüfungen decken Teilnehmerfragen, unveränderte Teilnahme beim Lesen, Gruppentrennung im privaten Chat, genau einen Info-Link und die Uhr ausschließlich als Reaktion in der Verspätungserinnerung ab. Nach dem Deployment meldet der öffentliche Health-Endpunkt im Chromium-Browser `ok`; Login und Trainerbereich antworten erfolgreich.

[CI-Lauf für diesen Quellstand](https://github.com/marius4lui/TT/actions/runs/39575606499). Bereits verschickte WhatsApp-Nachrichten werden durch das Deployment nicht rückwirkend umformatiert.

## Nachtrag: Trainer einladen und geführte Übung

Lokale Typprüfung, 818 Vitest-Tests, neun Operator-Tests, Worker-Build und kompletter Smoke erfolgreich. Die neuen Prüfungen sichern den Einladungslink auf die eigene Übungsgruppe ab und verwerfen ungültige Provider-Antworten. Im Chromium-Browser geprüft: Link kopieren, vorbereiteter WhatsApp-Teillink, Start/Ende, alle drei Situationen, eingeklappte Textprobe sowie Desktop und Mobilbreiten von 390 und 320 Pixeln ohne horizontalen Überlauf. Der Teillink wurde geprüft, aber keine Einladung an echte Empfänger versendet.

Quellstand `cea8c33` wurde als Worker-Version `67c77339-82da-4e8b-ad3d-a44ffd3d064b` ausgerollt, ohne neue Datenbankmigration. Live im Chromium-Browser: Health erfolgreich, Login und Trainerbereich erreichbar, ausgeliefertes JavaScript stimmt mit dem geprüften Stand überein. [CI-Lauf](https://github.com/marius4lui/TT/actions/runs/39578950192) war zum Zeitpunkt der Live-Prüfung noch aktiv.

## Nachtrag: Statistiken nach Zusagen und optionale Korrekturen

Vollständige Typprüfung, 844 Vitest-Tests in 30 Dateien, neun Operator-Tests und Worker-Dry-Run erfolgreich. Die neuen Tests prüfen rollierende Kalenderzeiträume einschließlich Sommerzeit und Schaltjahr, Gruppentrennung, Trainerausschluss und Botaliase, Gleichstände, Trainerkorrekturen ohne Änderung der Zusage, Datenlücken, 400-Tage-Aufbewahrung, Exporte, Löschweitergabe sowie Berechtigungsentzug vor verzögertem Versand. Eine unabhängige Codeprüfung führte zur zusätzlichen Abgrenzung von Übungsgruppen im gemeinsamen Auswertungsdienst.

Der vollständige lokale Smoke mit Worker/D1/Evolution-Mock prüft zusätzlich den Chatbefehl, die historische Terminliste und eine Korrektur mit anschließend veränderter Rangliste bei unveränderter ursprünglicher Zusage. Der [Implementierungsplan](STATS-PLAN.md) beschreibt Semantik, Grenzen und Datenhaltung.

Chromium mit lokalem Worker: historische Termine öffnen, Korrektur setzen und zurückstellen, gespeicherten Zustand nach Neuladen prüfen; Desktop sowie 390/320 Pixel breite Ansichten ohne horizontalen Überlauf.

Quellstand `f48afdc` wurde nach Datenbanksicherung mit Migration `0010_statistics.sql` als Worker-Version `2e531412-127d-4a94-8519-5abb12d48fe3` ausgerollt. Cloudflare bestätigt die Migration. Live-Prüfung im Chromium-Browser: Health `ok`, Login und Trainerbereich erreichbar, ausgeliefertes JavaScript stimmt mit dem geprüften Stand überein. Der [CI-Lauf](https://github.com/marius4lui/TT/actions/runs/39600348988) war zum Zeitpunkt der Live-Prüfung noch aktiv. Echte Gruppen wurden bei dieser Abnahme nicht angeschrieben.

## Nachtrag: kurze Ranglisten und private Tabellenlinks

Lokaler Gesamtablauf mit Worker, D1 und Evolution-Mock erfolgreich: kurze echte und Demo-Antwort, Tabellenlink ohne Anmeldung, vollständige Tabelle, nur Gruppennamensteile und unabhängige Trainerkorrekturen. Chromium prüft beide Tabellen, Zeitraumwechsel, unbekannte Links und Desktop sowie 390/320 Pixel ohne horizontalen Überlauf. Neue Regressionen prüfen Hashspeicherung, Linkablauf, entzogene Mitgliedschaft, deaktivierte Gruppe, Kontolöschung, Demo-Neustart, Namen aus Gruppen statt Privatnachrichten, Export und Bereinigung. Evolution-Produktion wurde für diese Tests nicht verwendet oder umkonfiguriert.

Vollständige lokale Prüfung: 858 Vitest-Tests in 31 Dateien, neun Operator-Tests, Typprüfung und Worker-Dry-Run erfolgreich. Migration `0011_statistics_links.sql` wurde nach Datenbanksicherung angewendet. Quellstand `923a2f2` läuft als Worker-Version `3c55a81f-d804-4536-b0e5-6f0609893b3f`. Live im Chromium-Browser: Health `ok`, Login und Trainer erreichbar, JavaScript und CSS stimmen mit dem lokalen Stand überein, unbekannte Tabellenlinks liefern 404 mit `noindex`. Evolution-URL, Instanz und Zugangsdaten wurden nicht geändert. [CI für die Funktionsänderung](https://github.com/marius4lui/TT/actions/runs/39615081940).
