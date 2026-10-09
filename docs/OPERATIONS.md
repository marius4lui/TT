# Betrieb

Stand: 9. Oktober 2026. Das bestehende Hosting auf `tt.bz3.eu` umfasst Worker, Website, EU-D1 und Minuten-Cron. Evolution und der authentifizierte Webhook sind angeschlossen; der Owner hat die eigene Demogruppe und den Hinweis für den bisherigen privaten Funktionstest bestätigt. Automatische Trainingsnachrichten bleiben pausiert. Die neue Verwaltung über die Website ist lokal geprüft, aber noch nicht veröffentlicht oder mit dem vollständigen Ablauf an echten WhatsApp-Geräten abgenommen. Vor regulärem Einsatz die offenen Punkte aus [ACCEPTANCE.md](ACCEPTANCE.md) abschließen.

## Alltag über die Website

Privat „anmelden“ oder `/login` an den Bot schreiben. Seine Antwort enthält einen persönlichen, einmaligen Anmeldelink mit zehn Minuten Laufzeit. Die Website zeigt den erkannten Namen und eine gekürzte Kontokennung; erst der ausdrückliche Klick bestätigt die Anmeldung. Ein Vorschauaufruf verbraucht den Link nicht. Der Link ist ein Zugangsnachweis: Wer ihn besitzt, kann die angezeigte Identität bestätigen und sich anmelden. Deshalb niemals weiterleiten. Ein neuer Link widerruft einen noch offenen älteren Link. Die Authentifizierungsdatensätze speichern Token-Hashes; der Link liegt für die Zustellung kurzzeitig im privaten Antwortauftrag, dessen Inhalt nach erfolgreichem Versand entfernt wird. Tokens und Sessionwerte gehören nicht in Logs.

Owner und Admin gelangen direkt in den geschützten Bereich `/trainer`. Eine Teilnehmerregistrierung ist für Trainer weder erforderlich noch automatisch damit verbunden. Jede Traineranfrage prüft die aktuelle Rolle; Änderungen prüfen Rolle und betroffene Versionen nochmals im Datenbank-Commit. Websessions gelten höchstens sieben Tage. Trainersessions enden zusätzlich nach 24 Stunden ohne Aktivität; Nutzung verlängert die absolute Höchstlaufzeit nicht. Logout widerruft die betreffende Serversession. Sitzungscookies sind Secure, HttpOnly und SameSite.

Der Trainerbereich verwaltet Gruppen, wöchentliche Serien, einzelne Trainings, Verschiebungen, Absagen und Pausen. Entfernte Ausnahmen stellen nur die betroffenen Termine wieder her; andere Absagen bleiben erhalten. Terminänderungen machen alte Zusagen als erneut zu bestätigen sichtbar. Die Teilnahmeübersicht enthält Mitglieder, Zusagen, Absagen, Verspätungen und offene Antworten. Manuelle Korrekturen prüfen den aktuellen Termin und den bisherigen Antwortstand. Öffentliche Trainingsinformationen und Datenschutzhinweise werden hier gepflegt. Die verantwortliche Stelle prüft die vollständigen Hinweise und bestätigt die Veröffentlichung; den Freigabewert `privacy_ready` nicht direkt in D1 ändern.

Teilnahme bleibt ohne Webkonto möglich. Mitglieder reagieren mit 👍 oder 👎 auf die Trainingsabfrage und mit ⏰ auf die Verspätungsabfrage; das Entfernen der ⏰-Reaktion nimmt diese Meldung zurück. Gruppenreaktionen erzeugen keine zusätzlichen Bestätigungsnachrichten. Private Formulierungen wie „Ich komme zehn Minuten später“ werden mit begrenzten deutschen Mustern erkannt. Mehrdeutige Aussagen führen zu einer Rückfrage; TT versteht nicht beliebige natürliche Sprache.

Nur die einmalige Gruppenbegrüßung enthält den Info-Link und die KMUC-Fußzeile. Wiederkehrende Abfragen bleiben ohne Links; der Bot legt die ⏰-Reaktion selbst vor. Wird eine Einladung erst innerhalb von zehn Minuten vor der geplanten Verspätungsabfrage zugestellt, enthält sie zusätzlich ⏰ und ersetzt die separate Abfrage. Die kombinierte Nachricht erlaubt 👍/👎/⏰; zum Wechsel von „später“ auf „pünktlich dabei“ auf 👍 wechseln. Bei der separaten Verspätungsnachricht genügt das Entfernen der eigenen ⏰-Reaktion, die Zusage bleibt erhalten.

Verspätungsabfragen werden höchstens fünf Minuten nach Beginn nachgeholt. Persönliche Verspätungsabfragen entfallen bei einer aktuellen Absage oder schon eingetragener Verspätung. Der Reaktionsversand ist ein eigener dauerhafter Auftrag (`clock` beziehungsweise `personal_clock`): Ein Fehler wiederholt niemals den Trainingstext. Bereits gesendete, noch aktuelle Verspätungsabfragen erhalten die Reaktion einmalig nachträglich. Alte `/r/`-Links führen nur noch zu den Informationen, nicht mehr zu vorbefüllten WhatsApp-Nachrichten mit internen Kennungen.

Ein freiwilliges Mitgliederkonto benötigt eine ausdrückliche Zustimmung auf der Website. Persönliche Mitgliedererinnerungen sind eine zweite, getrennte Zustimmung und zunächst ausgeschaltet. Auf `/konto` lassen sich Name und Erinnerungen ändern, die eigenen Daten abrufen und das Konto löschen. Ein Widerruf sperrt auch bereits geplante persönliche Sendungen.

Trainer können unabhängig davon ihre persönliche Trainerübersicht einschalten. Sie ist zunächst aus und benötigt keine Teilnehmerregistrierung. Der Vorlauf beträgt standardmäßig zehn Minuten und kann zwischen null und 120 Minuten eingestellt werden. Anzahl der Rückmeldungen, Absagen und Verspätungen sind getrennt wählbar. Die Nachricht verwendet den aktuellen Antwortstand beim Versand. Geänderte Einstellungen, Widerruf, Rollenentzug oder eine geänderte Terminversion sperren alte Aufträge. Ein neues Opt-in löst keine rückwirkende Übersicht aus.

## Gruppenfreigabe und Aktivierung

Einen WhatsApp-Gruppenlink im Trainerbereich einfügen. TT prüft die Gruppenmetadaten und legt zunächst eine offene Freigabeanfrage an. Erst die ausdrückliche Freigabe durch einen Trainer erlaubt Beitritt beziehungsweise Aktivierung und die einmalige Begrüßung „Powered by KMUC“. Ein unklarer Beitrittsversuch bleibt als solcher sichtbar und wird vor einer erneuten Aktion abgeglichen.

Wird der Bot direkt einer Gruppe hinzugefügt, entdeckt TT sie über `GROUPS_UPSERT` beziehungsweise beim Aktualisieren der Gruppen. Auch dieser Weg erzeugt zuerst eine offene Anfrage. Das Auswählen einer Gruppe aktiviert sie nicht: Die Auswahl akzeptiert nur bereits freigegebene, aktive Gruppen. Mitgliedschaften und Begrüßung werden durch den Freigabeablauf gepflegt.

Vor dem Start die Gruppe informieren und Datenschutzhinweise prüfen. Trainingsnachrichten erst danach im Trainerbereich ausdrücklich aktivieren. Eine Gruppenfreigabe mit Begrüßung ist vom Aktivieren der regelmäßigen Trainingsnachrichten getrennt. Pausieren sperrt geplante Trainingssendungen; beim erneuten Aktivieren werden nur unversuchte zukünftige Aufträge der aktuellen Terminversion wieder freigegeben. Unklare oder schon versuchte Sendungen werden dadurch nicht wiederholt. Die Versandansicht zeigt den letzten Cronlauf, Auftragszahlen und nächste Termine, auch während der Pause.

## Konfiguration und lokale Prüfung

`wrangler.jsonc` enthält die Worker-/Domain-Konfiguration, die vorhandene D1-ID sowie Evolution-URL und Instanz. Die bestehende Datenbank `tt` nicht neu anlegen. Der Worker benötigt `EVOLUTION_URL`, `EVOLUTION_INSTANCE` und `EVOLUTION_API_KEY`. Lokal liest Wrangler den API-Key aus der ignorierten Datei `.dev.vars`; auf Cloudflare liegt er als Worker-Secret. Er gehört niemals in `vars`, Git, Frontend-Dateien oder Logs. Die verschlüsselte Windows-Eingabe und Prüfung sind in [CREDENTIALS.md](CREDENTIALS.md) beschrieben.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:local
pnpm smoke
pnpm dev
```

`pnpm check` prüft Typen, Tests, Operator-Skripte und den Worker-Dry-Run. `pnpm smoke` verwendet einen echten lokalen Wrangler/workerd, eine isolierte D1 und einen lokalen Mock-Evolution-Server. Es sind weder ein externes Konto noch echte Nachrichten beteiligt. Erfolgreiche lokale Läufe ersetzen keine reale Zustellungs- oder Geräteabnahme. CI deployed nichts; der derzeit bekannte Abrechnungsblock ist kein erfolgreicher CI-Nachweis.

Neue Migrationen vor einem passenden Worker-Deploy auf das richtige Ziel anwenden. `pnpm db:migrate:remote` verändert die Remote-D1; zuvor Konto, Datenbank-ID und Wiederherstellungspunkt prüfen. Ein Worker-Rollback setzt D1 nicht zurück. Bestehende Owner-, Gruppen- und Datenschutzzustände beibehalten und den Nachrichtenbetrieb während der Umstellung pausiert lassen. Die neue Webversion und ihre additiven Migrationen sind getrennt vom schon veröffentlichten Hosting zu behandeln.

## Einmalige Einrichtung und Webhook

Nur für eine neue Einrichtung nach den Migrationen ausführen:

```sh
node scripts/setup.mjs --local
node scripts/setup.mjs --remote
node scripts/setup.mjs --remote --connect
```

`--local` und `--remote` wählen das D1-Ziel und erzeugen einen zufälligen Bootstrap-Code mit 30 Minuten Laufzeit. Privat `/einrichten CODE` senden und den reservierten ersten Owner mit `JA` bestätigen. Einen nicht abgeschlossenen Versuch kann `--reset-bootstrap` bewusst erneuern; eine abgeschlossene Owner-Einrichtung wird nicht zurückgesetzt. Für die bereits eingerichtete Demoinstanz keinen neuen Bootstrap anlegen.

`--remote --connect` liest alle drei Evolution-Werte aus der Prozessumgebung. `.dev.vars` wird vom separaten Node-Skript nicht automatisch geladen. Das Skript prüft HTTPS, verbundene Instanz und Botidentität, setzt den Worker-API-Key als Secret und registriert einen authentifizierten Webhook. D1 speichert den Hash seines zufälligen Bearer-Tokens. Der Readback prüft URL, Aktivierung, Authentifizierungsheader und `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `GROUP_PARTICIPANTS_UPDATE` sowie `GROUPS_UPSERT`; `byEvents` muss ausgeschaltet sein. Ein fremder bestehender Webhook wird nur mit ausdrücklichem `--replace-webhook` ersetzt.

Das Setup-Skript sendet keine WhatsApp-Nachrichten, aktiviert keine Trainingsautomatik und deployed keinen Worker. `EVOLUTION_URL` und `EVOLUTION_INSTANCE` müssen zum selben Ziel in `wrangler.jsonc` passen. Alle Flags stehen unter `node scripts/setup.mjs --help`. Bei pnpm ausdrücklich `pnpm run setup …` verwenden; `pnpm setup` kollidiert mit der pnpm-eigenen Abkürzung.

## Rückmeldungen und Korrekturen ohne KI

Die Spracherkennung läuft ausschließlich mit lokalen, begrenzten Regeln im Worker; es gibt keinen KI-Dienst und keine neue Speicherung von Gesprächsverläufen. Klare Selbstaussagen ersetzen die eigene Rückmeldung zum passenden Training, auch nach einer vorherigen Absage.

| Beispiel                                            | Wirkung                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| „Ich komme heute mal net“                           | Absage                                                                             |
| „Bzw ich komme doch aber ich bin 5 Minuten zu spät“ | Zusage, fünf Minuten verspätet                                                     |
| „Ich komme 10 min später, Korrektur: 5 min später“  | Fünf Minuten verspätet                                                             |
| „Korrektur: doch pünktlich“                         | Zusage, Verspätung und alte Ankunftszeit entfernt                                  |
| „Bzw komme doch nicht“                              | Absage, Verspätung entfernt                                                        |
| „Ich komme, aber erst gegen 18:20“                  | Ankunftszeit am ausgewählten Termin; Verspätung wird gegen dessen Beginn berechnet |

„Bzw.“, „beziehungsweise“, „aber“, „allerdings“, „doch“ und kurze Selbstkorrekturen werden als zusammenhängende Satzteile ausgewertet. Zahlen, ausgeschriebene Minuten, halbe und Viertelstunden sind möglich. Zeitspannen wie „5–10 Minuten“ werden als Verspätung ohne erfundene genaue Minutenangabe erfasst. „In fünf Minuten“ ist keine Angabe von fünf Minuten Verspätung. Ein isoliertes „Ja“, „Nein“, „Doch“ oder „5 Minuten“ verändert nichts.

Bei mehreren passenden Terminen fragt der Bot nach dem Termin. Unsichere oder widersprüchliche Selbstaussagen lösen eine kurze Klärung aus und ändern nichts. Zitate, fremde Personen und nicht unterstützte Datumsangaben werden nicht als Zusage verwendet. Die Regeln sind bewusst begrenzt und verstehen nicht jede beliebige Formulierung. Neue Beispiele als positive **und** negative Regressionstests in `packages/core/tests/language-corrections.test.ts` ergänzen; Zustandswechsel zusätzlich in `tests/bot.test.ts` prüfen.

## Trainingsfragen im Chat

Drei getrennte, rein regelbasierte Bereiche beantworten klare Fragen mit einer kurzen Nachricht:

- Termine: „Wann ist nächstes Mal Training?“, „Armin wann ist noch mal Training“, „Ist morgen Training?“ oder „Fällt das Training heute aus?“
- Details: „Wo ist Training?“, „Um wie viel Uhr beginnt das Training?“, „Wann endet das Training?“ und „Wie lange dauert das Training?“
- Eigene Rückmeldung: „Bin ich angemeldet?“, „Habe ich fürs Training zugesagt?“ oder „Bin ich als verspätet eingetragen?“

Antworten enthalten die gespeicherten Daten, keine internen Termin-IDs und keine wiederholten Links. „Nächstes Training“ überspringt einen laufenden Termin und berücksichtigt Absagen. Ohne „nächstes“ kann ein laufender Termin gemeint sein und wird entsprechend bezeichnet. Heute und morgen werden in der Zeitzone des jeweiligen Termins ausgewertet. Fehlende Plandaten werden ausdrücklich als fehlender Eintrag beschrieben, nicht als Zusicherung, dass kein Training stattfindet.

In Gruppen beziehen sich Auskünfte nur auf diese Gruppe. Privat werden ausschließlich freigegebene Gruppen mit aktiver eigener Mitgliedschaft berücksichtigt; mehrere passende Gruppen werden beschriftet. Eigene Statusfragen zeigen nur die eigene Rückmeldung, ändern weder Teilnahme noch Registrierung oder Erinnerungszustimmung und weisen auf nötige Neubestätigung nach Terminänderungen hin.

Normales Gespräch, Zitate, Aussagen über andere und nicht unterstützte Datumsfragen lösen keine Auskunft aus. Die bisherigen Rückfragen zu mehrdeutigen Teilnahmeaussagen bleiben bestehen. `/termine` ist weiterhin als Auskunft verfügbar; `/training` zeigt in einer Gruppe die Termine, privat bleibt der ältere Trainerdialog erhalten. Neue Fragevarianten gehören mit Gegenbeispielen in `tests/questions-*.test.ts`.

## Ausfälle und Wiederanlauf

Einladungen, Änderungen und persönliche Übersichten liegen dauerhaft in D1. Versand prüft Terminversion, Gruppenzustand und gegebenenfalls aktuelle Rolle und Zustimmung. Begrenzte Wiederholungen sind nur bei eindeutig wiederholbaren Fehlern erlaubt. Bei Timeout nach möglicher Annahme oder unterbrochenem Sender bleibt der Auftrag `uncertain`; nicht blind erneut senden, da die Nachricht schon in WhatsApp stehen könnte.

Bei Provider-Ausfall Änderungen nicht als zugestellt behandeln und das Training vorübergehend manuell organisieren. Nach einer D1-Wiederherstellung zunächst pausiert bleiben, gespeicherte Jobs und Anmeldelinks prüfen und erst anschließend bewusst freigeben. Fehlerberichte enthalten keine API-Keys, vollständigen Telefonnummern/JIDs, Anmeldelinks oder Nachrichteninhalte.

## Ältere Chatbefehle

Ältere Befehle und der browsergebundene Code-Login bleiben für Kompatibilität und Operator-Tests erhalten. Sie sind keine Anleitung für den normalen Mitglieder- oder Trainerablauf. Terminverwaltung, Zustimmungen und Gruppenfreigabe erfolgen über die Website. Die einmalige Owner-Einrichtung mit `/einrichten CODE` ist weiterhin ein separater administrativer Schritt. Die alte Annahme „ein weitergeleiteter Anmeldelink kann niemals anmelden“ gilt für den neuen persönlichen Link ausdrücklich nicht.
