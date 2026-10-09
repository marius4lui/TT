# TT

TT organisiert Tischtennistraining über WhatsApp. Der Worker verwaltet Trainingsserien, Ausnahmen, Rückmeldungen und Nachrichten; D1 hält den Zustand dauerhaft. Die Website bietet öffentliche Hinweise, ein freiwilliges Mitgliederkonto und den geschützten Trainerbereich. Teilnahme und Rückmeldungen brauchen kein Webkonto.

Das Repository ist privat. Worker, Website, EU-D1 und Cron sind unter [tt.bz3.eu](https://tt.bz3.eu) veröffentlicht. Evolution ist angeschlossen; Owner, eigene Demogruppe und Datenschutzhinweis wurden im bisherigen privaten Funktionstest bestätigt. Der Trainingsbetrieb bleibt pausiert. Die neue Verwaltung über die Website ist lokal geprüft; ihre Veröffentlichung und die vollständige Abnahme mit echten WhatsApp-Geräten stehen noch aus.

## Anmeldung und Trainingsalltag

Schreib dem Bot privat „anmelden“ oder `/login`. Du erhältst einen einmaligen, zehn Minuten gültigen Anmeldelink. Die Website zeigt zuerst deine erkannte Identität; erst dein ausdrücklicher Klick meldet dich an. Der Link ermöglicht die Anmeldung und darf nicht weitergegeben werden. Trainer mit Owner- oder Admin-Rolle gelangen direkt nach `/trainer`, ohne sich als Teilnehmer registrieren zu müssen.

Trainer verwalten dort Serien, einzelne Termine, Verschiebungen, Absagen, Pausen, Rückmeldungen und öffentliche Hinweise. Ein Gruppenlink erzeugt zuerst eine Freigabeanfrage. Auch wenn der Bot direkt einer Gruppe hinzugefügt wird, braucht die Gruppe eine ausdrückliche Trainerfreigabe. Danach erhält sie einmalig eine Begrüßung mit „Powered by KMUC“. Trainingsnachrichten starten pausiert und werden im Trainerbereich bewusst aktiviert.

Mitglieder antworten mit 👍 oder 👎 auf die Trainingsabfrage und mit ⏰ auf die Verspätungsabfrage. Gruppenreaktionen erzeugen keine zusätzliche Antwortnachricht. Private Sätze wie „Ich komme zehn Minuten später“ werden anhand begrenzter deutscher Muster erkannt; bei Mehrdeutigkeit fragt TT nach. Freiwillige Registrierung und persönliche Mitgliedererinnerungen werden auf der Website getrennt bestätigt. Persönliche Trainerübersichten sind ebenfalls freiwillig und funktionieren ohne Teilnehmerregistrierung; voreingestellt sind zehn Minuten vor Beginn.

Websessions gelten höchstens sieben Tage; Trainersessions enden zusätzlich nach 24 Stunden ohne Aktivität. Konto, Zustimmungen und Mitgliedererinnerungen werden auf `/konto` verwaltet. Ältere Chatbefehle bleiben als Kompatibilität erhalten; der normale Ablauf führt über die Website.

## Stack und Aufbau

- TypeScript, Hono und Cloudflare Workers
- Cloudflare D1 mit versionierten SQL-Migrationen
- Evolution API als externer WhatsApp-Transport
- pnpm Workspace und Vitest

```text
apps/worker/       HTTP-Worker, WhatsApp-Verarbeitung und Terminplanung
apps/web/public/   Web-Assets
packages/core/     Zeit-, Termin- und Rückmeldungsregeln
packages/whatsapp/ Evolution-Adapter
migrations/        D1-Schemaänderungen
tests/             Integrationstests und Test-Hilfen
docs/              Betrieb und Abnahme
```

## Lokale Entwicklung

Voraussetzungen: Node.js 24, pnpm 11.9.0 und die private Repository-Kopie. Aus dem Repository-Stamm:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:local
pnpm smoke
pnpm dev
```

`pnpm check` führt Typprüfung, Tests, Operator-Tests und den Worker-Dry-Run aus. `pnpm db:migrate:local` bereitet die lokale D1-Datenbank vor. `pnpm smoke` prüft den echten lokalen Worker mit einer isolierten D1 und einem Mock-Evolution-Transport; dabei gehen keine echten WhatsApp-Nachrichten heraus. `pnpm dev` startet Wrangler.

Für echte Evolution-Aufrufe benötigt der Worker `EVOLUTION_URL`, `EVOLUTION_INSTANCE` und `EVOLUTION_API_KEY`. Lokal liest Wrangler den API-Key aus der ignorierten Datei `.dev.vars`; URL und Instanz kommen aus der Wrangler-Konfiguration. Das separate Node-Setup-Skript liest beim Remote-Verbinden alle drei Werte aus der Prozessumgebung; `.dev.vars` wird dafür nicht automatisch geladen. Zugangsdaten gehören weder in Git noch in Beispielausgaben oder Frontend-Dateien.

## Einrichtung und Freigabe

Die dauerhafte verschlüsselte Evolution-Eingabe startet mit `Evolution-Zugangsdaten.cmd`. Prüfung und bisherige Demoeinrichtung stehen in [docs/CREDENTIALS.md](docs/CREDENTIALS.md). Setup, Webhook und Betrieb sind in [docs/OPERATIONS.md](docs/OPERATIONS.md) beschrieben. Eine neue Instanz benötigt die einmalige Owner-Einrichtung; die bestehende Demoinstanz wird nicht neu eingerichtet.

Lokale Checks und der Mock-Smoketest sind erfolgreich gelaufen, weitere Integrationstests begleiten die neue Version. CI veröffentlicht nichts; der bekannte Abrechnungshinweis blockiert derzeit einen erfolgreichen CI-Lauf. Das bisherige Hosting wurde manuell veröffentlicht und über HTTPS geprüft. Frühere Nachweise stehen in [docs/VALIDATION.md](docs/VALIDATION.md) und gelten für die dort bezeichnete Version.

Den regulären Nachrichtenbetrieb erst nach geprüften Datenschutzhinweisen und erfolgreicher Abnahme mit echten WhatsApp-Geräten freigeben. Die offenen Fälle stehen in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
