# Zu TT beitragen

Danke für Beiträge zu TT. Oberfläche, Benutzertexte und Dokumentation sind derzeit deutsch; klare englische Fehlerberichte und Pull Requests sind ebenfalls willkommen.

## Entwicklung

Node.js 24 und pnpm 11.9.0 verwenden. Nach `pnpm install --frozen-lockfile`:

```sh
pnpm check
pnpm format:check
pnpm smoke
```

Der Smoke arbeitet mit lokalem workerd, isolierter D1 und Evolution-Mock. Keine echten Zugangsdaten oder WhatsApp-Nachrichten sind für Beiträge erforderlich. `pnpm test:credentials` ist ein optionaler Windows-/PowerShell-Test für die DPAPI-Helfer.

## Änderungen

- Kleine, nachvollziehbare Änderungen mit Beschreibung des Problems und überprüftem Verhalten einreichen.
- Bei Änderungen an Rückmeldungen, Terminversionen, Authentifizierung oder Versand passende Regressionstests ergänzen. Mehrdeutige Sprache und Gegenbeispiele mitprüfen.
- Datenbankschema durch neue nummerierte Migrationen erweitern. Bereits ausgelieferte Migrationen nicht nachträglich für Bestandsdaten umdeuten.
- Keine produktiven IDs, Telefonnummern, Screenshots mit Teilnehmerdaten, Secrets oder Datenbankkopien einchecken. Beispiele verwenden reservierte Domains wie `example.org`.
- Dokumentation und CHANGELOG bei sichtbaren Verhaltensänderungen aktualisieren.
- Keine automatischen echten Nachrichten oder Deployments in Tests oder CI.

Beiträge werden unter der Projektlizenz AGPL-3.0-only eingereicht. Reiche nur Inhalte ein, die du unter dieser Lizenz bereitstellen darfst; fremde Lizenz- und Copyright-Hinweise bleiben erhalten. Für Sicherheitslücken gilt [SECURITY.md](SECURITY.md).
