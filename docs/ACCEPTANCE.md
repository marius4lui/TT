# Abnahme vor Freigabe

Stand: 9. Oktober 2026. Das bestehende Hosting und die Evolution-Anbindung wurden geprüft. Owner, eigene Demogruppe und Datenschutzhinweis wurden im bisherigen privaten Funktionstest bestätigt; die Trainingsautomatik bleibt pausiert. Lokale Checks und der Mock-Smoketest der neuen Webversion sind erfolgreich gelaufen, weitere Integrationstests begleiten die Fertigstellung. Die neue Version ist noch nicht veröffentlicht. Der neue Anmeldelink, die Gruppenfreigabe und der vollständige Ablauf wurden noch nicht mit einer Person am echten WhatsApp-Gerät abgenommen. Der bekannte CI-Abrechnungsblock bleibt offen. Ältere Nachweise stehen in [VALIDATION.md](VALIDATION.md) und gelten nur für die dort bezeichnete Version.

Die folgenden Punkte sind die verbleibende Abnahme, keine Behauptung bereits erfolgreicher Tests. Nur Datum, Umgebung, App-/Betriebssystemversion, Ergebnis und technische Referenz festhalten. Keine Telefonnummern, Tokens, API-Keys, Chatverläufe oder unnötigen personenbezogenen Daten in das Protokoll aufnehmen. Lokale Prüfungen ersetzen keine echte WhatsApp-Abnahme.

## Voraussetzungen und Veröffentlichung

- [ ] Verantwortliche Stelle und vollständige Datenschutzhinweise geprüft; die Gruppe kennt die Verarbeitung und eine alternative Rückmeldung beim Trainer.
- [ ] Ausschließlich die ausdrücklich freigegebene Demogruppe beziehungsweise Testgruppe verwenden; keine andere Instanz oder deren Webhook überschreiben.
- [ ] Zielkonto, vorhandene D1, Evolution-Instanz, Secret, Domain und Cron kontrolliert; Wiederherstellungspunkt vor Migration erfasst.
- [ ] Neue additive Migrationen und passende Webversion veröffentlicht; vorhandene Owner-/Gruppenzustände erhalten und Trainingsautomatik weiterhin pausiert.
- [ ] Abschließendes `pnpm check`, `pnpm smoke` und Formatprüfung erfolgreich dokumentiert. Der Smoke nutzt nur lokalen workerd, isolierte D1 und Mock-Evolution.
- [ ] CI-Prüfung nach Aufhebung des Abrechnungsblocks erfolgreich; lokale Ergebnisse werden bis dahin ausdrücklich getrennt ausgewiesen.

## Anmeldung, Rolle und freiwilliges Konto

- [ ] Privat „anmelden“ und `/login` liefern je einen persönlichen Link; doppelte Webhook-Ereignisse erzeugen keine mehrfachen Antworten.
- [ ] Linkvorschau meldet nicht an und verbraucht den Link nicht. Die Website zeigt die Identität und verlangt einen ausdrücklichen Klick.
- [ ] Link läuft nach zehn Minuten ab, ist nach erfolgreicher Anmeldung nicht wiederverwendbar und wird durch einen neu angeforderten Link widerrufen. Zwei gleichzeitige Abschlüsse erzeugen höchstens eine neue Session.
- [ ] Der Link ist ein Zugangsnachweis: Ein Besitzer könnte die angezeigte Identität bestätigen. Hinweis „nicht weiterleiten“ ist sichtbar; keine Behauptung einer Bindung an den ursprünglichen Browser oder Empfänger beim neuen Linkablauf.
- [ ] Trainer mit aktueller Owner-/Admin-Rolle gelangen direkt nach `/trainer`, ohne Teilnehmerregistrierung und ohne automatische Mitgliedererinnerungen.
- [ ] Unregistrierte Mitglieder können Teilnahme ohne Webkonto melden. Freiwillige Registrierung und persönliche Mitgliedererinnerungen werden auf der Website getrennt bestätigt; Widerruf sperrt auch geplante persönliche Aufträge.
- [ ] Cookie ist Secure, HttpOnly und SameSite; Logout widerruft die Session. Höchstens sieben Tage Laufzeit, für Trainer zusätzlich 24 Stunden ohne Aktivität. Rollenentzug sperrt Trainerzugriff sofort.
- [ ] Ungültige Session, fremde Origin und anonyme Trainer-API-Anfragen werden abgelehnt; personenbezogene Antworten sind `no-store`.
- [ ] Gruppen-JID, LID und explizit verknüpfte Telefonnummern-JID führen nicht zu falschen Kontozusammenführungen. Name allein beweist keine Identität.
- [ ] Datenabruf, Kontoänderung, Löschung und Owner-/Admin-Verwaltung werden nur für die jeweils berechtigte Identität ausgeführt.

## Gruppenfreigabe und WhatsApp

- [ ] Gruppenlink erzeugt eine offene Anfrage und aktiviert keine Gruppe. Erst Trainerfreigabe erlaubt Beitritt/Aktivierung.
- [ ] Direkter Botbeitritt wird durch `GROUPS_UPSERT` beziehungsweise Gruppenaktualisierung erkannt und braucht ebenfalls Freigabe. Gruppenauswahl kann diese Freigabe nicht umgehen.
- [ ] Freigabe erzeugt genau eine verständliche Begrüßung mit „Powered by KMUC“. Wiederholte Ereignisse oder Freigaben verdoppeln sie nicht.
- [ ] Echter Bot kann in der freigegebenen Gruppe senden und empfangen. Gruppenreaktionen erzeugen keine zusätzlichen Bestätigungsnachrichten.
- [ ] Webhook lehnt falsches Token, falsche Instanz, eigene ausgehende Nachrichten und Historienimport ab; Wiederholungen bleiben folgenlos. `GROUPS_UPSERT` ist tatsächlich abonniert.
- [ ] Echter Provider liefert Reaktion, äußeren Absender und Zielnachricht korrekt. 👍/👎/⏰, Hautfarbenvarianten, Wechsel und Entfernen auf Android und iOS geprüft.
- [ ] Provider-Ausfall, HTTP 429, eindeutiger Fehler und Timeout nach möglicher Annahme werden unterschieden; `uncertain` wird nicht automatisch wiederholt.

## Termine, Antworten und Trainerübersicht

- [ ] Serien erstellen, bearbeiten und beenden; Einzeltraining erstellen, verschieben und absagen. Kalenderfehler und mehrdeutige Sommer-/Winterzeit werden abgelehnt.
- [ ] Pausen einschließlich überlappender Zeiträume und Ausnahmeentfernung geprüft. Wiederherstellung betrifft nur passende Termine; eigenständige Absagen und verschobene Einzeltermine bleiben erhalten.
- [ ] Terminänderung, Rollenentzug oder paralleler Cronlauf während einer Änderung führen nicht zu veralteten Erinnerungen oder teilweise übernommenen Änderungen. Frühere Zusagen werden bei Bedarf erneut abgefragt.
- [ ] Gruppen- und Privatantworten nacheinander geprüft; Entfernen einer alten Reaktion überschreibt keine neuere Entscheidung. Unveränderte oder veraltete Antworten heben eine notwendige Neubestätigung nicht auf.
- [ ] Private deutsche Sätze mit Tippfehlern, Negation, Kondition, Drittperson und mehrdeutigem Termin geprüft. Mehrdeutige Aussagen fragen nach, statt eine Teilnahme falsch einzutragen; die Erkennung bleibt auf dokumentierte Muster begrenzt.
- [ ] Traineransicht zeigt Namen, Zusagen, Absagen, Verspätungen und offene Antworten; Korrekturen prüfen Mitgliedschaft, Terminversion und vorherigen Antwortstand.
- [ ] Persönliche Trainerübersicht ist zunächst aus, funktioniert ohne Teilnehmerregistrierung und speichert ein ausdrückliches Opt-in. Standard zehn Minuten Vorlauf; Inhalt und Vorlauf lassen sich anpassen.
- [ ] Übersicht verwendet den aktuellen Stand beim tatsächlichen Versand. Widerruf, Rollenentzug, Terminänderung und geänderte Einstellungen sperren alte Aufträge; ein neues Opt-in löst keine rückwirkende Nachricht aus.
- [ ] Spät zugestellte Verspätungsabfrage nennt die tatsächlich verbleibenden Minuten. Einladungen enthalten verständliche Reaktionen und Links statt interner Termin-IDs oder Befehlsanleitungen.

## Website und Betrieb

- [ ] `/info` und `/datenschutz` zeigen freigegebene Texte; Sonderzeichen und HTML werden als Text behandelt. Anonyme APIs geben keine Teilnehmerdaten aus.
- [ ] `/konto` und `/trainer` zeigen nur Inhalte der aktuellen Berechtigung; unbekannte APIs liefern JSON-404. Öffentliche Antworten enthalten keine Zugangsdaten.
- [ ] Mobile Darstellung, Tastaturbedienung und reale Linköffnung aus WhatsApp auf den vorgesehenen Geräten geprüft. HTTP-/Quelltexttests belegen diese Geräteprüfung nicht.
- [ ] Aktivierung verlangt veröffentlichte Datenschutzhinweise, freigegebene Gruppe und ausdrückliche Bestätigung. Pausieren stoppt Trainingssendungen; erneutes Aktivieren wiederholt keine unklaren oder bereits versuchten Aufträge.
- [ ] Versandansicht zeigt letzten Cronlauf, wartende/fehlgeschlagene/unklare Aufträge und nächste geplante Nachrichten; pausierter Zustand bleibt verständlich sichtbar.
- [ ] Vorgehen bei WhatsApp-Ausfall, D1-Restore und Worker-Rollback geprüft; ein Worker-Rollback wird nicht als Datenbank-Rollback dargestellt.

## Freigabeentscheidung

Regulären Nachrichtenbetrieb erst nach erfolgreicher Abnahme der kritischen Fälle mit echten Geräten und ausdrücklicher Freigabe durch Betreiber und verantwortliche Stelle aktivieren. Nicht getestete oder vom Provider nicht unterstützte Fälle bleiben als Einschränkung dokumentiert. Ältere Chatbefehle und der frühere browsergebundene Code-Login sind Kompatibilitätsfunktionen; ihre Tests belegen den neuen persönlichen Linkablauf nicht.
