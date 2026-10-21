# Konfiguration

`wrangler.jsonc` ist die versionierte Vorlage und lokale Konfiguration. `wrangler.production.jsonc` ist die ignorierte, private Produktionskonfiguration. `pnpm deploy` und `pnpm db:migrate:remote` verwenden nur die zweite Datei. Cloudflare-Anmeldedaten verwaltet Wrangler separat.

| Wert                            | Ort                                         | Zweck                                                                 |
| ------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| Workername, optional Account-ID | Produktionskonfiguration                    | Eigenes Deployment-Ziel                                               |
| DB-Bindung, Datenbankname/-ID   | Produktionskonfiguration                    | Eigene D1, Binding heißt immer `DB`                                   |
| `ASSETS`                        | Wrangler-Assets-Konfiguration               | CSS, JavaScript und Favicon                                           |
| Domain bzw. `workers_dev`       | Produktionskonfiguration                    | Öffentliche HTTPS-Adresse                                             |
| `EVOLUTION_URL`                 | Wrangler `vars` und Setup-Prozessumgebung   | Basisadresse des Transports                                           |
| `EVOLUTION_INSTANCE`            | Wrangler `vars` und Setup-Prozessumgebung   | Eigene Botinstanz                                                     |
| `EVOLUTION_API_KEY`             | Worker-Secret; lokal optional `.dev.vars`   | Transportzugriff, niemals in `vars`                                   |
| `SOURCE_URL`                    | Wrangler `vars`                             | Öffentlich erreichbarer entsprechender Quellcode; Link über `/source` |
| `origin`                        | D1 `settings`, gesetzt mit Setup `--origin` | Kanonische Adresse für Login, Links und Origin-Prüfung                |
| `webhook_token_hash`            | D1 `settings`, automatisch                  | Hash des zufälligen Webhook-Bearer-Tokens                             |
| `bot_jid`                       | D1 `settings`, automatisch                  | Vom Provider bestätigte Botidentität                                  |
| `enabled`, `privacy_ready`      | Trainerbereich / D1                         | Explizite Freigabe des Nachrichtenbetriebs                            |
| `TT_CONFIG`                     | Optional im Operator-Prozess                | Alternative Wrangler-Datei für Setup und Windows-Helfer               |
| `TT_ORIGIN`                     | Windows-Setup-Prozess                       | Öffentliche HTTPS-Adresse für `evolution.ps1 -Action Setup`           |

Die Vorlage enthält keine produktiven IDs oder Zugangsdaten. `.dev.vars.example` enthält nur das Format für die lokale Entwicklung. `pnpm smoke` braucht keine dieser echten Zugangsdaten.

Der öffentliche Quellcode-Link akzeptiert ausschließlich HTTPS ohne eingebettete Zugangsdaten. Forks müssen `SOURCE_URL` auf den Quellcode ihrer betriebenen Version setzen. Der voreingestellte Link auf das Ursprungsprojekt genügt nicht für eigene unveröffentlichte Änderungen.

Trainertexte, Gruppe und Freigaben werden im Web gepflegt. Zeitregeln verwenden aktuell `Europe/Berlin`; eine frei wählbare Zeitzone wird in der Traineroberfläche noch nicht angeboten. Die Sprachregeln sind deutsch. Eine Installation verwaltet eine Organisation mit mehreren Gruppen; dies ist keine getrennte Mandantenplattform.
