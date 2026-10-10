# Produktion ab 10. Oktober 2026

- Domain und Worker bleiben `tt.bz3.eu` beziehungsweise `tt`.
- Evolution-Instanz: `TTBot`, verbundene Nummer `4915237295324`.
- Aktive D1: `tt-production`, ID `9a7fccd6-3335-4edc-bd00-a7a29e5203b4`; sieben Migrationen angewendet.
- Die bisherige D1 `tt` (`d4a78dfb-5fa4-49d5-a0ec-26a9e6cf26b9`) wurde auf ausdrücklichen Wunsch vollständig gelöscht. Sie ist keine Rückfallsicherung.
- Der TT-Webhook der bisherigen Evolution-Instanz `kmuc` ist deaktiviert. Die neue Instanz besitzt einen neu authentifizierten Webhook. Der Worker lehnt Ereignisse der alten Instanz ab.
- Windows-DPAPI-Zugangsdaten verweisen ebenfalls auf `TTBot`. API-Key und Webhook-Token bleiben geheim.

## Neue Einrichtung

`TT-Admin-einrichten.cmd` starten. Es erzeugt einen kurzlebigen Ersteinrichtungsbefehl und kopiert ihn ohne Ausgabe oder Dateiablage in die Zwischenablage. Privat an **+49 1523 7295324** einfügen, senden und anschließend **JA** bestätigen. Danach `/login` senden; der Trainerbereich bleibt unter derselben Domain. Der Helfer setzt keinen bereits eingerichteten Owner zurück und sendet selbst keine WhatsApp-Nachricht.

Gruppen, Trainingsplan, Datenschutzhinweise und Nachrichtenfreigabe müssen neu eingerichtet werden. Geprüfter Ausgangszustand: keine Benutzer, Rollen, Gruppen, Trainings, Rückmeldungen, Logins oder Versandaufträge; Bootstrap `pending`, Automatik und Datenschutzfreigabe aus.

## Prüfung

749 Tests, sieben Operator-Tests und Worker-Build bestanden. Worker auf die neue D1/Instanz deployed; anschließend Secret und Webhook eingerichtet. Live geprüft: richtige WhatsApp-Identität, Health erfolgreich, authentifiziertes neutrales Webhook-Ereignis 202 mit null Nachrichten, falsche Instanz 403, falscher Token 401, alte D1 nicht mehr vorhanden. Keine echten WhatsApp-Nachrichten gesendet. Erster Owner muss sich selbst über WhatsApp bestätigen.

Das automatische Löschen der lokalen Dateien `%LOCALAPPDATA%\TT\demo.json` und `demo-number.txt` wurde von der Freigabeprüfung blockiert. Sie gehören zur alten lokalen Demo und werden vom produktiven Worker nicht verwendet; das Demo-Werkzeug erkennt außerdem die abweichende Instanzidentität und verwendet das alte Journal nicht für TTBot.
