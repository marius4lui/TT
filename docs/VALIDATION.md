# Prüfstand

Datum: 21. Oktober 2026. Diese Nachweise betreffen die lokale Open-Source-Vorbereitung und den Fix für den Versand nach Webänderungen. Sie sind keine Aussage über den aktuellen Zustand einer produktiven Installation.

- Typprüfung und Worker-Dry-Run erfolgreich.
- 756 Vitest-Tests in 24 Dateien erfolgreich, einschließlich Versand nach Webänderung ohne weiteren Webhook, Absage, fällig gewordener Einladung, Pausen, abgelehnter Änderungen und unklarem Provider-Ausgang.
- Neun Operator-Tests erfolgreich: Konfigurationsauswahl, Origin-Validierung, Transportfehler und Demo-Journal.
- Formatprüfung und Prüfung lokaler Markdown-Verweise erfolgreich.
- Frische Quellkopie ohne Produktionskonfiguration: Installation mit eingefrorenem Lockfile unter pnpm 11.9.0, vollständiges `pnpm check`, lokale Migrationen und Owner-Bootstrap erfolgreich.
- Der lokale Smoke verwendet isolierten workerd, D1 und Evolution-Mock; er prüft zusätzlich die Zustellung nach einer Webverschiebung ohne anschließendes Chatereignis und den nachfolgenden Cron.
- `pnpm audit --prod`: keine gemeldeten bekannten Schwachstellen zum Prüfzeitpunkt.
- Gitleaks 8.24.3: keine Treffer im bereinigten Quellbaum und in der vorhandenen Git-Historie (`--all`). Ein regelbasierter Scan ist kein Beweis für vollständige Geheimnisfreiheit und keine Prüfung auf personenbezogene Daten.

Geprüft mit Node.js 24.19.0; die frische Installation wurde mit pnpm 11.9.0 geprüft. Die CI ist auf Node.js 24 und pnpm 11.9.0 eingestellt. Der Windows-DPAPI-Test ist als eigener CI-Job ergänzt; er wurde hier unter Linux nicht ausgeführt.

Nicht durch diese Prüfung abgedeckt: neues Cloudflare-Konto, echte Evolution-Version, WhatsApp-Endgeräte, Browser-/Barrierefreiheitsabnahme, produktiver Cronzustand und Wiederherstellung echter Daten. Dafür [ACCEPTANCE.md](ACCEPTANCE.md) auf der eigenen Installation ausfüllen. Historische private Betriebsprotokolle wurden aus dieser Datei entfernt; sie bleiben in älteren Git-Revisionen enthalten.

Ein Live-Deployment wurde hier nicht ausgeführt: Wrangler hat keine authentifizierte Cloudflare-Verbindung. Die GitHub-Sichtbarkeit wurde nicht geändert.
