# Betrieb und Fehlerdiagnose

Installation und Updates: [SELF_HOSTING.md](SELF_HOSTING.md). Alle Befehle müssen auf die eigene Produktionsdatei zeigen. Regulärer Alltag findet auf `/trainer` statt; Mitglieder verwalten freiwillige Registrierung und Erinnerungen auf `/konto`.

## Nachrichten und Cron

`wrangler.production.jsonc` muss `"triggers": { "crons": ["* * * * *"] }` enthalten. Ein Deploy veröffentlicht diese Konfiguration. Nach dem Deploy im Cloudflare-Dashboard den aktiven Cron prüfen; Änderungen an Triggern können Zeit zur Übernahme benötigen.

Die Trainerübersicht zeigt `lastCron`, offene, fehlgeschlagene und unklare Aufträge. `lastCron` wird erst nach einem vollständig erfolgreichen Scheduler-Durchlauf gesetzt. Es wird durch normalen HTTP-Traffic nicht aktualisiert. `/health` prüft ausschließlich die Datenbankverbindung und belegt weder einen funktionierenden Cron noch eine WhatsApp-Zustellung.

Nach erfolgreichen Webänderungen startet TT den Versand sofort im Hintergrund. Künftige Einladungen und Erinnerungen bleiben bis zum Termin fällig. Bei Terminänderungen nach bereits erfolgter Einladung kann zusätzlich eine erneute Teilnahmebestätigung erforderlich sein.

| Symptom                                            | Prüfen                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Änderung erst nach nächster Chatnachricht sichtbar | Aktuelle Worker-Version mit Webversand verwenden; `lastCron` und aktiven Trigger kontrollieren                   |
| Keine Trainingssendungen                           | Automatik, Datenschutzfreigabe, Gruppenfreigabe, Fälligkeit und aktuelle Terminversion                           |
| Keine Anmeldung                                    | Verbundene Botinstanz, Webhook-Header, `origin`, persönliche Nachricht `/login`, Ablauf/Neuanforderung des Links |
| API liefert `origin_mismatch`                      | Öffentliche Browseradresse muss zur gespeicherten kanonischen Origin passen                                      |
| `uncertain` in Versandansicht                      | Provider/WhatsApp auf erfolgte Sendung prüfen; keinen Auftrag ungeprüft zurück auf `pending` setzen              |
| HTTP 429 vom Provider                              | Backoff respektieren und Providerlimits prüfen                                                                   |
| Health ist okay, aber keine Nachrichten            | Health prüft nur D1; Evolution-Verbindung, Secret und Cron separat prüfen                                        |

`pnpm exec wrangler tail --config wrangler.production.jsonc` hilft bei der Diagnose. Keine Tokens, Anmeldelinks, Telefonnummern oder Nachrichteninhalte in öffentliche Issues kopieren. Hintergrundfehler werden mit einem festen, inhaltsfreien Hinweis protokolliert. Providerfehler werden als technische Kategorien in den Aufträgen gespeichert.

## Pausieren und Wiederanlauf

Trainingsnachrichten im Trainerbereich pausieren. Beim erneuten Aktivieren werden nur passende, noch unversuchte zukünftige Aufträge wieder freigegeben. Pausieren stoppt nicht sämtliche Kommunikation: Login-Antworten und administrative Abläufe können weiterhin Nachrichten erzeugen. Wenn überhaupt kein Versand stattfinden darf, zusätzlich den Worker-/Providerzugriff in einem geplanten Wartungsfenster unterbrechen.

Bei Provider-Ausfall Trainingsänderungen vorübergehend manuell kommunizieren. Nach Wiederherstellung des Providers prüfen, welche Aufträge `failed` oder `uncertain` sind. D1 und Evolution bilden keine gemeinsame Transaktion; eine unbestätigte Sendung kann WhatsApp bereits erreicht haben.

## Backup

Lokales Backupverzeichnis `backups/` ist von Git ausgeschlossen. Eine eigene Aufbewahrung, Verschlüsselung und Zugriffskontrolle festlegen.

```sh
mkdir -p backups
pnpm exec wrangler d1 export DB --remote --config wrangler.production.jsonc --output backups/tt.sql
pnpm exec wrangler d1 time-travel info DB --config wrangler.production.jsonc
```

D1-Time-Travel-Verfügbarkeit und Aufbewahrung hängen vom Cloudflare-Angebot ab. Backup enthält personenbezogene Daten und Zugangsnachweis-Hashes; es ist kein öffentliches Diagnoseartefakt. Eigene Konfiguration sowie Cloudflare-/Evolution-Zugänge getrennt sichern. Eine SQL-Sicherung ersetzt keine Sicherung des Evolution-Systems.

Wiederherstellung zuerst an einer separaten D1 testen. Ein Import kann beispielsweise mit `wrangler d1 execute DB --remote --config wrangler.restore.local.jsonc --file backups/tt.sql` auf ein bewusst gewähltes leeres Ziel erfolgen. Beim Export mitgelieferte Tabellen und Migrationseinträge vor weiteren Migrationen prüfen. Für einen produktiven Time-Travel-Restore den gewählten Wiederherstellungspunkt und die aktuelle Wrangler-/Cloudflare-Anleitung verwenden; ein Restore überschreibt Daten.

## Nach einem Restore

1. Nachrichtenbetrieb pausiert halten und Cron/Provideranbindung kontrolliert wieder zuschalten.
2. Owner, Rollen, Gruppen, Termine und Auftragszustände prüfen.
3. Beachten, dass Nachrichten seit dem Wiederherstellungspunkt schon versandt worden sein können. Alte `pending`-Jobs nicht automatisch erneut versenden.
4. Offene Login-Links und Sessions prüfen bzw. widerrufen, wenn der Restore ihren Zustand zurückgesetzt hat.
5. Erst nach Abgleich bewusst aktivieren.

Ein Worker-Rollback stellt keinen älteren Datenbankzustand her. Neue Migrationen deshalb vorab auf einer Kopie prüfen und nur mit kompatiblem Code ausrollen.

## Zuständigkeiten

Der Betreiber verwaltet Cloudflare, Evolution, die Botnummer, Sicherungen, Datenschutzhinweise und Benutzeranfragen. Trainer verwalten Termine und Gruppen im Web. Die [Abnahme](ACCEPTANCE.md) dokumentiert die eigene Installation; historische Ergebnisse anderer Betreiber ersetzen sie nicht.
