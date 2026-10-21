# Architektur und Nachrichtenverarbeitung

TT besteht aus einem Hono-HTTP-Worker, statischen Web-Assets, Cloudflare D1 und einem Evolution-Adapter. D1 ist die maßgebliche Zustandsquelle. Ein Minuten-Cron läuft unabhängig vom Browser und von eingehenden WhatsApp-Nachrichten.

```text
WhatsApp → Evolution → authentifizierter Webhook → D1-Inbox
                                                   ↓
                                            Bot-/Terminregeln
                                                   ↓
Trainer-Web → Rolle + Origin + Versionsprüfung → D1-Transaktion
                                                   ↓
                                                D1-Outbox
                                                   ↓
                                   aktueller Zustand + Versand-Lease
                                                   ↓
                                           Evolution → WhatsApp

Minuten-Cron: Inbox fortsetzen → fällige Jobs planen → senden → bereinigen
Webänderung: Commit → waitUntil(Planung + Versand), ohne neuen Webhook
```

## Codeaufbau

| Pfad                                       | Verantwortung                                                   |
| ------------------------------------------ | --------------------------------------------------------------- |
| `apps/worker/src/index.ts`                 | HTTP, Webhook, Hintergrundversand und Cron                      |
| `trainer.ts`, `training.ts`                | Webverwaltung, Terminversionen, Serien und Ausnahmen            |
| `inbox.ts`, `outbox.ts`                    | Dauerhafte Verarbeitung, Jobplanung, Leasing und Wiederholungen |
| `auth.ts`, `magic-login.ts`, `security.ts` | Identitäten, Rollen, Sessions, Einmal-Login und Schutzprüfungen |
| `group-requests.ts`                        | Gruppenanfrage, Freigabe und Begrüßung                          |
| `bot.ts`, `questions/`                     | Rückmeldungen und begrenzte deutsche Chatregeln                 |
| `packages/core/`                           | Kalender- und Sprachregeln                                      |
| `packages/whatsapp/`                       | Normalisierung und Evolution-HTTP-Vertrag                       |
| `apps/web/public/`                         | Browserlogik, Styles und Icon                                   |
| `migrations/`                              | Versioniertes SQL-Schema                                        |

## Webänderungen und sofortige Nachrichten

Eine Traineraktion prüft Session, aktuelle Rolle, Origin und erwartete Terminversion. Änderungen, Audit-Eintrag und Änderungsaufträge werden gemeinsam in einer D1-Transaktion gespeichert. Nach einer erfolgreichen schreibenden Trainer-API-Anfrage startet `waitUntil` die Planung und den Versand. Dazu gehören auch Gruppenfreigaben und Aktivierung. Leseanfragen und fehlgeschlagene Änderungen lösen keinen Versand an.

Die HTTP-Antwort bestätigt die Speicherung, nicht die Zustellung in WhatsApp. Providerfehler machen die bereits gespeicherte Terminänderung nicht rückgängig. Die Versandansicht zeigt Auftragszustände. Cloudflare begrenzt Hintergrundarbeit nach einer HTTP-Antwort; der Cron übernimmt verbleibende Arbeit. „Sofort“ bedeutet, dass TT den Versand ohne einen weiteren Benutzerrequest startet, nicht eine garantierte Zustellzeit beim Provider.

Zuvor fehlte dieser Anstoß nach Webänderungen. Aufträge konnten bis zum nächsten Cron oder WhatsApp-Webhook liegen bleiben. Dieser Fehler wird durch HTTP-Regressionstests und den lokalen workerd-Smoke abgedeckt.

## Versandzustände

`pending` wird durch einen atomaren Claim zu `processing`. Der Sender prüft aktuelle Terminversion, Gruppe, Pausenstatus und gegebenenfalls Rolle und Zustimmung. Ein erfolgreicher Provider-Aufruf wird als `sent` gespeichert. `sent` bedeutet Provider-Annahme, nicht gelesene oder am Endgerät bestätigte Nachricht.

Eindeutig wiederholbare Fehler erhalten begrenztes Backoff. Permanente Fehler werden `failed`. Ein Timeout mit unbekanntem Ausgang oder eine abgelaufene Bearbeitungs-Lease wird `uncertain`; solche Sendungen werden nicht blind wiederholt. Ein fehlgeschlagener Reaktionsauftrag wiederholt nicht den zugehörigen Trainingstext. Veraltete oder nicht mehr erlaubte Aufträge werden verworfen.

Pro Sendelauf werden zunächst höchstens 15 fällige Aufträge geholt; zugehörige Uhr-Reaktionen können im selben Lauf folgen. Größere Rückstände benötigen weitere Läufe. Eine exakt-einmalige Zustellung über die Grenze D1/Provider kann nicht garantiert werden. Lease-Claims und eindeutige Auftragsschlüssel verhindern reguläre doppelte Verarbeitung; unklare externe Schreibausgänge bleiben bewusst sichtbar.

## Sicherheit und Tests

Webhook-Ereignisse brauchen einen Bearer-Token und die konfigurierte Instanz. Wiederholte Eingangsevents werden dedupliziert. Geschützte Änderungen benötigen die konfigurierte Origin; ein Host-Header konfiguriert die Anwendung nicht um. Magic-Links sind kurzlebig, einmalig und brauchen eine aktive Bestätigung. Sessions und Rollen werden serverseitig geprüft.

Die Tests verwenden echte SQLite-Transaktionen hinter der benötigten D1-Schnittstelle. Der Smoke prüft zusätzlich lokalen workerd, D1, Cron und einen lokalen Evolution-HTTP-Mock. Geräteabnahme, reale Evolution-Versionen, Cloudflare-Kontolimits und Produktionslatenzen sind davon getrennte Nachweise.

## Übung und Login-Nachrichten

`practice.ts` reserviert pro Trainerperson eine Gruppe, bevor die Gruppenanlage beim Provider erfolgt. Unklare Ausgänge werden durch Abgleich aufgelöst, niemals durch automatisches Wiederholen. Die separate Speicherung (`practice_groups`, `practice_attendance`) wird vor der normalen Botverarbeitung ausgewählt. Produktionseinstellungen werden dafür nicht umgeschaltet. Parser und Attendance-Reducer werden geteilt, Produktionsplanung und -daten bleiben getrennt. Versionierte Aufträge verwenden die bestehende Outbox; jede Zustellung prüft Gruppenreservierung, Runde, Ablauf und aktuelle Trainerrolle. Datenbank-Trigger verhindern eine Aktivierung als normale Gruppe.

`login-messages.ts` erzeugt deduplizierte Bearbeitungsaufträge für zugestellte, inzwischen verwendete, widerrufene oder abgelaufene Links. Der erfolgreiche Login-Abschluss startet die Zustellung unmittelbar; Cron übernimmt Ablauf und Wiederaufnahme. `target_message_id` bindet den Auftrag an die ursprüngliche eigene Privatnachricht. `login_edit` verwendet den Evolution-Update-Endpunkt und sendet nie ersatzweise eine neue Textnachricht. Die Anmeldung prüft eine vorhandene Sitzung vor dem Einmal-Token; explizite Neuauthentifizierung bleibt ein separater, kontogebundener Vorgang.
