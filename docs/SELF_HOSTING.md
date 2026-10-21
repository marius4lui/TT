# TT auf dem eigenen Cloudflare-Account

Diese Anleitung installiert TT in deinem Account. Sie setzt eine bereits erreichbare, mit WhatsApp verbundene Evolution-API-Instanz voraus. Alle Domains und IDs in Beispielen sind Platzhalter. Für eine bestehende Installation zuerst den Abschnitt „Updates“ lesen.

## Voraussetzungen

- Node.js 24 und pnpm 11.9.0, Git und ein Terminal.
- Cloudflare-Account mit Berechtigung für Workers, D1 und Worker-Secrets. Limits und mögliche Kosten im eigenen Account prüfen; TT garantiert keinen kostenlosen Betrieb.
- Eigene Evolution-Instanz und Botnummer, API-Key und eine öffentliche HTTPS-Basisadresse.
- Für eine eigene Domain: passende DNS-Zone bei Cloudflare. Alternativ genügt `workers.dev`.

## 1. Quellcode und lokale Prüfung

```sh
git clone https://github.com/marius4lui/TT.git
cd TT
pnpm install --frozen-lockfile
pnpm check
pnpm smoke
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Bei mehreren Accounts die beabsichtigte `account_id` in deiner Produktionskonfiguration ergänzen. Automatisierung kann die von Wrangler unterstützten Cloudflare-Umgebungsvariablen verwenden; Tokens gehören in einen Secret Store, nicht ins Repository.

## 2. Eigene Konfiguration und D1 anlegen

```sh
cp wrangler.jsonc wrangler.production.jsonc
pnpm exec wrangler d1 create tt --jurisdiction eu --config wrangler.production.jsonc
```

Unter PowerShell statt `cp` bei Bedarf `Copy-Item wrangler.jsonc wrangler.production.jsonc` verwenden. Den ausgegebenen Datenbanknamen und die `database_id` in der **DB-Bindung** der Produktionsdatei eintragen; `binding: "DB"` bleibt erhalten. Die Null-ID der Vorlage ist keine produktive Datenbank.

In `wrangler.production.jsonc` setzen:

- `name`: eigener eindeutiger Workername, zum Beispiel `tt-verein`.
- `vars.EVOLUTION_URL`: HTTPS-Adresse deiner Evolution-API, ohne Schlüssel in der URL.
- `vars.EVOLUTION_INSTANCE`: exakter Name deiner verbundenen Instanz.
- `vars.SOURCE_URL`: öffentlicher Quellcode der installierten Version, bei einem Fork dessen URL bzw. Release/Commit.
- `d1_databases[0].database_id` und `database_name`: die gerade erzeugte D1.

`workers_dev: true` veröffentlicht eine eigene `workers.dev`-Adresse. Für eine Custom Domain stattdessen beispielsweise `"routes": [{ "pattern": "training.example.org", "custom_domain": true }]` ergänzen und `workers_dev` nach Bedarf abschalten. Wähle eine kanonische Adresse für Login und Links; andere Hosts werden für geschützte Schreibzugriffe nicht akzeptiert.

```sh
pnpm db:migrate:remote
pnpm deploy
```

Beide Befehle verwenden ausdrücklich `wrangler.production.jsonc`. Beim ersten Deploy die ausgegebene öffentliche HTTPS-Adresse notieren. Der Worker ist noch nicht mit WhatsApp verbunden und die Trainingsautomatik bleibt aus. `GET /health` muss nach den Migrationen `status: ok` liefern.

## 3. Evolution verbinden und Owner einrichten

Lade `EVOLUTION_URL`, `EVOLUTION_INSTANCE` und `EVOLUTION_API_KEY` in die **Prozessumgebung**. URL und Instanz müssen exakt zur Produktionsdatei passen. Das separate Node-Skript lädt `.dev.vars` nicht automatisch.

Beispiel für Bash, mit verdeckter Schlüsseleingabe:

```bash
export EVOLUTION_URL='https://evolution.example.org'
export EVOLUTION_INSTANCE='tt'
read -r -s -p 'Evolution API-Key: ' EVOLUTION_API_KEY
export EVOLUTION_API_KEY
node scripts/setup.mjs --remote --connect --origin https://training.example.org
unset EVOLUTION_API_KEY
```

Ersetze die Origin durch deine tatsächliche Custom Domain oder `workers.dev`-Adresse. Unter Windows steht zusätzlich die [verschlüsselte Eingabe](CREDENTIALS.md) zur Verfügung.

Das Skript prüft die verbundene Instanz und ihre Botidentität, speichert die kanonische Adresse in D1, setzt den Worker-API-Key als Secret und registriert einen authentifizierten Webhook. Es zeigt einen 30 Minuten gültigen Befehl `/einrichten CODE`. Diesen **privat an die eigene Botnummer** schicken und mit `JA` bestätigen. Anschließend `/login` schreiben und den persönlichen Link öffnen. Die Website verlangt vor dem Login eine ausdrückliche Bestätigung.

Ein vorhandener fremder Webhook wird abgelehnt. `--replace-webhook` ist ausschließlich für einen bewusst gewählten Ersatz vorgesehen. Ein abgeschlossener Owner-Bootstrap wird niemals zurückgesetzt. Ein abgelaufener, unvollständiger Versuch kann mit `--reset-bootstrap` erneuert werden. `--config DATEI` oder `TT_CONFIG` wählt bei Bedarf eine andere Wrangler-Datei; die normale Remote-Vorgabe ist `wrangler.production.jsonc`.

## 4. Gruppe und Trainingsbetrieb

1. Als Owner im Trainerbereich anmelden.
2. Eigene Testgruppe über den Gruppenlink anfragen und freigeben. Freigabe kann Beitritt und Begrüßung auslösen.
3. Trainingsserie oder Einzeltermin und öffentliche Trainingsinformationen eintragen.
4. Verantwortliche Stelle und passende Datenschutzhinweise hinterlegen und deren Veröffentlichung bestätigen.
5. Die [Abnahme](ACCEPTANCE.md) mit eigenen Testgeräten durchführen.
6. Trainingsnachrichten im Trainerbereich bewusst aktivieren.

Trainer brauchen kein Teilnehmerkonto. Registrierung und persönliche Mitgliedererinnerungen werden jeweils getrennt und freiwillig bestätigt.

## Evolution API

TT verwendet den Evolution-API-Vertrag unter anderem für `instance/connectionState`, `instance/fetchInstances`, `webhook/find`, `webhook/set`, `message/sendText`, `message/sendReaction` sowie Gruppenabfragen und Gruppenbeitritte. Der Adapter liegt in `packages/whatsapp/src/index.ts`.

Erforderliche Webhook-Ereignisse: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `GROUP_PARTICIPANTS_UPDATE`, `GROUPS_UPSERT`. Der gemeinsame Endpoint lautet `https://DEINE-ADRESSE/webhooks/evolution`; `byEvents` muss aus sein. Evolution muss einen konfigurierbaren `Authorization: Bearer …`-Header senden und ihn beim Setup-Readback bestätigen können. Ein Provider ohne diese Eigenschaften wird nicht unterstützt.

Eine bestimmte Evolution-Version oder jedes Baileys-/WhatsApp-Verhalten wird derzeit nicht pauschal zugesichert. Dokumentiere die tatsächlich verwendete Version und teste Anmeldung, Reaktionen, Gruppenfreigabe und Zustellung auf den vorgesehenen Geräten. TT bringt kein Evolution-Hosting mit. Eine alternative offizielle WhatsApp-Anbindung ist nicht implementiert.

## Updates

1. Im Trainerbereich Trainingssendungen pausieren. Ein Wartungsfenster wählen, wenn gleichzeitig Termine geändert werden könnten.
2. Datenbank sichern und Wiederherstellungspunkt notieren; siehe [Betrieb](OPERATIONS.md).
3. Neue Version holen, Releasehinweise lesen, `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm format:check` und `pnpm smoke` ausführen.
4. Eigene `wrangler.production.jsonc` mit der neuen Vorlage vergleichen. Sie wird von Git nicht überschrieben.
5. `pnpm db:migrate:remote`, dann `pnpm deploy` ausführen. Worker-Rollback und Datenbank-Restore sind unterschiedliche Vorgänge.
6. Health, Login, Traineransicht, Cron und eine kontrollierte Teständerung prüfen; anschließend bewusst aktivieren.

Für ein normales Update weder Bootstrap noch Webhook neu einrichten. Bestehende Datenbanken behalten ihre gespeicherte Origin und Botnamen: Die neutralisierten Startwerte in Migration 0001 betreffen nur neue Datenbanken. Frühere Installationen mit produktiven Werten in der versionierten `wrangler.jsonc` müssen diese **vor dem Update** in `wrangler.production.jsonc` sichern.

## Backup und Umzug

D1-Daten, eigene Konfiguration und separat gesicherte Zugangsdaten gehören zusammen. Niemals Backups ins öffentliche Repository legen. Bei Domainwechsel die neue Domain deployen und `setup --remote --connect --origin NEUE-HTTPS-ORIGIN` bewusst ausführen; dies aktualisiert Webhook und kanonische Adresse und pausiert den Betrieb. Offene alte Links können unbrauchbar werden. Die gespeicherte Origin wird nicht automatisch aus einem eingehenden Host-Header übernommen.
