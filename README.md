# TT · Tischtennistraining über WhatsApp

TT organisiert Trainings, Zusagen, Absagen und Verspätungen für eure Tischtennisgruppe. Trainer verwalten Termine im Web; Mitglieder antworten in WhatsApp mit 👍, 👎 und ⏰. Ein Mitgliederkonto ist freiwillig.

**Eigene Installation auf Cloudflare Workers und D1**, mit einer eigenen Evolution-API-Instanz als WhatsApp-Anbindung. Die Oberfläche und die regelbasierte Chaterkennung sind deutsch. TT benötigt keinen KI-Dienst.

## Funktionen

- Wöchentliche Serien und Einzeltermine, Verschiebungen, Absagen und Pausen.
- Gruppenfreigabe, Teilnahmeübersicht und persönliche Trainerübersichten.
- Einmalige Anmeldelinks aus WhatsApp, aktuelle Rollenprüfung und freiwillige Erinnerungen.
- Dauerhafte Eingangs- und Versandwarteschlangen mit Schutz vor mehrfacher Verarbeitung.
- Sofortiger Versand fälliger Nachrichten nach Webänderungen; Minuten-Cron für geplante Erinnerungen und Wiederanlauf.
- Öffentliche Trainingsinformationen und selbst gepflegte Datenschutzhinweise.

## Selbst betreiben

Du benötigst einen Cloudflare-Account mit Workers und D1, Node.js 24, pnpm 11.9.0 sowie eine verbundene Evolution-API-Instanz mit eigener Botnummer und API-Key. TT stellt den Anwendungscode bereit; Cloudflare und WhatsApp bleiben externe Dienste. Ein eigenständiger Docker-/VPS-Betrieb von TT wird derzeit nicht unterstützt. Evolution wird separat betrieben oder bezogen.

Die vollständige Einrichtung inklusive Datenbank, Deployment, Webhook und erstem Admin steht in **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**. Eine eigene Domain ist optional; eine HTTPS-Adresse unter `workers.dev` genügt.

```sh
git clone https://github.com/marius4lui/TT.git
cd TT
pnpm install --frozen-lockfile
pnpm check
pnpm smoke
```

Die Checks und der Smoke-Test brauchen keinen Cloudflare-Account und senden keine echten WhatsApp-Nachrichten. Für die produktive Einrichtung anschließend der Hosting-Anleitung folgen. Die mitgelieferte `wrangler.jsonc` ist eine neutrale Vorlage; eigene Produktionswerte liegen in der ignorierten `wrangler.production.jsonc`.

## Lokal entwickeln

```sh
pnpm db:migrate:local
pnpm dev
```

Die öffentliche Website läuft lokal unter `http://localhost:8787`. Der lokale Start erzeugt keine produktive WhatsApp-Verbindung. Für den vollständigen Ablauf verwendet `pnpm smoke` einen isolierten Worker, eine eigene lokale D1 und einen Evolution-Mock. `pnpm run setup --local` bereitet optional die lokale Owner-Einrichtung vor; ein echtes Login benötigt anschließend einen passenden Transport.

| Befehl              | Zweck                                                          |
| ------------------- | -------------------------------------------------------------- |
| `pnpm check`        | Typen, Tests, Operator-Tests und Worker-Dry-Run                |
| `pnpm smoke`        | Lokaler Integrationstest mit echtem workerd und Mock-Transport |
| `pnpm format:check` | Formatierung prüfen                                            |
| `pnpm test:watch`   | Tests während der Entwicklung                                  |
| `pnpm build`        | Worker bauen, ohne ihn zu veröffentlichen                      |

## Dokumentation

- [Installation und Updates](docs/SELF_HOSTING.md)
- [Konfiguration](docs/CONFIGURATION.md)
- [Architektur und Nachrichtenverarbeitung](docs/ARCHITECTURE.md)
- [Betrieb, Backup und Fehlerdiagnose](docs/OPERATIONS.md)
- [Datenspeicherung und Datenschutz](docs/PRIVACY.md)
- [Abnahme vor Trainingsbetrieb](docs/ACCEPTANCE.md)
- [Beiträge](CONTRIBUTING.md), [Sicherheitsmeldungen](SECURITY.md), [Änderungen](CHANGELOG.md)
- [Stand der Open-Source-Vorbereitung](docs/OPEN_SOURCE_READINESS.md)

## Grenzen und Projektstatus

TT ist eine frühe Version. Lokale Tests belegen nicht die Zustellung auf echten WhatsApp-Geräten. Die Kompatibilität einer Evolution-Version muss anhand der [Integrationsanforderungen](docs/SELF_HOSTING.md#evolution-api) geprüft werden; eine verifizierte Versionsmatrix liegt noch nicht vor. WhatsApp ist ein Dienst von Meta, und TT ist kein offizielles WhatsApp-Produkt. Die Regeln und Einschränkungen des verwendeten WhatsApp-Transports gelten zusätzlich.

Klare deutsche Aussagen werden anhand begrenzter Muster erkannt. Mehrdeutige Angaben führen zu Rückfragen; TT versteht keine beliebige natürliche Sprache. Gruppenreaktionen erzeugen keine zusätzliche Bestätigung. Eindeutige Textmeldungen können eine kurze Antwort erhalten.

## Lizenz

Copyright © 2026 TT contributors. TT steht unter **[GNU AGPL-3.0-only](LICENSE)**. Die Paketmarkierung `private: true` verhindert eine versehentliche npm-Veröffentlichung und schränkt die Open-Source-Lizenz nicht ein.

Wenn du eine veränderte Version als Netzwerkdienst anbietest, musst du den Nutzern nach Maßgabe der AGPL den dazugehörigen Quellcode zugänglich machen. Setze `SOURCE_URL` auf den öffentlich erreichbaren Quellcode deiner tatsächlich betriebenen Version. Die Website verlinkt ihn über „Quellcode“. [Lizenzen externer Laufzeitabhängigkeiten](THIRD_PARTY_NOTICES.md) gelten zusätzlich.
