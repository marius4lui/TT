# TT ausprobieren

Im Trainerbereich **Mehr → Übungsgruppe** öffnen. Jede Trainerperson kann eine eigene WhatsApp-Gruppe anlegen. Ein Klick auf **Übungsgruppe erstellen** erstellt sie mit dem Bot und der Trainerperson. **Trainer einladen** zeigt einen Einladungslink. **Link kopieren** legt ihn in die Zwischenablage; **Über WhatsApp teilen** öffnet WhatsApp, wo du den Empfänger auswählst und die Einladung selbst versendest. Der Link gewährt nur Zugang zur Übungsgruppe, keine Trainerrechte im Web. Eingeladene Trainer vorher über die Übung und die Verarbeitung ihrer Antworten informieren.

Die Übungsgruppe funktioniert auch bei pausierten normalen Trainingsnachrichten. Sie wird nicht als Trainingsgruppe angeboten und lässt sich nicht für echte Termine aktivieren.

Das Menü führt durch **Gruppe vorbereiten → Trainer einladen → Gemeinsam üben**. Vor dem Start sind die einzelnen Situationen ausgeblendet; während der Übung gibt es eine Situationsauswahl und eine gemeinsame Schaltfläche. Die Textprobe ist zunächst zugeklappt.

## Ein einfacher Durchlauf

1. **Übung starten** anklicken und die neue Einladung in WhatsApp öffnen.
2. `Kann nicht` schreiben, danach `Kann doch`. TT bestätigt erst die Absage, dann die Zusage.
3. `Ich komme fünf Minuten später` schreiben. Unter **Aktualisieren** erscheint die Verspätung. `Ich komme doch pünktlich` entfernt sie wieder.
4. In der laufenden Übung **Jemand kommt später** auswählen und **Situation ausprobieren** anklicken. TT sendet die entsprechende Übungsnachricht. Auf diese Nachricht mit ⏰ reagieren und die Reaktion anschließend zurücknehmen. Die Zusage bleibt erhalten, die Verspätung verschwindet.
5. **Der Termin wird verschoben** auswählen und ausprobieren. TT sendet eine neue Einladung und beginnt eine neue Runde Rückmeldungen. Antworten auf die alte Einladung ändern diese Runde nicht.
6. **Das Training fällt aus** ausprobieren oder **Übung beenden** anklicken schließt die Runde. **Übung starten** beginnt wieder mit einer leeren Liste.

Die Schaltflächen spielen Situationen sofort durch; es muss kein echter Termin abgewartet werden. Eine Runde endet nach spätestens einer Stunde. Die WhatsApp-Gruppe bleibt für weitere Übungen bestehen. Rückmeldungen werden bei Neustart, Verschiebung und Ende entfernt, bei Zeitablauf im nächsten erfolgreichen Minutenlauf. WhatsApp-Nachrichten auf Geräten bleiben bestehen.

Der aufklappbare Bereich **Einen einzelnen Satz ausprobieren** ist eine reine Textprobe. Den Zusammenhang auswählen, einen Satz eingeben und **Satz ausprobieren** anklicken. Dabei wird weder eine WhatsApp-Nachricht versendet noch eine Rückmeldung gespeichert. Die Probe erklärt das Sprachmuster; beim echten Training prüft TT zusätzlich Termin, Mitgliedschaft und Aktualität. Die Übungsgruppe hat einen einzigen fiktiven Termin und fragt bei konkreten Tages- oder Terminverweisen nach.

## Wenn etwas nicht erscheint

- **Aktualisieren** zeigt den Versandstand und die zuletzt eingegangenen Antworten. Ein erfolgreicher Provider-Aufruf bestätigt die Übergabe an WhatsApp, nicht das Lesen auf einem Endgerät.
- Bei unklarer Gruppenanlage zuerst in WhatsApp nachsehen und **Gruppe wiederfinden** verwenden. TT sucht die reservierte Gruppe; es erstellt keine zweite auf Verdacht. Den Namen bis zur erfolgreichen Zuordnung nicht ändern.
- Hat der Provider die Erstellung eindeutig abgelehnt, nach Prüfung der WhatsApp-Verbindung erneut auf **Übungsgruppe erstellen** klicken.
- Meldet WhatsApp einen unklaren Versand, zuerst den Gruppenchat prüfen. Ein neuer Übungsstart verschickt bewusst eine neue Einladung; er wiederholt nicht automatisch einen möglicherweise bereits angekommenen Auftrag.

## Welche Logik wird geprüft?

Normales Training und Übungen verwenden dieselbe deutsche Spracherkennung und dieselbe Zustandslogik für Zu-/Absage, Verspätung und Reaktionsrücknahme. Die Übung speichert ihre Daten separat; sie erzeugt keine echten Teilnehmerkonten, Mitgliedschaften, Trainingsserien, privaten Erinnerungen oder Trainerstatistiken. Die echte Terminplanung und ihre Uhrzeiten werden weiterhin mit den automatisierten Tests und der [Installationsabnahme](ACCEPTANCE.md) geprüft.

Für eigene Installationen benötigt der Evolution-Account neben dem Nachrichtenversand die Gruppenanlage über `POST /group/create/{instance}`. Es werden keine zusätzlichen Cloudflare-Dienste benötigt.

Für den Einladungslink benötigt TT Gruppenadminrechte und den Evolution-Endpunkt `GET /group/inviteCode/{instance}`. Es wird nur der Link der eigenen Übungsgruppe abgefragt; der Link wird nicht dauerhaft in TT gespeichert und löst keinen automatischen Nachrichtenversand aus.

## Statistiken in der Übung

Auch `Stats`, `/stats` und `Analysen` funktionieren während einer aktiven Übungsrunde. Die Antwort zeigt die aktuellen Übungszusagen, Absagen und Verspätungen. Zusätzlich zeigen ausdrücklich erfundene Beispielpersonen die Ranglisten für einen, sechs und zwölf Monate einschließlich Gleichstand. Mit `/stats 6 Monate` lässt sich ein Zeitraum gezielt ausprobieren. Es werden weder echte Trainingsdaten gelesen noch historische Teilnahmen erfunden oder gespeichert. Trainer dürfen bei den aktuellen Übungsantworten mitmachen; in echten Ranglisten bleiben sie ausgeschlossen. Nach Ende oder Neustart gelten die bisherigen Übungsdaten nicht mehr.
