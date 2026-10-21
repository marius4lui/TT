# Lizenzen externer Laufzeitabhängigkeiten

TT selbst ist AGPL-3.0-only. Die folgenden Pakete werden in der Laufzeit verwendet und behalten ihre eigenen Lizenzbedingungen und Copyright-Hinweise. Die Originaltexte der aktuell gesperrten Versionen liegen in `docs/licenses/`.

| Paket                   | Version | Lizenztext                                 |
| ----------------------- | ------- | ------------------------------------------ |
| `@js-temporal/polyfill` | 0.5.1   | [ISC](docs/licenses/temporal-polyfill.txt) |
| `jsbi` (über Temporal)  | 4.3.2   | [Apache-2.0](docs/licenses/jsbi.txt)       |
| `hono`                  | 4.13.13 | [MIT](docs/licenses/hono.txt)              |
| `zod`                   | 4.6.5   | [MIT](docs/licenses/zod.txt)               |

Entwicklungswerkzeuge, Cloudflare und Evolution sind davon getrennt. Das Lockfile dokumentiert die verwendeten Paketversionen; die jeweiligen Pakete enthalten ihre Lizenztexte. Bei Abhängigkeitsupdates diese Hinweise und die mitgelieferten Texte mitprüfen. Werden gebaute Artefakte weitergegeben, die einschlägigen Lizenz- und Copyright-Hinweise beilegen.
