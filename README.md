# TT

TT organisiert Tischtennistraining über WhatsApp. Der Worker verwaltet Trainingsserien, Ausnahmen, Rückmeldungen und Nachrichten; D1 hält den Zustand dauerhaft. Eine kleine öffentliche Website stellt Trainings- und Datenschutzhinweise sowie eine freiwillige WhatsApp-Anmeldung bereit. Ein Konto ist keine Voraussetzung, um am Training teilzunehmen.

Das Repository ist privat. Worker, Website, EU-D1 und Cron sind unter [tt.bz3.eu](https://tt.bz3.eu) veröffentlicht. Evolution ist angeschlossen und eine eigene Demogruppe vorbereitet. Der Trainingsbetrieb bleibt pausiert; Owner-Einrichtung, Datenschutzhinweise und die vollständige WhatsApp-Abnahme stehen noch aus. Die Website ist kein Trainer-Dashboard.

## Stack

- TypeScript, Hono und Cloudflare Workers
- Cloudflare D1 mit versionierten SQL-Migrationen
- Evolution API als externer WhatsApp-Transport
- pnpm Workspace; Worker-Assets unter `apps/web/public`
- Vitest für automatisierte Tests

## Lokale Entwicklung

Voraussetzungen: Node.js 24, pnpm 11.9.0 und Zugriff auf die private Repository-Kopie. Aus dem Repository-Stamm:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:local
pnpm smoke
pnpm dev
```

`pnpm check` führt Typprüfung, Tests und den Worker-Dry-Run aus. `pnpm db:migrate:local` bereitet die lokale D1-Datenbank vor. `pnpm smoke` prüft den Worker mit einem Mock-Evolution-Transport und sendet keine echten WhatsApp-Nachrichten. `pnpm dev` startet Wrangler.

Für echte Evolution-Aufrufe braucht der Worker zur Laufzeit `EVOLUTION_URL`, `EVOLUTION_INSTANCE` und `EVOLUTION_API_KEY`. Lokal liest Wrangler `EVOLUTION_API_KEY` aus der ignorierten Datei `.dev.vars`; `EVOLUTION_URL` und `EVOLUTION_INSTANCE` kommen aus der Wrangler-Konfiguration. Das Node-Setup-Skript läuft separat und liest beim Remote-Verbinden (`--remote --connect`) alle drei Werte aus seiner Prozessumgebung; `.dev.vars` wird dafür nicht automatisch geladen. Zugangsdaten gehören weder in Git noch in Beispielausgaben oder Frontend-Dateien. Der Remote-Setup-Befehl prüft und konfiguriert die externe Instanz, setzt das Worker-Secret und lässt TT pausiert. Er veröffentlicht den Worker nicht.

Nur wenn ein lokaler Bot mit einer verbundenen Evolution-Instanz eingerichtet wird, danach `node scripts/setup.mjs --local` ausführen. Der Befehl erzeugt einen 30 Minuten gültigen Code für die einmalige Owner-Einrichtung. Ohne Provider ist dieser Schritt für `pnpm smoke` und die öffentliche Website nicht erforderlich.

## Repository-Aufbau

```text
apps/worker/       HTTP-Worker, WhatsApp-Verarbeitung und Terminplanung
apps/web/public/   öffentliche HTML-Assets
packages/core/     Zeit-, Termin- und Rückmeldungsregeln
packages/whatsapp/ Evolution-Adapter
migrations/        D1-Schemaänderungen
tests/             gemeinsame Test-Hilfen
docs/              Betrieb und Abnahme
```

## Trainerbefehle

Die dauerhafte verschlüsselte Evolution-Eingabe startet mit `Evolution-Zugangsdaten.cmd`.
Prüfung, Einrichtung und echte Demogruppe sind in [docs/CREDENTIALS.md](docs/CREDENTIALS.md) beschrieben.

Die Befehle und Setup-Varianten stehen in [docs/OPERATIONS.md](docs/OPERATIONS.md). Änderungen an Terminen werden vor der Übernahme bestätigt. Lokale Checks und der Mock-Smoketest belegen keinen echten Evolution-/WhatsApp-Betrieb; die Live-Abnahme bleibt vor einem produktiven Einsatz erforderlich.

## Freigabe

Die bereits ausgeführten Prüfungen und ihre Grenzen stehen in [docs/VALIDATION.md](docs/VALIDATION.md).

CI führt Prüfungen aus, veröffentlicht aber nichts. Das Hosting wurde manuell veröffentlicht und über HTTPS geprüft. WhatsApp-Betrieb erst nach Evolution-Einrichtung, veröffentlichten und geprüften Datenschutzhinweisen sowie erfolgreicher Testgruppen-Abnahme freigeben. Die offenen Fälle stehen in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
