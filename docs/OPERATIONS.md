# Betrieb

Dieses Dokument beschreibt den vorhandenen Code und die Setup-Befehle. Es bestätigt weder eine produktive Einrichtung noch eine echte WhatsApp-Abnahme. Es ist noch keine neue Rufnummer oder Evolution-Instanz provisioniert und kein Worker veröffentlicht. Vor Einsatz die Schritte aus [ACCEPTANCE.md](ACCEPTANCE.md) mit einer eigens ausgewählten Testgruppe durchführen.

## Voraussetzungen und Konfiguration

TT benötigt einen Cloudflare Worker, eine gebundene D1-Datenbank, die statischen Assets aus `apps/web/public`, einen Cronlauf pro Minute und eine erreichbare Evolution-Instanz. `wrangler.jsonc` enthält derzeit eine Platzhalter-Datenbank-ID und eine Beispiel-URL. Vor einem Remote-Setup oder späterem Deploy müssen D1 angelegt und die Datenbank-ID sowie `EVOLUTION_URL` und `EVOLUTION_INSTANCE` im Wrangler-Konfigurationsziel angepasst werden. Es ist derzeit keine Produktionskonfiguration vorhanden.

Der Worker benötigt zur Laufzeit:

- `EVOLUTION_URL`: Basis-URL der Evolution-API
- `EVOLUTION_INSTANCE`: geprüfter Instanzname, wie ihn die API erwartet
- `EVOLUTION_API_KEY`: Evolution-Zugangsschlüssel; als Secret behandeln

Für Wrangler lokal kommt `EVOLUTION_API_KEY` aus `.dev.vars`; diese Datei ist durch `.gitignore` ausgeschlossen und bleibt lokal. Das Einrichten der lokalen Worker-Umgebung und das Starten eines Node-Skripts sind getrennte Prozesse: `.dev.vars` wird nicht automatisch in die Prozessumgebung von `scripts/setup.mjs` übernommen. `--remote --connect` liest alle drei Werte aus der Prozessumgebung. Auf Cloudflare wird `EVOLUTION_API_KEY` als Worker-Secret gesetzt; der API-Key darf nicht in `vars`, `wrangler.jsonc`, GitHub-Dateien oder das Frontend geschrieben werden. Zugangsdaten und vollständige Webhook-Payloads gehören nicht in Logs.

## D1 und Worker

1. Vor jeder lokalen Entwicklung Abhängigkeiten installieren und `pnpm check` ausführen.
2. Lokales Schema mit `pnpm db:migrate:local` anwenden. Das ändert die lokale Wrangler-Datenbank.
3. Für eine gezielte Remote-Migration ist `pnpm db:migrate:remote` vorhanden. Vorher Zielkonto und Datenbank-ID kontrollieren sowie einen geeigneten Wiederherstellungspunkt erfassen. Ein Worker-Rollback setzt D1 nicht zurück.
4. `pnpm dev` startet Wranglers lokalen Worker. Das allein beweist weder Evolution-Erreichbarkeit noch Ende-zu-Ende-Nachrichten.

Die erste Migration setzt `enabled=0` und `privacy_ready=0`; geplante Nachrichten bleiben laut Worker-Sendelogik gesperrt, bis beides freigegeben wurde. Die verantwortliche Stelle richtet die abgestimmten Hinweise per `/datenschutz TEXT` ein und bestätigt die Änderung. Erst dieser bestätigte Vorgang setzt `privacy_ready`; den Datenbankwert nicht manuell ändern.

## Setup-CLI und Webhook

Migrationen zuerst auf das ausdrücklich gewählte D1-Ziel anwenden. Die lokalen Befehle lauten:

```sh
node scripts/setup.mjs --local
```

`--local` legt einen zufälligen Bootstrap-Code mit 30 Minuten Laufzeit in der lokalen D1-Datenbank ab und zeigt `/einrichten CODE` an. Dieser Code wird privat an den Bot geschickt und danach mit `JA` bestätigt. Ein abgebrochener oder abgelaufener Versuch kann bewusst mit `pnpm run setup --local --reset-bootstrap` zurückgesetzt werden; eine abgeschlossene Owner-Einrichtung wird niemals zurückgesetzt.

Für D1 in Cloudflare:

```sh
node scripts/setup.mjs --remote
node scripts/setup.mjs --remote --connect
```

`--remote` erzeugt den Bootstrap-Code in der bereits migrierten Remote-Datenbank. `--remote --connect` verlangt `EVOLUTION_URL`, `EVOLUTION_INSTANCE` und `EVOLUTION_API_KEY` ausschließlich in der Prozessumgebung. Das Skript prüft die HTTPS-API und verbundene Instanz, liest die Botnummer aus Evolution, prüft einen eventuell vorhandenen Webhook, speichert den Hash eines neuen zufälligen Bearer-Tokens in D1, setzt `EVOLUTION_API_KEY` als Cloudflare-Worker-Secret und richtet den authentifizierten Evolution-Webhook ein. Beim Readback prüft es URL, Aktivierung, `Authorization: Bearer …` und die Ereignisse `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE` und `GROUP_PARTICIPANTS_UPDATE`; außerdem muss das Routing `byEvents` ausgeschaltet sein. Falls für die Instanz bereits ein anderer Webhook aktiv ist, bricht es ab; nur mit `--replace-webhook` wird der Austausch ausdrücklich erlaubt.

Das Skript sendet keine WhatsApp-Nachrichten und aktiviert TT nicht. Es setzt den Nachrichtenbetrieb auf pausiert; erst `/aktivieren` gibt ihn nach dem Einrichten und Prüfen der Datenschutzhinweise frei. Für `--connect` müssen `EVOLUTION_URL` und `EVOLUTION_INSTANCE` außerdem zu derselben Instanz in `wrangler.jsonc` passen. Das Skript deployed den Worker nicht. Vor Remote-Ausführung Datenbank, Konto, Instanz und Auswirkungen prüfen. CI deployed ebenfalls nicht; ein manueller Deploy darf erst nach Ersetzen der Platzhalter, Anlegen der Ressourcen und Abschluss der Freigabe erfolgen.

Das Kommando ist in `package.json` als `setup` eingetragen. Verwende `pnpm run setup --local` (oder `pnpm run setup --remote --connect`); `pnpm setup` kollidiert mit einer pnpm-Abkürzung. Der direkte Aufruf `node scripts/setup.mjs --local` ist ebenfalls eindeutig. Alle unterstützten Flags stehen mit `node scripts/setup.mjs --help` bereit.

| Option              | Wirkung                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `--local`           | lokale D1 verwenden und Bootstrap-Code erzeugen                                    |
| `--remote`          | Remote-D1 verwenden und Bootstrap-Code erzeugen                                    |
| `--connect`         | nur zusammen mit `--remote`; Evolution-Verbindung prüfen und Webhook einrichten    |
| `--reset-bootstrap` | einen nicht abgeschlossenen Einrichtungsversuch bewusst neu beginnen               |
| `--replace-webhook` | nur zusammen mit Remote-Verbindung einen vorhandenen abweichenden Webhook ersetzen |
| `--help`            | Hilfe ohne Setup-Aktion anzeigen                                                   |

## WhatsApp-Befehle

Der hier aufgeführte Vertrag ist der vorgesehene Produktumfang. Nicht aufgeführte Optionen oder zusätzliche Bestätigungsregeln sind nicht zugesichert. Schreib Befehle für die Verwaltung privat an den Bot. Im Gruppenkontext keine Einrichtungscodes oder Login-Codes senden.

| Befehl                                      | Verwendung                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/hilfe`                                    | Hilfe und verfügbare Befehle anzeigen                                                                                                            |
| `/gruppen`                                  | erkannte Gruppen zur Auswahl anzeigen                                                                                                            |
| `/gruppe JID`                               | Trainingsgruppe anhand ihrer WhatsApp-JID festlegen                                                                                              |
| `/training`                                 | Dialog zur wöchentlichen Trainingsserie starten; Gruppe, Wochentag, Zeiten und Ort durchgehen                                                    |
| `/termine`                                  | kommende Termine anzeigen                                                                                                                        |
| `/ausfall DATE` oder `/ausfall ID`          | einzelnen Termin auswählen und absagen                                                                                                           |
| `/pause FROM TO`                            | Serie für einen Zeitraum aussetzen                                                                                                               |
| `/verschieben DATE NEWDATE TIME`            | Termin auf neues Datum und Uhrzeit verschieben                                                                                                   |
| `/sondertraining DATE START END [LOCATION]` | zusätzlichen Einzeltermin anlegen; Ort ist optional                                                                                              |
| `/übersicht`                                | Rückmeldungen und Verspätungen für einen Termin anzeigen                                                                                         |
| `/info TEXT`                                | öffentlichen Trainingstext setzen                                                                                                                |
| `/datenschutz TEXT`                         | Datenschutzhinweise setzen                                                                                                                       |
| `/aktivieren` / `/deaktivieren`             | TT-Nachrichtenbetrieb aktivieren oder anhalten                                                                                                   |
| `/status`                                   | Betriebs- und Versandstatus prüfen                                                                                                               |
| `/nachricht ID wiederholen`                 | fehlgeschlagene oder unklare Nachricht nach Prüfung manuell erneut senden; bei unklarem Ergebnis kann eine doppelte WhatsApp-Nachricht entstehen |
| `/bestätigen` / `/abbrechen`                | die ausstehende Änderung übernehmen oder verwerfen                                                                                               |
| `/ja TERMIN` / `/nein TERMIN`               | persönlich für einen Termin zu- oder absagen                                                                                                     |
| `/spät TERMIN [MINUTEN]`                    | persönliche Verspätung melden; alternativ mit `⏰` auf die Verspätungsnachricht reagieren                                                        |
| `/pünktlich TERMIN`                         | persönliche Verspätungsmeldung für den Termin zurücknehmen                                                                                       |
| `/serie beenden ID`                         | eine wöchentliche Trainingsserie beenden und die betroffenen Zukunftstermine absagen                                                             |
| `/einrichten CODE`                          | einmalige Einrichtung anfordern; die erste Owner-Rolle wird danach separat mit `JA` oder `NEIN` bestätigt                                        |
| `/admin`                                    | Rollen und offene Einladungen anzeigen                                                                                                           |
| `/admin einladen` / `/admin übertragen`     | Admin-Einladung oder Owner-Übertragung starten                                                                                                   |
| `/admin CODE`                               | Einladung als konkrete WhatsApp-Identität annehmen                                                                                               |
| `/admin bestätigen ID`                      | als Owner die angezeigte WhatsApp-Identität einer Einladung prüfen; anschließend `JA` oder `NEIN`                                                |
| `/admin entfernen USER-ID`                  | als Owner eine angezeigte Admin-Identität zum Entfernen auswählen; anschließend `JA` oder `NEIN`                                                 |
| `/login`                                    | freiwilliges Konto anlegen oder Web-Anmeldung öffnen                                                                                             |
| `/start` / `/stop`                          | persönliche Erinnerungen nach separatem Opt-in einschalten oder widerrufen                                                                       |
| `/konto` / `/daten` / `/löschen`            | Konto anzeigen, Auskunft starten oder Kontolöschung anfragen; Bestätigung per `JA` oder `NEIN`                                                   |

Datumsbeispiele verwenden ISO-Format `YYYY-MM-DD`, Uhrzeiten `HH:mm`. `/training` ist ein Dialog; für eine tatsächliche Änderung die angezeigte Zusammenfassung prüfen und ausdrücklich bestätigen. Die Teilnahme ist unabhängig von einem TT-Konto. Persönliche Erinnerungen brauchen eine separate freiwillige Zustimmung und können widerrufen werden.

Bei Anmelde-, Einrichtungs-, Einladungs- und Löschdialogen wird die Bestätigung als direkte Nachricht `JA` oder `NEIN` erwartet. `/bestätigen` und `/abbrechen` gehören zum ausstehenden Trainings-/Änderungsdialog. `/nachricht ID wiederholen` kann eine unklare Sendung doppelt zustellen; erst prüfen, ob sie bereits in WhatsApp steht. Die Kontobefehle `/login`, `/start`, `/stop`, `/konto`, `/daten` und `/löschen` gehören in einen privaten Chat. Eine WhatsApp-Anmeldung stellt keine amtliche Identität fest.

## Öffentliche Seiten und Anmeldung

Die öffentliche Website stellt `/`, `/info`, `/datenschutz`, `/login` und `/konto` bereit. Trainertexte werden aus der Konfiguration gerendert und HTML-escaped. Leere Datenschutzhinweise sind kein Freigabestatus: verantwortliche Stelle und vollständige Hinweise über `/datenschutz TEXT` eintragen und die vorgesehene Bestätigung abschließen. Dieser bestätigte Änderungsvorgang setzt `privacy_ready`; keine manuelle D1-Änderung vornehmen.

Die Webanmeldung startet aktiv per POST, bindet eine kurzlebige Challenge an den Browser und verlangt die Bestätigung in WhatsApp. Nur derselbe Browser kann die bestätigte Challenge per POST gegen eine Serversession tauschen. Ein GET-Aufruf allein authentifiziert niemanden. Der von der Website erzeugte WhatsApp-Link kann den einmaligen Code als vorgefüllten Chattext enthalten; dieser Link darf nicht als Login-URL behandelt oder protokolliert werden. Codes und Sessionwerte gehören nicht in TT-URLs oder Logs. Persönliche Erinnerungen sind eine eigenständige, standardmäßig ausgeschaltete Entscheidung.

## Ausfälle und Wiederanlauf

- Bei WhatsApp-/Evolution-Ausfall Trainingsänderungen nicht als zugestellt behandeln. Die Gruppe kann vorübergehend manuell organisiert werden.
- `uncertain`-Nachrichten nicht blind erneut senden: der Anbieter könnte die Nachricht angenommen haben, obwohl der Worker keine Antwort erhalten hat.
- Vor Remote-Migrationen den Zielbereich prüfen und einen geeigneten Wiederherstellungspunkt erfassen. Nach einer D1-Wiederherstellung Versand und Setup zunächst gesperrt lassen, bis gespeicherte Jobs und Codes geprüft sind.
- Fehlerberichte ohne API-Key, Login-Code, vollständige Telefonnummer/JID und Nachrichteninhalt erstellen.

## Zukünftiger Remote-Rollout

Die folgenden Schritte beschreiben einen späteren, ausdrücklich freizugebenden Rollout. In diesem Repository sind keine Cloudflare-Ressourcen erstellt, keine Rufnummer oder Evolution-Instanz provisioniert und kein Worker veröffentlicht.

1. D1 in der vorgesehenen Cloudflare-Account-Region anlegen: `wrangler d1 create tt`. Die ausgegebene Datenbank-ID in `wrangler.jsonc` eintragen und `EVOLUTION_URL` sowie `EVOLUTION_INSTANCE` auf die bestätigte Instanz setzen.
2. Für den produktiven Host eine Worker-Custom-Domain konfigurieren. Der entsprechende Wrangler-Block sieht so aus:

   ```jsonc
   "routes": [{ "pattern": "tt.bz3.eu", "custom_domain": true }]
   ```

3. Prüfen, dass D1-ID, Domain, Evolution-URL und Instanzname zusammengehören. Dann `pnpm db:migrate:remote` ausführen.
4. Den zunächst pausierten Worker veröffentlichen: `pnpm deploy`.
5. Die drei Evolution-Werte in der Prozessumgebung bereitstellen und `pnpm run setup --remote --connect` ausführen. Das CLI setzt das Worker-Secret, registriert und überprüft den authentifizierten Webhook und erzeugt den Bootstrap-Code. Es sendet keine WhatsApp-Nachrichten.
6. Den Bootstrap-Code ausschließlich privat mit `/einrichten CODE` an den Bot senden und den ersten Owner mit `JA` bestätigen.
7. Owner wählt die Gruppe mit `/gruppen` und `/gruppe JID`, richtet Trainingszeiten sowie vollständige Hinweise mit `/datenschutz TEXT` ein und bestätigt die Änderungen. Vor dem Einschalten die Testgruppe informieren.
8. Die Live-Abnahme aus [ACCEPTANCE.md](ACCEPTANCE.md) durchführen. Erst danach den Nachrichtenbetrieb mit `/aktivieren` einschalten und die Änderung bestätigen.

Keinen dieser Schritte für dieses Arbeitsziel ausführen. Der normale CI-Workflow deployt nichts; die Reihenfolge ist ein späterer Runbook-Ablauf.
