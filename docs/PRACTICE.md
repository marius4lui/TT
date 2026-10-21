# TT ausprobieren

Im Trainerbereich **Mehr → Übungsgruppe** öffnen. Jede Trainerperson kann eine eigene WhatsApp-Gruppe anlegen. Ein Klick auf **Meine Übungsgruppe erstellen** erstellt sie mit dem Bot und der Trainerperson. Weitere Testpersonen lassen sich in WhatsApp hinzufügen; vorher über die Übung und die Verarbeitung ihrer Antworten informieren.

Die Übungsgruppe funktioniert auch bei pausierten normalen Trainingsnachrichten. Sie wird nicht als Trainingsgruppe angeboten und lässt sich nicht für echte Termine aktivieren.

## Ein einfacher Durchlauf

1. **Neue Übung starten** anklicken und die neue Einladung in WhatsApp öffnen.
2. `Kann nicht` schreiben, danach `Kann doch`. TT bestätigt erst die Absage, dann die Zusage.
3. `Ich komme fünf Minuten später` schreiben. Unter **Aktualisieren** erscheint die Verspätung. `Ich komme doch pünktlich` entfernt sie wieder.
4. **Verspätung abfragen** sendet die entsprechende Übungsnachricht. Auf diese Nachricht mit ⏰ reagieren und die Reaktion anschließend zurücknehmen. Die Zusage bleibt erhalten, die Verspätung verschwindet.
5. **Termin verschieben** sendet eine neue Einladung und beginnt eine neue Runde Rückmeldungen. Antworten auf die alte Einladung ändern diese Runde nicht.
6. **Termin absagen** oder **Übung beenden** schließt die Runde. **Neue Übung starten** beginnt wieder mit einer leeren Liste.

Die Schaltflächen spielen Situationen sofort durch; es muss kein echter Termin abgewartet werden. Eine Runde endet nach spätestens einer Stunde. Die WhatsApp-Gruppe bleibt für weitere Übungen bestehen. Rückmeldungen werden bei Neustart, Verschiebung und Ende entfernt, bei Zeitablauf im nächsten erfolgreichen Minutenlauf. WhatsApp-Nachrichten auf Geräten bleiben bestehen.

**Wie versteht TT diesen Satz?** ist eine reine Textprobe. Den Zusammenhang auswählen, einen Satz eingeben und **Satz ausprobieren** anklicken. Dabei wird weder eine WhatsApp-Nachricht versendet noch eine Rückmeldung gespeichert. Die Probe erklärt das Sprachmuster; beim echten Training prüft TT zusätzlich Termin, Mitgliedschaft und Aktualität. Die Übungsgruppe hat einen einzigen fiktiven Termin und fragt bei konkreten Tages- oder Terminverweisen nach.

## Wenn etwas nicht erscheint

- **Aktualisieren** zeigt den Versandstand und die zuletzt eingegangenen Antworten. Ein erfolgreicher Provider-Aufruf bestätigt die Übergabe an WhatsApp, nicht das Lesen auf einem Endgerät.
- Bei unklarer Gruppenanlage zuerst in WhatsApp nachsehen und **Gruppe wiederfinden** verwenden. TT sucht die reservierte Gruppe; es erstellt keine zweite auf Verdacht. Den Namen bis zur erfolgreichen Zuordnung nicht ändern.
- Hat der Provider die Erstellung eindeutig abgelehnt, nach Prüfung der WhatsApp-Verbindung erneut auf **Meine Übungsgruppe erstellen** klicken.
- Meldet WhatsApp einen unklaren Versand, zuerst den Gruppenchat prüfen. Ein neuer Übungsstart verschickt bewusst eine neue Einladung; er wiederholt nicht automatisch einen möglicherweise bereits angekommenen Auftrag.

## Welche Logik wird geprüft?

Normales Training und Übungen verwenden dieselbe deutsche Spracherkennung und dieselbe Zustandslogik für Zu-/Absage, Verspätung und Reaktionsrücknahme. Die Übung speichert ihre Daten separat; sie erzeugt keine echten Teilnehmerkonten, Mitgliedschaften, Trainingsserien, privaten Erinnerungen oder Trainerstatistiken. Die echte Terminplanung und ihre Uhrzeiten werden weiterhin mit den automatisierten Tests und der [Installationsabnahme](ACCEPTANCE.md) geprüft.

Für eigene Installationen benötigt der Evolution-Account neben dem Nachrichtenversand die Gruppenanlage über `POST /group/create/{instance}`. Es werden keine zusätzlichen Cloudflare-Dienste benötigt.
