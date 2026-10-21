# Prüfstand

Datum: 21. Oktober 2026. Diese Nachweise betreffen die lokale Open-Source-Vorbereitung sowie Versand nach Webänderungen, kontextabhängige Antworten, Übungsgruppen und den Login-Ablauf. Sie sind keine Aussage über den aktuellen Zustand einer produktiven Installation.

- Typprüfung und Worker-Dry-Run erfolgreich.
- 807 Vitest-Tests in 26 Dateien erfolgreich, einschließlich Versand nach Webänderung ohne weiteren Webhook, Absage, fällig gewordener Einladung, Pausen, abgelehnter Änderungen und unklarem Provider-Ausgang.
- Zusätzliche Regressionen: Kurzantworten mit/ohne Kontext, deutsche Unicode-Zeichen, bestehende Sitzungen bei abgelaufenen Links, explizite Neuanmeldung, Bearbeitung der Login-Nachricht, isolierte Übungsdaten, unklare Gruppenanlage, Rollenentzug und atomare Rückmeldung mit Versandauftrag.
- Neun Operator-Tests erfolgreich: Konfigurationsauswahl, Origin-Validierung, Transportfehler und Demo-Journal.
- Formatprüfung und Prüfung lokaler Markdown-Verweise erfolgreich.
- Frische Quellkopie ohne Produktionskonfiguration: Installation mit eingefrorenem Lockfile unter pnpm 11.9.0, vollständiges `pnpm check`, lokale Migrationen und Owner-Bootstrap erfolgreich.
- Der lokale Smoke verwendet isolierten workerd, D1 und Evolution-Mock; er prüft zusätzlich die Zustellung nach einer Webverschiebung ohne anschließendes Chatereignis und den nachfolgenden Cron sowie Login-Bearbeitungen und die isolierte Gruppenanlage.
- Chromium mit lokalem Worker/D1 und Evolution-Mock: Anmeldung, wiederholte/ungültige Links bei vorhandenem Cookie, dauerhafter Zugang, Textprobe, Gruppenanlage, Übungsaktionen und explizite Neuanmeldung erfolgreich. Desktop- und Mobilansicht geprüft; bei 390 Pixeln kein horizontaler Überlauf.
- Aus der vorherigen Open-Source-Prüfung: `pnpm audit --prod`: keine gemeldeten bekannten Schwachstellen zum Prüfzeitpunkt.
- Aus der vorherigen Open-Source-Prüfung: Gitleaks 8.24.3: keine Treffer im bereinigten Quellbaum und in der vorhandenen Git-Historie (`--all`). Ein regelbasierter Scan ist kein Beweis für vollständige Geheimnisfreiheit und keine Prüfung auf personenbezogene Daten.

Geprüft mit Node.js 24.19.0; die frische Installation wurde mit pnpm 11.9.0 geprüft. Die CI ist auf Node.js 24 und pnpm 11.9.0 eingestellt. Der Windows-DPAPI-Test ist als eigener CI-Job ergänzt; er wurde hier unter Linux nicht ausgeführt.

Nicht durch diese Prüfung abgedeckt: neues Cloudflare-Konto, echte Evolution-Version, WhatsApp-Endgeräte, vollständige Browser-/Barrierefreiheitsabnahme, produktiver Cronzustand und Wiederherstellung echter Daten. Dafür [ACCEPTANCE.md](ACCEPTANCE.md) auf der eigenen Installation ausfüllen. Historische private Betriebsprotokolle wurden aus dieser Datei entfernt; sie bleiben in älteren Git-Revisionen enthalten.

Die Live-Freigabe wird nach Migration und Deployment gesondert dokumentiert. Die GitHub-Sichtbarkeit wurde nicht geändert.

GitHub-CI für Commit `ae8aa74`: [Lauf 39569615781](https://github.com/marius4lui/TT/actions/runs/39569615781) startete die Prüfungen nicht. GitHub meldet fehlgeschlagene Kontozahlungen oder ein zu niedriges Ausgabenlimit. Das ist kein fehlgeschlagener Anwendungstest; die Linux-Prüfungen wurden lokal erfolgreich ausgeführt, der Windows-Job bleibt unbestätigt.
