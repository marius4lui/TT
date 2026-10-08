# TT Gesamtplanung

TT organisiert Tischtennistraining über WhatsApp. Trainer verwalten Termine und Ausnahmen beim Bot; Mitglieder melden Teilnahme und Verspätung durch Reaktionen oder persönliche Nachrichten. Eine freiwillige Registrierung ermöglicht persönliche Erinnerungen und später den Login auf tt.bz3.eu. Die Anwendung besteht aus einem Cloudflare Worker mit D1 als dauerhaftem Speicher. Eine spätere Weboberfläche wird im selben Worker ausgeliefert.

Stand: 8. Oktober 2026. Dies ist die vollständige Planung für ein privates GitHub-Monorepo namens TT. Produktivverhalten der vorgesehenen Evolution-Instanz muss vor Freigabe in einer Testgruppe nachgewiesen werden. Es wurden keine Dienste eingerichtet oder veröffentlicht.

## Machbarkeit und Grenzen

| Wunsch | Ergebnis | Konsequenz |
| --- | --- | --- |
| Automatische Nachricht in bestehender WhatsApp-Gruppe | Mit Evolution im Baileys-Modus technisch vorgesehen | Bot muss Gruppenmitglied sein und Schreibrecht haben; tatsächliche Instanz testen |
| Teilnahme über 👍 und 👎 | Technisch über eingehende Reaktionsnachrichten vorgesehen | Trainingsnachricht und reagierende Person eindeutig zuordnen; Änderung und Entfernung testen |
| Zweite Nachricht für Verspätungen | Ja | Standard 30 Minuten vor Beginn, optional bei Beginn |
| Persönliche Rückmeldungen | Ja, sofern Person adressierbar ist | Automatische persönliche Erinnerungen nur nach gesondertem Opt-in |
| Breite Erkennung von Verspätungen | Viele Formulierungen ohne KI möglich | Keine Garantie für jede Schreibweise, Ironie oder indirekte Aussage; bei Unsicherheit nachfragen |
| WhatsApp als einziger Login-Kanal | Als eigene Anmeldung mit Besitznachweis möglich | Keine amtliche Identität; keine Behauptung einer offiziellen WhatsApp-OAuth-Anmeldung |
| Kontakt speichern, damit Daten lesbar werden | Keine verlässliche technische Voraussetzung | Kontaktkarte anbieten; Identität und Zustimmung getrennt behandeln |
| Erster Kontakt wird alleiniger erster Admin | Technisch möglich, öffentlich angreifbar | Erste berechtigte Einrichtung mit einmaligem Code absichern |
| Trainertelefonnummern ohne Environment Variables | Ja | Rollen und Identitäten in D1 |
| Nur Evolution-URL, API-Key und Instanz als manuelle Laufzeitwerte | Ja, mit Cloudflare-Bindings und automatischer Einrichtung | Datenbank, Assets und Cron sind zusätzlich erforderlich; generierte Sicherheitstoken separat verwalten |
| Worker ohne irgendeinen dauerhaften Speicher | Für dieses Produkt ungeeignet | Admins, Termine, Zustimmungen und Sendestatus müssen Neustarts überleben |
| API und spätere Web-UI auf derselben Domain | Ja | Gemeinsamer Worker und gemeinsames Deployment |

Evolution unterstützt sowohl Baileys als auch die offizielle WhatsApp Cloud API. Für die gewünschte Integration in die vorhandene Gruppe ist Baileys die zu prüfende Ausgangsbasis. Beide Anschlussarten sind nicht austauschbar: Vor einem Wechsel müssten Gruppenfunktionen, Meta-Zulassung und Nachrichtenregeln erneut geprüft werden. Die Evolution-Anbindung läuft extern; sie wird nicht in den TT-Worker eingebaut. [Evolution Projekt](https://github.com/evolution-foundation/evolution-api)

Baileys nutzt WhatsApp Web. WhatsApp nennt unzulässige automatisierte Nachrichten und nicht autorisierte Nutzung als mögliche Gründe für Einschränkungen oder Sperren. Eine neue Nummer, wenig Nachrichten und Einwilligungen liefern keine Garantie gegen Sperren. Dieses Risiko gehört zum gewählten Transport. [WhatsApp Nutzungshinweise](https://faq.whatsapp.com/361005896189245/) und [WhatsApp Bedingungen für den EWR](https://www.whatsapp.com/legal/terms-of-service-eea)

## Der Stack

| Baustein | Festlegung |
| --- | --- |
| Repository | Privates GitHub-Monorepo TT; kein öffentliches Repository |
| Paketverwaltung | pnpm Workspace mit gemeinsamer Lockdatei |
| Sprache | TypeScript im Worker und in gemeinsamen Paketen |
| HTTP | Hono für Routing, Validierungseinbindung und Middleware |
| Laufzeit | Ein Cloudflare Worker mit fetch und scheduled Handler |
| Daten | Eine Cloudflare-D1-Datenbank, bei Erstellung EU-Jurisdiktion wählen |
| Datenzugriff | Kleine Repository-Schicht mit parametrisiertem SQL und versionierten SQL-Migrationen |
| Zeitsteuerung | Ein Cron Trigger jede Minute; fällige Aufgaben aus D1 lesen |
| WhatsApp | Evolution REST API und authentifizierter Instanz-Webhook |
| Anmeldung | Eigene kurzlebige WhatsApp-Challenges und undurchsichtige Serversessions in D1 |
| Web in Version 1 | Kleine öffentliche Info- und Datenschutzseiten sowie benötigte Login-Seiten; kein Verwaltungsdashboard |
| Web später | React und Vite; Build als Worker Static Assets; dieselben Anwendungsdienste |
| Qualität | Typecheck, Lint, Vitest mit Workers-Integration, gezielte echte WhatsApp-Abnahme |
| Deployment | Wrangler über GitHub Actions; eigene Cloudflare-Zugangsdaten nur für CI |

Hono unterstützt Worker und zusätzliche Ereignis-Handler. Cloudflare kann statische Dateien und dynamische Routen gemeinsam in einem Deployment bedienen. Die spätere Web-UI benötigt weder einen zweiten Worker noch Cloudflare Pages. [Hono](https://hono.dev/docs/getting-started/cloudflare-workers), [Worker Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Workers Vitest](https://developers.cloudflare.com/workers/testing/vitest-integration/)

D1 kann bei der Erstellung auf EU-Jurisdiktion begrenzt werden. Das betrifft Speicherung und Ausführung der Datenbank, nicht automatisch den gesamten Worker, Logs, Evolution oder WhatsApp. [D1 Datenstandort](https://developers.cloudflare.com/d1/configuration/data-location/)

Version 1 benötigt keine Queues, Durable Objects, Redis, externe Auth-Plattform, KI-API oder zusätzliche SQL-Server. Falls später wesentlich mehr Gruppen oder zeitkritische Abläufe hinzukommen, können Durable-Object-Alarme die Zeitsteuerung ersetzen. Sie garantieren mindestens eine Ausführung und verlangen weiterhin Schutz gegen doppelte Verarbeitung. [Durable Object Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

## Domain und Monorepo

Alle öffentlichen Funktionen bleiben auf https://tt.bz3.eu. Pfade trennen Zuständigkeiten, nicht Deployments:

| Pfad | Zweck |
| --- | --- |
| / | In Version 1 einfache Startseite, später Web-App |
| /info | Trainingsinformationen für neue Teilnehmer |
| /datenschutz | Informationen zu Verantwortlichem, Verarbeitung und Betroffenenrechten |
| /login | WhatsApp-Anmeldung |
| /t/:id | Öffentliche Informationen zu einem einzelnen Training ohne Teilnehmerliste |
| /r/:id | Teilnahme oder Verspätung; zunächst Weiterleitung zum passenden WhatsApp-Befehl |
| /api/v1/* | Interne Web-API mit Serversession und Rollenprüfung |
| /webhooks/evolution | Authentifizierte Evolution-Ereignisse |
| /health | Grober Funktionsstatus ohne Identitäten oder Zugangsdaten |

API-, Login- und Webhook-Pfade werden ausdrücklich vor Asset-Fallback verarbeitet. Ein unbekannter API-Pfad muss JSON mit 404 liefern, niemals versehentlich die SPA. Login- und personenbezogene Antworten haben Cache-Control: no-store. Die öffentliche Web-App enthält keine vertraulichen Daten im HTML oder JavaScript-Bundle. [Asset Routing](https://developers.cloudflare.com/workers/static-assets/binding/)

Geplante Struktur:

```text
TT/
  apps/
    worker/              HTTP, Webhooks, Cron, Auth, Bindings
    web/                 zuerst Info/Login, später React-Oberfläche
  packages/
    core/                Training, Teilnahme, Rollen, Zeitregeln
    whatsapp/            Evolution-Adapter und normalisierte Ereignisse
    contracts/           gemeinsame Eingabe- und Ausgabeformate
  migrations/            D1-Schema und Weiterentwicklung
  tests/                 Integrationsfälle und anonymisierte Payload-Beispiele
  docs/                  Betrieb, Datenschutz, Abnahme, API
  pnpm-workspace.yaml
  pnpm-lock.yaml
```

Core kennt weder HTTP noch Evolution-Payloads. WhatsApp-Kommandos und spätere Web-Aktionen rufen dieselben Dienste auf. Damit muss die Trainingslogik beim UI-Ausbau nicht neu geschrieben werden. Die Aufteilung ist eine Codeorganisation; zur Laufzeit gibt es eine TT-Anwendung.

## Konfiguration und Geheimnisse

Manuell zu setzen sind EVOLUTION_URL, EVOLUTION_INSTANCE und EVOLUTION_API_KEY. Der API-Key ist ein Cloudflare Secret, kein Klartext in Git oder Frontend. Der geprüfte REST-Routenparameter heißt instanceName; eine vom Anbieter angezeigte UUID darf deshalb nicht ungeprüft als Instanzname eingesetzt werden. Der Setup-Check bestimmt den tatsächlich gültigen Bezeichner.

Zusätzlich wird der Worker mit DB und ASSETS verbunden und auf tt.bz3.eu geroutet. Der Cron steht in der Wrangler-Konfiguration. Cloudflare Account-ID, Datenbank-ID und CI-Token sind Deployment-Konfiguration und keine Trainerdaten. Der CI-Token wird nicht dem Worker gegeben. [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) und [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

Trainingszeiten, Gruppen-JID, Trainerrollen, Informationslink, Botname, Zeitzone und persönliche Einstellungen liegen in D1. Die eigene Botnummer wird möglichst über Evolution ermittelt und nur als Konfiguration gecacht. Kein Trainer steht in einer Environment Variable.

Der Setup-Prozess erzeugt zusätzlich einen zufälligen Webhook-Bearer-Token und einen kurzlebigen Einrichtungscode. Dafür muss Marius keine weitere Variable pflegen. Ein Setup-Werkzeug konfiguriert den Webhook über Evolution; der Worker speichert nur den Hash des Bearer-Tokens. Rotation erfolgt über ein kontrolliertes Setup-Werkzeug. Falls der Anbieter keine eigenen Webhook-Header unterstützt, ist diese Anbieterfunktion vor Einsatz zu klären; ein öffentlich ungeschützter Webhook ist kein Ersatz.

Zugangsdaten, Login-Codes und vollständige Webhook-Payloads werden nicht geloggt. Das ist bei Evolution besonders relevant: Der untersuchte Webhook-Code baut ein apikey-Feld in die Nutzlast ein. TT muss es vor jeder Protokollierung und dauerhaften Speicherung verwerfen. Auch die Log- und Speicherkonfiguration der externen Evolution-Instanz ist zu prüfen. [Evolution Webhook-Code](https://github.com/evolution-foundation/evolution-api/blob/fa09d37892cdbb1d65a250155d293d92230c5b30/src/api/integrations/event/webhook/webhook.controller.ts)

## Die einmalige Admin-Einrichtung

Ein öffentlicher erster Privatkontakt allein darf nicht ausreichen, um TT zu übernehmen. Vorgesehen ist derselbe gewünschte Dialog, abgesichert durch einen einmaligen Einrichtungscode:

1. Das Setup-Werkzeug erzeugt einen zufälligen Code mit hoher Entropie, zeigt ihn nur lokal und hinterlegt Hash sowie Ablauf in D1. Der Bot arbeitet bis zum Abschluss nicht produktiv in Gruppen.
2. Marius schreibt dem Bot privat /einrichten mit diesem Code.
3. Die erste gültige Anfrage reserviert die Einrichtung atomar für diese WhatsApp-Identität. Andere Nummern können sie nicht übernehmen.
4. Der Bot fragt: „Möchtest du dich als ersten Admin ernennen? Antworte mit JA oder NEIN.“
5. JA setzt diese Identität als Owner und markiert die Ersteinrichtung dauerhaft als abgeschlossen. Code und Reservierung werden verbraucht.
6. NEIN oder Ablauf aktiviert keine andere Nummer automatisch. Nur der Betreiber kann lokal einen neuen Versuch freigeben.

Einzigartige Datensätze und bedingte SQL-Änderungen verhindern, dass zwei gleichzeitige Bestätigungen zwei Owner erzeugen. Das Löschen aller Admins darf die Ersteinrichtung nicht erneut öffnen. Der letzte Owner kann nicht beiläufig entfernt werden. Eine Übertragung erfordert Bestätigung durch bisherigen und neuen Owner; Wiederherstellung bei Nummernverlust erfolgt über Cloudflare-Betreiberzugriff und wird protokolliert.

Danach kann der Owner weitere Trainer als Admin einladen. /admin einladen erstellt einen zeitlich begrenzten Code. Die gewünschte Person schreibt ihn privat an den Bot; der Owner bestätigt die konkrete Person. Alternativ kann eine Einladung an eine zuvor verifizierte Identität gebunden werden. Rollen werden nur anhand der gespeicherten Identität vergeben, nicht anhand eines Anzeigenamens oder einer vom Absender eingegebenen Telefonnummer. WhatsApp-Gruppenadmins sind nicht automatisch TT-Admins.

## Trainingsplanung über WhatsApp

Trainer schreiben dem Bot privat /hilfe oder /training. Der Bot führt durch kurze Fragen: Gruppe, Wochentag, Beginn, Ende, Ort, Erinnerungszeit. Standardannahmen sind Europe/Berlin, eine Gruppe, eine wöchentliche Serie, Nachricht am Vortag um 18:00 und zweite Nachricht 30 Minuten vor Beginn. Die Uhrzeiten sind Vorschläge und werden bei Einrichtung bestätigt.

Direkte Kommandos sind zusätzlich möglich:

| Kommando | Wirkung |
| --- | --- |
| /training | Dialog für eine wöchentliche Serie |
| /termine | Nächste Termine mit Ausnahmen |
| /ausfall 2026-10-15 | Einzeltermin absagen |
| /pause 2026-12-21 2027-01-06 | Serie für einen Zeitraum aussetzen |
| /verschieben 2026-10-15 2026-10-16 18:00 | Termin mit ursprünglicher Identität auf neues Datum verschieben |
| /sondertraining 2026-10-17 10:00 12:00 | Zusätzlichen Einzeltermin anlegen |
| /übersicht | Zusagen, Absagen, offene Antworten und Verspätungen zum ausgewählten Termin |
| /info | Informationsinhalt verwalten |
| /status | Verbindung und fehlgeschlagene Nachrichten prüfen |
| /admin | Admins einladen oder verwalten |

Der Bot zeigt vor Terminänderungen Datum, Uhrzeit, betroffene Gruppe und Auswirkungen. /bestätigen übernimmt die Änderung. Datumswerte sind intern ISO-Daten; der Dialog kann deutsche Eingaben entgegennehmen, zeigt zur Bestätigung aber immer Wochentag und ausgeschriebenes Datum. Unbekannte oder mehrdeutige Eingaben verändern nichts.

Eine Ausnahme hat Vorrang vor der Serie. Absagen stoppen geplante Erinnerungen; wurde bereits eingeladen, sendet der Bot eine Absage. Verschiebungen behalten die Termin-ID und bestehende Antworten, kennzeichnen diese als erneut zu bestätigen und informieren die Teilnehmer. Der neue Erinnerungsplan gilt sofort. Feiertage sind zunächst explizite Pausen oder Ausfälle; automatische Länder- und Schulferienkalender würden unnötige Komplexität schaffen.

## Teilnahme und die beiden Nachrichten

Beispielzeiten dienen nur der Illustration:

> 🏓 Morgen, Donnerstag, ist Tischtennistraining von 18:00 bis 20:00 Uhr in der Sporthalle.
>
> Reagiere auf diese Nachricht: 👍 Ich komme · 👎 Ich komme nicht.
>
> Neu dabei? Informationen: https://tt.bz3.eu/info
> Persönliche Erinnerungen sind freiwillig. Schreib dem Bot /login: [WhatsApp-Link mit vorgefülltem Text].

👍 und 👎 sind echte Reaktionen auf die Einladung. Nur diese Emojis, einschließlich üblicher Hautfarbvarianten, steuern die Teilnahme. Ein frei im Gruppenchat gesendetes 👍 zählt nur, wenn es eindeutig als Antwort auf die Einladung identifizierbar ist; sonst bleibt die Teilnahme unverändert. Version 1 baut keine Umfrage wie im Screenshot, weil die gewünschte Bedienung Reaktionen verwendet. Evolution bietet auch Umfragen, deren Stimmen zusätzliche Zuordnung und Entschlüsselung erfordern.

Die zweite Nachricht kommt standardmäßig 30 Minuten vor Beginn:

> 🏓 Das Training beginnt in 30 Minuten um 18:00 Uhr.
>
> Wenn du später kommst, reagiere auf diese Nachricht mit ⏰.
> Wenn du wieder pünktlich bist, entferne deine Reaktion oder schreibe /pünktlich.
>
> Du kannst die Verspätung auch privat melden: [WhatsApp-Link mit „/spät TERMIN-ID“].

Die Wahl von ⏰ trennt Verspätung klar von Teilnahme. Jede Person kann an der ersten Nachricht teilnehmen und unabhängig davon an der zweiten eine Verspätung markieren. Ein zweiter 👍 wird nicht überladen. Für Trainer, die die zweite Nachricht bei Trainingsbeginn wollen, ist der Zeitpunkt konfigurierbar; standardmäßig wird nicht beides geschickt.

Eine Zusage wird bestätigt mit „Du bist für Donnerstag um 18:00 angemeldet. Bitte sei pünktlich da. Neu dabei? … Verspätung melden: … Persönliche Erinnerungen: /login.“ Eine Absage erhält eine passende Bestätigung ohne Pünktlichkeitsaufforderung. Eine Verspätung erhält „Deine Verspätung ist eingetragen. Danke fürs Bescheidgeben. Wenn möglich, ergänze /spät 10 für ungefähr zehn Minuten.“ Es wird keine erfundene Ankunftszeit genannt.

Bestätigungen gehen nach persönlichem Opt-in privat. Ohne Opt-in kann der Bot im Gruppenchat eine kurze personenbezogene Antwort geben; dafür braucht die Gruppe vor Aktivierung eine verständliche Information über die Botverarbeitung. Eine Gruppenreaktion aktiviert niemals automatisch private Dauererinnerungen oder ein Webkonto. Wiederholte identische Zustände erzeugen keine erneute Bestätigung.

Der Link /r/:id transportiert nur Termin und gewünschte Aktion. Er setzt selbst keinen Teilnehmerstatus und enthält kein persönliches Zugangsgeheimnis. Er öffnet den privaten WhatsApp-Chat mit dem passenden Befehl. Erst das tatsächliche Senden der Nachricht liefert den Absender. WhatsApp-Links füllen den Text vor, senden ihn aber nicht automatisch. [WhatsApp Click to Chat](https://faq.whatsapp.com/5913398998672934)

## Teilnahmezustände und Änderungen

Pro Termin und Person existiert genau ein Teilnahmezustand: unbekannt, zugesagt oder abgesagt. Die Pünktlichkeit ist getrennt: unbekannt, pünktlich oder verspätet; optional mit Minuten oder ausdrücklich angegebener Ankunftszeit.

Eine Absage setzt eine bisherige Verspätung außer Kraft. Eine ausdrückliche Aussage „Ich komme zehn Minuten später“ kann gleichzeitig Zusage und Verspätung setzen, weil sie Teilnahme ausdrückt. Bei „Vielleicht komme ich später“ fragt der Bot nach, bevor er eine Zusage erzeugt. Nach dem Training werden normale Statusänderungen geschlossen; Trainer können nachvollziehbar korrigieren.

Gruppenreaktionen und persönliche Antworten sind gleichwertige Eingabewege. Jede Änderung hat Quelle, Ereignis-ID und Version. Später eintreffende alte Ereignisse überschreiben keine neueren Entscheidungen. Falls die Reihenfolge nicht sicher bestimmbar ist, wird keine kritische Änderung geraten.

Wird eine Reaktion entfernt, darf sie nur den Zustand aufheben, den genau diese Reaktion zuletzt gesetzt hat. Eine ältere entfernte Gruppenreaktion darf eine inzwischen persönlich eingetragene Zusage nicht löschen. Ebenso darf das Entfernen der ⏰-Reaktion eine später privat bestätigte Verspätung nicht zurücknehmen. Der Bot kann keine fremde Reaktion auf einem anderen Telefon automatisch angleichen; bei widersprüchlicher Anzeige erklärt er den bei TT gültigen Zustand.

## Verspätungen in freiem Text

Es werden nur neue Textnachrichten in der aktivierten Trainingsgruppe beziehungsweise im TT-Dialog verarbeitet. Persönliche Nachrichten ohne Terminbezug werden bei mehreren Möglichkeiten durch eine Terminfrage geklärt. Im Gruppenchat wird freier Text zum heutigen Termin nur in einem begrenzten Fenster zugeordnet, beispielsweise ab sechs Stunden vor Beginn bis Trainingsende. Reaktionen und explizite Kommandos tragen ihre Termin-ID direkt.

Der Parser normalisiert Großschreibung, übliche Unicode-Zeichen, „spät/spaet“ und bekannte Tippvarianten. Danach prüft er Ich-Bezug, Teilnahmebezug, Zeitangaben, Negation und Unsicherheit. Muster werden anhand realer, anonymisierter Beispiele erweitert.

| Nachricht | Verhalten |
| --- | --- |
| „Ich komme bisschen später heute ins Training“ | Zusage und Verspätung setzen; Beispiel aus dem Screenshot |
| „Bin 10 min später da“ | Zusage und ungefähr zehn Minuten Verspätung |
| „Schaffe es erst um 18:20“ | Bei eindeutigem Termin Ankunft 18:20 speichern |
| „Verspäte mich“, „werde später kommen“, „komm spaeter“ | Verspätung erkennen, wenn Bezug eindeutig ist |
| „Ich komme nicht zu spät“ | Keine Verspätung setzen |
| „Ich komme heute nicht“ | Nur im klaren Trainingskontext Absage; sonst nachfragen |
| „Wenn der Bus ausfällt, komme ich später“ | Rückfrage statt sicherer Verspätung |
| „Paul kommt später“ | Nicht die Verspätung des Absenders setzen; Fremdmeldungen in Version 1 nicht automatisch buchen |
| „Die Lieferung kommt zu spät“ | Keine Trainingsaktion |
| „später“ bei mehreren Terminen | Termin beziehungsweise Absicht erfragen |

Bestätigung: „Okay, ich habe eingetragen, dass du heute später kommst. Beim nächsten Mal kannst du einfach mit ⏰ auf die Verspätungsnachricht reagieren. Alternativ: [privater Link].“ Wenn die zweite Nachricht noch nicht existiert, verweist der Bot auf den privaten Link und kündigt die spätere Reaktionsmöglichkeit an.

„Alle möglichen Schreibweisen“ ist keine seriös garantierbare Eigenschaft. Das Ziel ist eine breite, getestete Erkennung mit sicherer Rückfrage. Dafür benötigt Version 1 keinen KI-Key und versendet keine Gruppeninhalte an ein Sprachmodell.

## Freiwillige Registrierung und persönliche Erinnerungen

/login in einem privaten Chat startet die Anmeldung beziehungsweise Registrierung. /login aus einer Gruppe liefert lediglich den Hinweis auf den privaten Botchat; Codes und Zustimmung gehören nicht in die Gruppe.

Der Bot bietet zuerst seine Kontaktkarte mit dem Namen „Marius Bot“ an und bittet darum, sie zu speichern. Das hilft beim Wiederfinden, wird aber nicht als technisch verifizierter Schritt dargestellt. Weder das Speichern noch eine Antwort „gespeichert“ beweist eine Freigabe weiterer Profildaten. Profilinformationen können durch WhatsApp-Privatsphäre-Einstellungen fehlen. TT benötigt keine Profilbilder oder vollständigen Adressbücher.

Es gibt getrennte Entscheidungen:

1. Konto mit WhatsApp-Kennung und gewünschtem Anzeigenamen anlegen; zuvor Verarbeitungsinformationen zeigen und die tatsächlich passende Rechtsgrundlage festlegen.
2. Persönliche Trainingsnachrichten abonnieren: gesondertes JA; Standard AUS.

Gespeichert werden Zustimmungstextversion, Zeitpunkt, Zweck und Absendernachweis. Das Abonnement lässt sich mit /stop ebenso einfach beenden. /start aktiviert es nach erneuter ausdrücklicher Bestätigung. /konto zeigt Einstellungen; /daten und /löschen starten Auskunft beziehungsweise Löschung mit Bestätigung. Ein Abonnement ist nicht Voraussetzung für Teilnahme, Gruppenantworten oder spätere Anmeldung.

Nach Opt-in kommen persönliche Einladungen zum jeweiligen Training. Reaktionen auf diese privaten Einladungen wirken auf denselben Terminzustand wie Gruppenreaktionen. Eine neue Erinnerung nach Opt-in wird nicht wahllos rückwirkend versendet. Die nächste sinnvoll anstehende Nachricht gilt. Mitgliedschaft in der Trainingsgruppe oder eine Trainerfreigabe begrenzt den Zugriff auf TT-Funktionen; ein weitergeleiteter Link macht niemanden zum Vereinsmitglied.

## WhatsApp als Login und zukünftige Anmeldung

WhatsApp dient als Nachweis, dass die Person gerade Zugriff auf das entsprechende WhatsApp-Konto hat. Eine eingegebene Telefonnummer, ein Anzeigename, ein Profilfoto oder das Kontakt-Speichern genügen nicht. Eine eigene unveränderliche user_id bleibt von Telefonnummer und Transportkennung getrennt.

Für die spätere Web-Anmeldung ist der Ablauf:

1. Die Person öffnet tt.bz3.eu/login und startet die Anmeldung aktiv. Der Worker erzeugt eine Challenge mit mindestens 128 Bit Zufall, speichert deren Hash, setzt eine Browserbindung und begrenzt die Gültigkeit auf fünf Minuten.
2. Ein WhatsApp-Link füllt „/login CODE“ vor. Erst das Senden bestätigt den Kontakt zum Bot.
3. Der authentifizierte Webhook liefert die WhatsApp-Identität. Der Bot beschreibt den angefragten Login auf tt.bz3.eu und bittet um explizite Bestätigung. Unaufgefordert zugesandte oder weitergeleitete Codes sollen nicht bestätigt werden.
4. Der Bot bindet die Challenge einmalig an den bestätigenden Absender. Falls noch kein Konto besteht, durchläuft die Person die Registrierung. Persönliche Erinnerungen bleiben eine getrennte Option.
5. Nur der Browser mit passender ursprünglicher Bindung kann die abgeschlossene Challenge gegen eine neue Serversession tauschen. Ein öffentliches Polling über eine erratbare ID reicht nicht.
6. Die Session verwendet ein zufälliges Cookie mit Secure, HttpOnly und SameSite; in D1 liegt nur dessen Hash. Logout und Kontolöschung widerrufen Sessions.

Der Kurzcode, falls für manuelles Abtippen angeboten, hat strenge Versuchslimits und darf nicht allein die Browserbindung ersetzen. Login-Codes werden weder im Gruppenchat akzeptiert noch in Logs gespeichert. Links und GET-Aufrufe erzeugen keine Anmeldung und verbrauchen keine Challenge: WhatsApp-Vorschauen und Linkscanner dürfen keine Aktionen auslösen.

Ein nur im Bot eingegebenes /login startet zunächst das Konto-Menü oder stellt einen Link zum beschriebenen Browserablauf bereit. Ein beliebiger Link aus einer Botantwort ist kein dauerhaftes Login-Token. Für Admin-Aktionen wird eine frische WhatsApp-Bestätigung verlangt; Rollen werden bei jeder Aktion serverseitig geprüft. Vorgeschlagene Sessiondauer: Mitglieder sieben Tage, Admins acht Stunden; sensible Rollenänderungen benötigen einen neuen Nachweis.

Bei Nummernwechsel darf TT Konten nicht automatisch aufgrund gleicher Namen zusammenführen. Übertragung muss alte und neue Identität bestätigen; bei Verlust hilft ein kontrollierter Betreiberprozess. Eine neu vergebene Telefonnummer beweist nicht dieselbe natürliche Person. Diese Grenzen bleiben auch bei einer reinen WhatsApp-Anmeldung bestehen.

Spätere Vereinsanmeldungen nutzen denselben Besitznachweis, aber eigene Formulare, Zwecke und Zustimmungsschritte. Kontoregistrierung, Teilnahme am Training und rechtlich verbindliche Vereinsanmeldung sind unterschiedliche Vorgänge.

## Evolution Vertrag und Identitätszuordnung

Der untersuchte Quellstand ist fa09d37892cdbb1d65a250155d293d92230c5b30; package.json nennt 2.3.7. Das ist eine überprüfte Quellbasis, keine Aussage über die neueste veröffentlichte oder beim Anbieter installierte Version. Vor Implementierung werden Image-Version beziehungsweise Digest, Provider-Modus und tatsächliche Antwortformate festgehalten. Kein ungeprüftes latest-Image als Vertrag.

Benötigte Routen der geprüften TypeScript-Implementierung sind insbesondere POST /message/sendText/{instanceName}, POST /message/sendReaction/{instanceName}, POST /webhook/set/{instanceName}, GET /webhook/find/{instanceName} sowie Instanzstatus und Gruppenauflistung. Reaktion senden und Reaktion empfangen sind getrennte Fähigkeiten. Ein funktionierender SendReaction-Aufruf beweist den Empfang nicht.

Mindestens benötigt werden MESSAGES_UPSERT, MESSAGES_UPDATE, CONNECTION_UPDATE und nach Bedarf GROUP_PARTICIPANTS_UPDATE. Der Adapter akzeptiert nur die konfigurierte Instanz, aktivierte Gruppen und private TT-Dialoge. Ausgehende Botnachrichten mit fromMe werden nicht als Nutzerkommandos erneut verarbeitet. Historienimporte und alte append-Ereignisse dürfen nicht aktuelle Verspätungsmeldungen auslösen.

Bei einer Gruppenreaktion ist der äußere Nachrichtenabsender die reagierende Person. reactionMessage.key identifiziert die Nachricht, auf die reagiert wurde, und kann den ursprünglichen Nachrichtenautor beschreiben. Wer beide verwechselt, würde die Zusage dem Bot zuschreiben. Gruppen-JID, ursprüngliche Nachricht-ID und äußere Absenderidentität müssen gemeinsam validiert werden.

WhatsApp verwendet Telefonnummern-JIDs und LIDs. Der Adapter verarbeitet participant, participantAlt, remoteJid und remoteJidAlt entsprechend Privat- oder Gruppenchat. Eine @lid-Kennung darf nicht durch Entfernen des Suffixes zur Telefonnummer gemacht werden. Eine erhaltene verlässliche Zuordnung kann als Alias hinterlegt werden. Bei widersprüchlichen oder fehlenden Zuordnungen wird keine Adminberechtigung vergeben und kein Konto geraten. Technisch adressierbare LID-Identitäten können zunächst ohne bekannte Telefonnummer geführt werden; der genaue Anbieter muss diese Adressierung im Test unterstützen.

Aktuelle Evolution-Fehlerberichte nennen Probleme bei LID-Zuordnung und verlorenen Reply-Metadaten. Das sind versionsbezogene Berichte, kein Beweis, dass jede Instanz betroffen ist. TT verwendet deshalb gespeicherte Nachrichten-IDs und explizite Termin-IDs und prüft die echte Instanz vor Freigabe. [Evolution Bericht zu Reply-Metadaten](https://github.com/evolution-foundation/evolution-api/issues/2713)

Quellverträge: [Message DTOs](https://github.com/evolution-foundation/evolution-api/blob/fa09d37892cdbb1d65a250155d293d92230c5b30/src/api/dto/sendMessage.dto.ts), [Baileys Adapter](https://github.com/evolution-foundation/evolution-api/blob/fa09d37892cdbb1d65a250155d293d92230c5b30/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts), [Webhook Schema](https://github.com/evolution-foundation/evolution-api/blob/fa09d37892cdbb1d65a250155d293d92230c5b30/src/api/integrations/event/webhook/webhook.schema.ts)

Native Buttons sind eine spätere Komfortfunktion. Version 1 funktioniert mit normalen Texten, Emojireaktionen und Links. Dass eine API einen Button-Endpunkt anbietet, beweist keine zuverlässige Darstellung auf allen WhatsApp-Clients. Es darf keinen Ablauf geben, der ausschließlich über einen nicht getesteten Button bedienbar ist.

## Dauerhafte Daten

| Datensatz | Inhalt |
| --- | --- |
| users und identity_aliases | Interne Nutzer-ID, WhatsApp-Kennungen, optionale verifizierte Telefonnummer, gewünschter Name |
| roles | Owner und Trainerrollen mit Geltungsbereich und Vergabeverlauf |
| groups und memberships | Aktivierte WhatsApp-Gruppe, Berechtigung und Mitgliedschaftsstatus |
| training_series | Wochentag, lokale Uhrzeiten, Zeitzone, Ort, Gültigkeit, Erinnerungsregeln |
| training_exceptions | Ausfall, Pause, Verschiebung oder Sondertermin |
| training_sessions | Konkrete Termine mit stabiler ID, UTC-Zeit und Versionsnummer |
| attendance | Teilnahme, Verspätung, optionale Minuten, Quelle und Version pro Person und Termin |
| messages | Gesendete Einladungs- und Verspätungsnachrichten mit Evolution-ID, Chat und Termin |
| inbox_events | Minimale normalisierte Ereignisse, Deduplizierung und Bearbeitungsstatus |
| outbox_jobs | Zu sendende Nachricht, Fälligkeit, Ablauf, Versuchszähler, Lease und Ergebnis |
| consents und subscriptions | Dokumentierter Zweck, Textversion, Zustimmung beziehungsweise Widerruf und Erinnerungsoption |
| auth_challenges und auth_sessions | Hashes, Ablauf, Browserbindung, einmalige Verwendung und Nutzer-ID |
| settings und bootstrap | Fachliche Einstellungen und dauerhafter Einrichtungsstatus |
| audit_log | Änderungen an Terminen, Rollen und Sicherheitsfunktionen ohne kompletten Chatinhalt |

Eindeutige Indizes schützen Teilnahme pro Termin und Person, Identitätsalias, Ereignisverarbeitung und logischen Versandauftrag. Für atomare Datenänderungen dient D1 batch mit bedingten SQL-Anweisungen; eine erfolgreiche Ausführung ohne betroffene Zeile ist noch keine erfolgreiche Rechtevergabe. SQL-Batches sind Transaktionen, externe HTTP-Aufrufe an Evolution dagegen nicht. [D1 Transaktionen](https://developers.cloudflare.com/d1/worker-api/d1-database/)

## Zeitsteuerung und zuverlässiger Versand

Der Cron läuft jede Minute. Er fragt indizierte, fällige Aufgaben ab, reserviert sie atomar und verarbeitet nur eine begrenzte Anzahl. Neue Webhooks schreiben zuerst Eingang und notwendige Folgevorgänge dauerhaft; erst danach erfolgt die Bestätigung an Evolution. Eine unmittelbare Verarbeitung kann die Antwort beschleunigen, der Cron nimmt nach Abbrüchen verbliebene Arbeit wieder auf.

Training wird in Europe/Berlin als lokale Kalenderzeit geplant und anschließend in UTC gespeichert. Cron selbst läuft in UTC. „Am Vortag um 18:00“ und „genau 24 Stunden vorher“ sind verschiedene Regeln; Standard ist die lokale Uhrzeit am vorherigen Kalendertag. Die zweite Nachricht liegt standardmäßig 30 Minuten vor Trainingsbeginn. Sommerzeitwechsel, ungültige lokale Zeiten und verschobene Termine werden ausdrücklich geprüft. [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

Jeder Versandauftrag hat einen eindeutigen Schlüssel aus Termin, Terminversion, Nachrichtentyp und Ziel. Vor Versand werden Absage, aktuelle Version, Mitgliedschaft und Opt-in erneut geprüft. Entfernte Gruppenmitglieder erhalten keine weiteren persönlichen Gruppentrainingsnachrichten. Eine Absage annulliert noch nicht gesendete Jobs.

Bei 429 oder eindeutigen vorübergehenden Fehlern wird mit begrenztem Backoff und gegebenenfalls Retry-After erneut versucht. Persönliche Nachrichten werden gedrosselt. Aufgaben haben eine sinnvolle Ablaufzeit: Eine Einladung von gestern darf nicht nach Ende des Trainings versendet werden. Scheitern wichtige Nachrichten dauerhaft, erscheint dies unter /status und in den Betriebsmetriken.

Es gibt eine unvermeidbare Unschärfe: Evolution könnte eine Nachricht angenommen haben, während TT die Antwort wegen eines Timeouts verliert. Ohne nachgewiesenen idempotenten Sendevertrag lässt sich exakt einmaliger Versand über diese zwei Systeme nicht garantieren. Solche Fälle werden als unklar markiert und nach Möglichkeit über Nachrichtenabfrage oder Send-Ereignisse abgeglichen. Ein blindes erneutes Senden wird vermieden; die verbleibende Unsicherheit wird dem Trainer angezeigt. Ein eindeutiger Outbox-Schlüssel allein löst diese HTTP-Grenze nicht.

Ein Cron-Intervall von einer Minute ist eine passende Planungsauflösung für Training, aber keine garantierte Zustellung auf die Sekunde. Evolution-Verbindung, WhatsApp und Endgerät können zusätzliche Verzögerungen erzeugen. Persönliche Eingangsbestätigungen sollen unter normalem Betrieb innerhalb weniger Sekunden erfolgen, werden aber nicht als SLA versprochen.

## Datenschutz und Jugendtraining

Der Screenshot zeigt Jugendtraining. Vor Einsatz müssen Verein beziehungsweise verantwortliche Person, Rechtsgrundlage für die Gruppenorganisation, Empfänger und Dienstleister feststehen. Der Bot erhält gegebenenfalls auch Nachrichten nicht registrierter Mitglieder. Eine Registrierungseinwilligung einzelner Personen deckt nicht automatisch die Verarbeitung des gesamten Gruppenverkehrs ab. Deshalb: Gruppe vor Aktivierung informieren, nur relevante Inhalte kurzfristig auswerten und alternative Rückmeldung beim Trainer ermöglichen.

Für freiwillige persönliche Erinnerungen wird ein eigenes nachweisbares Opt-in mit einfachem Widerruf vorgesehen. Bei direkt an Kinder angebotenen Diensten, deren Verarbeitung auf Einwilligung beruht, ist Artikel 8 DSGVO zu prüfen; unter den dortigen Voraussetzungen kann elterliche Zustimmung erforderlich sein. Das ist keine pauschale Aussage, dass jedes Vereinskonto unter 16 verboten wäre. [DSGVO Artikel 6 bis 8 und 13](https://eur-lex.europa.eu/eli/reg/2016/679/oj)

TT erfasst keine Profilbilder, Adressbücher, Geburtstage oder Abwesenheitsgründe. „Ich bin krank“ wird höchstens als Absage behandelt; der Gesundheitsgrund wird nicht dauerhaft übernommen. Teilnehmerlisten sind nur für berechtigte Trainer sichtbar. Gruppenmitglieder sehen weiterhin die von WhatsApp öffentlich dargestellten Gruppenreaktionen; eine private Rückmeldung veröffentlicht TT nicht automatisch in der Gruppe.

Vorgeschlagene Aufbewahrung, vor Betrieb mit dem Verantwortlichen festzulegen: irrelevanter Nachrichtentext nur flüchtig; erforderlicher Text für offene Rückfragen maximal 24 Stunden; normalisierte Zustell- und Fehlerdaten sieben Tage; Deduplizierungskennungen ohne Inhalt 30 Tage; Teilnahme je Termin 90 Tage; Sicherheits- und Adminänderungen 180 Tage. Einwilligungsnachweise werden zweckgebunden für eine begründete Dauer geführt. Löschung darf erforderliche Nachweise nicht stillschweigend mit endloser Aufbewahrung ersetzen.

Evolution kann selbst Chatverläufe, Kontakte, Medien und Logs speichern. TT-Datenminimierung genügt deshalb nicht: auch dort Speicherung reduzieren, Löschfristen einrichten und Zugang beschränken. Vereinbarungen mit Cloudflare und dem Evolution-Betreiber, mögliche weitere Empfänger und Datenübermittlungen gehören in die Datenschutzhinweise. EU-D1 ist ein Baustein, keine vollständige DSGVO-Zusage.

## Betrieb und Kosten

Für eine kleine Trainingsgruppe kann Worker Free plus D1 Free ausreichend sein; Nachrichtenanzahl, Cronabfragen und CPU müssen trotzdem gemessen werden. Workers Paid beginnt laut aktueller Dokumentation bei 5 USD pro Monat für das Konto; Evolution-Hosting beziehungsweise Anbietergebühren, neue Rufnummer und eventuelle Steuern kommen hinzu. Kostenfreiheit wird nicht versprochen. [Workers Preise](https://developers.cloudflare.com/workers/platform/pricing/)

Entwicklung und Tests verwenden lokale D1 und Payload-Beispiele. Eine Testumgebung braucht eigene Daten und eine ausdrücklich ausgewählte Testgruppe; sie darf nicht mit derselben Instanz den produktiven Webhook überschreiben. Für parallele echte Tests wäre eine getrennte Evolution-Testinstanz nötig. Fehlertests können ansonsten gegen einen Adapter-Simulator laufen.

CI prüft Typen, Lint, fachliche Tests und Worker-Build. Deployment verwendet möglichst eng begrenzte Cloudflare-Rechte. Produktionsfreigabe erfolgt nach echter Testgruppen-Abnahme. Migrationen sind versioniert und möglichst rückwärtskompatibel; ein Worker-Rollback rollt keine Datenbankänderung automatisch zurück.

D1 Time Travel bietet derzeit sieben Tage Wiederherstellung im Free-Plan und 30 Tage im Paid-Plan. Vor riskanten Migrationen wird ein Wiederherstellungspunkt erfasst. Nach einem Restore werden Senderoutine und Ersteinrichtung zunächst gesperrt, weil ältere Daten sonst bereits versendete Jobs oder verbrauchte Codes wieder aktiv machen könnten. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

Metriken zeigen letzten erfolgreichen Schedulerlauf, Alter wartender Jobs, unklare Sendefälle, Evolution-Verbindungsstatus und Auth-Fehler. /status ist nur für Admins; /health verrät keine Teilnehmerdaten. Ein WhatsApp-Ausfall kann nicht zuverlässig über denselben ausgefallenen WhatsApp-Kanal gemeldet werden; Cloudflare-Fehleranzeigen beziehungsweise vorhandenes externes Monitoring müssen dann den Betreiber erreichen. Trainer können bei Ausfall weiterhin manuell organisieren.

## Abnahme vor produktiver Nutzung

| Bereich | Nachweis |
| --- | --- |
| Evolution-Grundvertrag | Senden und Empfangen in Testgruppe und Privatdialog; echte Version, Instanzname und Berechtigungen |
| Reaktionen | 👍, 👎, Wechsel, Entfernung, Hautfarbvarianten, ⏰ und richtig identifizierte Person auf Android und iOS |
| Identität | Gruppen-JID, Telefonnummern-JID, LID mit und ohne Alternativkennung; keine falsche Kontozusammenführung |
| Termine | Serien, Ausfall, Pause, Sondertermin, Verschiebung, Zeitumstellung und kurz vor Versand erfolgende Änderung |
| Zustände | Gruppe und Privatdialog nacheinander; Entfernen alter Reaktion überschreibt keine neue Entscheidung |
| Sprachregeln | Screenshot-Beispiel, Tippfehler, Negation, Konditionalsatz, Drittperson und irrelevante Nachricht |
| Erstadmin | Zwei gleichzeitige Versuche; falscher und abgelaufener Code; JA/NEIN; dauerhafte Sperre nach Abschluss |
| Anmeldung | Abgelaufene und wiederverwendete Challenge; fremder Browser; weitergeleiteter Code; fehlende Bestätigung |
| Optionalität | Teilnahme ohne Konto; Konto ohne Erinnerungen; /stop stoppt schon geplante persönliche Sendungen |
| Webhook | Falscher Token, fremde Instanz, doppelte Ereignisse, Historienimport und Bot-Endlosschleife |
| Versand | Evolution offline, 429, eindeutig fehlgeschlagen, Timeout nach möglicher Annahme und verspäteter Cron |
| Datenschutz | Keine apikey-/Code-/Chatpayload-Logs; Löschung und Aufbewahrung in TT und Evolution |
| Web später | Gemeinsame Domain, korrekte API-404, geschützte Trainerdaten und Logout |

Der reale Test der eingehenden Gruppenreaktionen einschließlich Entfernen ist der erste technische Freigabepunkt. Wenn der Anbieter das nicht zuverlässig liefert, bleiben explizite Privatkommandos eine mögliche Alternative; die gewünschte Reaktionsfunktion darf dann nicht als erfüllt gelten.

## Umsetzung in Etappen

1. Evolution-Vertrag in einer Testgruppe nachweisen. Anbieter, Modus, Authentifizierung, Webhook und Identitätsfelder festhalten. Verantwortlichen und Gruppeninformation klären.
2. Privates TT-Monorepo mit Worker, D1-Migrationen, Evolution-Adapter, abgesicherter Ersteinrichtung und Adminrollen aufbauen.
3. Serien, Ausnahmen, Cron, dauerhafte Ein- und Ausgangsverarbeitung sowie beide Gruppennachrichten implementieren.
4. Teilnahme, Reaktionsänderungen, Verspätungsparser und passende Bestätigungen ergänzen. Reale Testgruppen-Abnahme.
5. Freiwillige Konten, getrenntes Erinnerungs-Opt-in, Kontaktkarte und persönliche Rückmeldungen ergänzen. WhatsApp-Challenge-Service von Beginn an für spätere Web-Anmeldung vorsehen.
6. Info, Datenschutz und benötigte Login-Seiten auf tt.bz3.eu ausliefern und Betrieb freigeben.
7. Später das React-Dashboard für Termine, Ausnahmen, Teilnehmerübersicht und Admins im selben Worker ergänzen. WhatsApp bleibt der einzige Anmeldekanal und weiterhin vollwertiger Verwaltungsweg.

Die erste Produktversion enthält damit den vollständigen WhatsApp-Ablauf, aber kein Verwaltungsdashboard. Sie erfüllt die spätere Erweiterung durch gemeinsame Dienste, interne Nutzer-IDs, stabile Termin-IDs und denselben Domain- und Deployment-Vertrag.
