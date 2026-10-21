# Implementierungsplan: Statistiken und Analysen

## Ziel und verbindliche Semantik

Mitglieder und Trainer fragen in WhatsApp nach Statistiken und Analysen; Trainer können im Web einzelne vergangene Trainings korrigieren. Die normale Nutzung verlangt keine Anwesenheitskontrolle. Gezählt wird ausdrücklich **nach Zusagen, mit Trainerkorrekturen**. Eine Zusage ist kein Anwesenheitsnachweis. Es gibt keine automatische Preisvergabe.

Ein Punkt entsteht pro Person und abgeschlossenem, nicht abgesagtem Training: entweder eine gültige Zusage (`yes`, ohne ausstehende Neubestätigung), oder eine optionale Trainerkorrektur „Anwesend“. „Abwesend“ überschreibt eine Zusage mit null Punkten. „Automatisch“ setzt die Auswertung auf die Zusage zurück. Eine nicht beantwortete Einladung zählt nicht; Verspätung erzeugt keinen zusätzlichen Punkt. Korrekturen bleiben getrennt von der ursprünglichen Rückmeldung.

Die drei Zeiträume umfassen rollierend einen, sechs oder zwölf Kalendermonate bis zum Abfragezeitpunkt. Der Beginn wird mit Kalenderarithmetik in der konfigurierten Zeitzone bestimmt; exakte Grenzen werden angezeigt. Es sind keine abgeschlossenen Kalenderjahre oder Kalendermonate. Termine werden nach Beginn eingeordnet und erst nach ihrem Ende gewertet. Abgesagte, laufende, zukünftige und Übungstermine zählen nicht.

Je Gruppe zählen aktuelle aktive Mitglieder. Aktuelle Owner und Admins sowie die Botidentität einschließlich ihrer Aliasse werden ausgeschlossen. Abfragen bleiben auf eine zulässige eigene Gruppe beschränkt. Gleiche Punktzahlen erhalten denselben Rang, Namen und stabile IDs ordnen lediglich die Darstellung. Es gibt keinen Sieger mit null Punkten und keine automatische Auszeichnung. Historische Mitgliedschafts- oder Trainerquoten werden nicht berechnet, da entsprechende Zeitverläufe fehlen.

## Daten und Migration

1. Neue Tabelle `session_presence` mit zusammengesetztem Primärschlüssel `(session_id,user_id)`, Zustand `automatic|present|absent`, Änderungszeit und optionalem `confirmed_by`. Session und betroffene Person werden mit Löschweitergabe referenziert; beim Löschen des bestätigenden Trainers wird nur dessen Referenz geleert.
2. Migration setzt `statistics_history_from` einmalig auf Migrationszeit minus 90 Tage. Die bisherige Bereinigung kann ältere Rückmeldungen bereits gelöscht haben. Keine Rekonstruktion aus Nachrichten und keine erfundene Anwesenheit.
3. Rückmeldungen und Korrekturen werden 400 Tage nach Trainingsende gelöscht. Nachrichtenreferenzen bleiben bei 90 Tagen. Effektive Datenabdeckung berücksichtigt den Startmarker und die aktuelle Aufbewahrungsgrenze. Ein Zeitraum vor der verfügbaren Historie erhält einen deutlichen Warnhinweis; vorhandene Teildaten sind kein vollständiges Jahresergebnis.
4. Beide persönlichen Datenexporte enthalten Korrekturen. Kontolöschung entfernt die eigenen Korrekturen; Trainerlöschung darf fremde Korrekturen nicht entfernen. Dokumentation und öffentliche Datenschutzhinweise müssen die verlängerte Aufbewahrung beschreiben.

## Gemeinsamer Auswertungsdienst

Eine gemeinsame Implementierung berechnet Zeitraum, zugelassene Gruppen, berechtigte Personen, Punktzahlen, Gleichstände und Abdeckungsinformationen. SQL filtert Gruppen und Identitäten vor Aggregation; eine Person erscheint pro Training höchstens einmal. Keine N+1-Abfrage je Teilnehmer und keine willkürliche Begrenzung der für die Berechnung geladenen Trainings. Bot und Versand verwenden dieselbe Semantik und dieselben Kennzahlen. Namen werden für den Ausgabekanal sicher dargestellt, Kennungen und Telefonnummern werden nicht als Ranglistennamen veröffentlicht.

## WhatsApp

Ein eigener begrenzter Parser erkennt `/stats`, `Stats`, `Analysen` und unterstützte Zeitraumangaben, bevor Text als Teilnahmeantwort verarbeitet wird. Er verändert keine Rückmeldung und akzeptiert keine beliebigen Erwähnungen oder Zitate. Ein Standardzeitraum wird ausdrücklich benannt. Mehrdeutige private Gruppenanfragen führen zu einer Gruppenwahl bzw. einem Hinweis auf die konkrete Trainingsgruppe. Die Antwort enthält Zeitraum, Zählweise, Rangliste, Trainerausschluss und bei Bedarf die Historienwarnung. Ein eigener Outbox-Auftrag speichert nur Gruppe, Zeitraum und anfragende Person. Beim Versand werden aktive Mitgliedschaft, Gruppe und Datenschutzfreigabe erneut geprüft und die Statistik frisch berechnet; nach erfolgreichem Versand wird der Auftragstext geleert.

## Trainer-Web und Korrekturen

Unter „Mehr → Vergangene Trainings“ stehen optionale kurze Korrekturen zur Verfügung. Ranglisten werden in WhatsApp mit Leerzuständen und Historienwarnung angezeigt. Die Standardeinstellung bleibt automatisch; Trainer müssen keine Liste routinemäßig bestätigen. Änderungen prüfen Sitzung, aktuelle Trainerrolle, Origin, Terminstatus und optimistische Versions-/Zeitbedingungen. Speicherung und Audit erfolgen atomar. Veraltete Eingaben überschreiben keine neuere Korrektur. Keine Korrektur darf die WhatsApp-Zusage umschreiben.

## Prüfung und Auslieferung

- Kalendergrenzen, Monatsenden, Schaltjahre und Sommerzeit; laufende, künftige, abgesagte und verschobene Termine.
- Gültige, zurückgenommene und erneut zu bestätigende Zusagen; jede Korrekturstufe; keine Doppelzählung.
- Gleichstände, Nullwerte, Botaliase, Trainerrollen, mehrere Gruppen und aktuelle Mitgliedschaften.
- Erkennung unterstützter Fragen und Ablehnung fremder, zitierter oder mehrdeutiger Aussagen ohne Schreibzugriff.
- API-Berechtigungen, Origin, Konflikte, Löschung, beide Datenexporte, 400-Tage-Grenze und unvollständige Historie.
- Anschließend Typprüfung, Gesamttests, Worker-Build und lokaler Smoke mit Mock-Transport; reale WhatsApp-Zustellung separat bewerten.

Migration vor der neuen Worker-Version anwenden. Bestehende gelöschte Daten bleiben verloren. Die Anzeige ist eine operative Rangliste der heute aktiven Mitglieder und Rollen, kein unveränderliches historisches Turnierergebnis.

## Ergänzung: kompakte Antwort und geteilte Tabelle

Standard sind sechs Monate und höchstens drei Zeilen im Chat. Die vollständige Tabelle ist nur mit einem zufälligen 128-Bit-Link erreichbar, ohne Anmeldung; Weitergabe des Links gibt Zugriff weiter. Nur der Hash wird gespeichert. Live-Links gelten sieben Tage und prüfen weiter Gruppe, Datenschutzfreigabe und Mitgliedschaft der anfragenden Person. Demo-Links prüfen Runde, Version, Ablauf und Trainerrolle. Tabellen werden frisch berechnet, bleiben aus Suchmaschinen und Caches ausgeschlossen und zeigen keine Kennungen oder globalen vollständigen Namen. Gesondert erfasste erste Namensteile aus der jeweiligen Gruppe ersetzen globale Anzeigenamen; ohne geeignete Angabe erscheint „Mitglied“. Migration 0011 ergänzt die Link- und Gruppennamentabellen. Export, Löschweitergabe und tägliche Linkbereinigung sind enthalten.
