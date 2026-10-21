# Statistiken und Analysen

Schreibe `/stats`, `Stats` oder `Analysen` an den Bot. Die Statistik wertet abgeschlossene Trainings aus. Im Trainerbereich können unter „Mehr → Vergangene Trainings“ einzelne Ausnahmen korrigiert werden.

Gezielt auswählen: `/stats Monat`, `/stats 6 Monate` oder `/stats Jahr`. Ohne Zeitraum zeigt TT alle drei Zeiträume, jeweils bis zu zehn Einträge. Gleiche Punktzahlen behalten denselben Rang, auch wenn weitere Personen nicht mehr in den Ausschnitt passen.

## Was zählt?

Die Rangliste zählt **nach Zusagen, mit Trainerkorrekturen**. Eine gültige Zusage ergibt nach Trainingsende einen Punkt. Sie bedeutet nicht, dass die Anwesenheit kontrolliert wurde. Eine nach einer Terminänderung noch nicht bestätigte Zusage zählt nicht. Absagen, laufende und zukünftige Trainings sowie Übungsgruppen zählen ebenfalls nicht.

Trainer müssen im Alltag nichts bestätigen. Wenn eine Zusage ausnahmsweise nicht der tatsächlichen Teilnahme entspricht, können sie beim vergangenen Training „War da“ oder „War nicht da“ eintragen. „War da“ zählt auch ohne ursprüngliche Zusage, „War nicht da“ verhindert einen Punkt trotz Zusage. „Nach Zusage“ verwendet wieder die ursprüngliche Rückmeldung. Jede Person kann pro Training höchstens einen Punkt erhalten.

## Zeiträume und Ranglisten

Die Auswahl umfasst den letzten Monat, die letzten sechs Monate und die letzten zwölf Monate, jeweils **rollierend bis zum Abfragezeitpunkt**. Die Anzeige nennt die konkreten Grenzen und die Zeitzone. „Jahr“ bezeichnet hier zwölf Monate, nicht das vorige Kalenderjahr.

Es zählen die aktuellen aktiven Mitglieder der gewählten Gruppe, ohne aktuelle Trainer (Owner und Admins) und ohne Bot. Gleiche Punktzahlen bedeuten denselben Rang. Rollenwechsel und Austritte können eine spätere Rangliste verändern. Historische Mitgliedschaftsquoten werden deshalb nicht angegeben. Mitglieder können nur Statistiken ihrer eigenen zulässigen Gruppen abrufen; im Zweifel direkt in der betreffenden Trainingsgruppe fragen.

Die Rangliste kann eine Auszeichnung unterstützen. TT vergibt jedoch keine Preise automatisch und behauptet keine kontrollierte Anwesenheit für automatische Punkte.

## Ältere Daten

Vor Einführung der Statistik wurden Rückmeldungen nach 90 Tagen gelöscht. Nun bleiben Rückmeldungen und Trainerkorrekturen 400 Tage nach Trainingsende gespeichert. Bereits gelöschte Daten kommen dadurch nicht zurück. Bei einem Zeitraum, der ältere Daten benötigt, erscheint ein Hinweis auf die unvollständige Historie. Ein solches Ergebnis ist nur eine Auswertung der noch verfügbaren Daten.

Eigene Korrekturen stehen im persönlichen Datenexport und werden bei Kontolöschung entfernt. Weitere Angaben zur Speicherung stehen unter [Datenschutz](PRIVACY.md). Der technische Umsetzungsvertrag steht im [Implementierungsplan](STATS-PLAN.md).
