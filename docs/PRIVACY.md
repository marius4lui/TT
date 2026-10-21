# Daten und Datenschutz für Betreiber

Dieses Dokument beschreibt die technische Verarbeitung. Betreiber ergänzen ihre verantwortliche Stelle, Rechtsgrundlage, Kontaktwege und die zutreffenden Dienstleister in den öffentlichen Datenschutzhinweisen. Die App liefert keine fertige rechtliche Freigabe.

## Datenfluss

WhatsApp/Evolution liefert Nachrichtenereignisse an den Worker. TT normalisiert Identität, Gruppenbezug, Reaktion bzw. unterstützten Text und speichert verarbeitbare Ereignisse vorübergehend in D1. Regeln erzeugen Rückmeldungen, Termine und Versandaufträge. Es gibt keinen KI-Dienst und kein Modelltraining durch TT.

Die Installation speichert unter anderem WhatsApp-Kennungen und explizite Identitätsverknüpfungen, Anzeigenamen, Gruppenmitgliedschaften, Rollen, Termine, Teilnahme, Zustimmungen, Sessions und technische Auftragszustände. Auch Teilnahme ohne Webkonto benötigt eine Zuordnung zur WhatsApp-Identität. „Kein Konto erforderlich“ bedeutet nicht „keine personenbezogenen Daten“.

Cloudflare und der eigene Evolution-Betreiber verarbeiten zusätzliche Betriebsdaten. WhatsApp bleibt ein externer Dienst. Eine D1-Jurisdiktion `eu` ist keine Zusage, dass sämtliche Verarbeitung einschließlich Workers, WhatsApp und Evolution ausschließlich in der EU stattfindet.

## Aktuelle technische Aufbewahrung

Die tägliche Bereinigung wird durch den Cron ausgeführt. Bei ausgefallenem Cron können Daten länger liegen bleiben.

| Daten                                                                                             | Verhalten im Code                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Abgelaufene Dialoge, Login-Challenges, Magic-Links, Sessions, Rollenübertragungen und Rate-Limits | Nach Ablauf bei Bereinigung gelöscht                                                              |
| Inbox-Nutzdaten                                                                                   | Nach Verarbeitung bereinigt; spätestens nach einem Tag geleert, offene alte Ereignisse abgelaufen |
| Inbox-Einträge und Verarbeitungsbelege                                                            | Nach 30 Tagen gelöscht                                                                            |
| Gesendete private Antworttexte                                                                    | Nach erfolgreichem Versand geleert                                                                |
| Abgeschlossene Outbox-Texte                                                                       | Nach sieben Tagen geleert; abgelaufene wartende Texte ebenfalls geleert                           |
| Outbox-Einträge                                                                                   | Nach 30 Tagen gelöscht, außer dauerhaften Deduplizierungsbelegen für Gruppenbegrüßungen           |
| Rückmeldungen und Trainerkorrekturen                                                              | Nach 400 Tagen seit Trainingsende gelöscht                                                        |
| Nachrichtenreferenzen                                                                             | Nach 90 Tagen gelöscht                                                                            |
| Audit-Log                                                                                         | Nach 180 Tagen gelöscht                                                                           |
| Benutzer, Gruppen, Serien, Trainings und Zustimmungen                                             | Keine allgemeine zeitgesteuerte Löschung; Kontolöschung und gezielte Betreiberverwaltung beachten |

Maßgeblich sind `inbox.ts`, `outbox.ts` und die Kontolöschlogik. Backups und Providerlogs besitzen eigene Aufbewahrungsfristen; das Löschen in TT löscht nicht automatisch Nachrichten auf WhatsApp-Geräten oder externe Sicherungen.

## Konten und Zugang

Registrierung und persönliche Mitgliedererinnerungen benötigen getrennte ausdrückliche Zustimmung. Trainerübersichten sind ebenfalls freiwillig. `/konto` bietet Datenabruf, Einstellungen und Kontolöschung. Der letzte Owner kann nicht ohne Nachfolge entfernt werden.

Persönliche Login-Links sind Zugangsnachweise. Wer einen gültigen Link besitzt und bestätigt, kann sich als die angezeigte Identität anmelden. Links deshalb nicht weiterleiten oder in Issues, Screenshots und Logs veröffentlichen. Eine neue Anforderung widerruft den alten offenen Link. Sessions und Token werden serverseitig durch Hashes geprüft; zustellbare Links befinden sich vorübergehend im privaten Versandauftrag.

## Übungsgruppen

Übungsrückmeldungen liegen getrennt in `practice_attendance`: WhatsApp-Absenderkennung, Anzeigename, Antwort und Ereigniszeitpunkte. Sie werden bei Neustart, Verschiebung, Absage und Ende entfernt; abgelaufene Runden werden im erfolgreichen Minutenlauf bereinigt. Bekannte eigene Kennungen sind im Kontoexport enthalten und werden bei Kontolöschung aus Übungsantworten entfernt. Die Gruppenzuordnung bleibt reserviert, damit spätere Nachrichten nicht versehentlich als echtes Training verarbeitet werden. Gesendete Übungsantworttexte werden sofort aus der Outbox geleert, andere abgeschlossene Übungstexte im Minutenlauf. WhatsApp und Evolution haben eigene Speicherfristen.

Ein Login-Link gilt fünf Minuten ab Ausstellung. Eine gültige bestehende Sitzung wird beim erneuten Öffnen bevorzugt. Nach Nutzung, Widerruf oder Ablauf plant TT die Bearbeitung der ursprünglichen privaten Nachricht; der Versuch erfolgt innerhalb von 14 Minuten ab Ausstellung. Providerfehler oder ein ausgefallener Cron können die Bearbeitung verhindern. Die serverseitige Gültigkeit endet davon unabhängig. Schon die ursprüngliche Nachricht enthält zusätzlich den dauerhaften Zugang ohne Token.

## Statistiken und Trainerkorrekturen

Ranglisten verwenden Zusagen für abgeschlossene Trainings, ergänzt um freiwillige Trainerkorrekturen. Die automatische Wertung ist kein bestätigter Anwesenheitsnachweis. Korrekturen speichern Termin, betroffene Person, Zustand, Änderungszeit und die bestätigende Traineridentität. Beide persönlichen Datenexporte enthalten die eigenen Korrekturen. Beim Löschen der betroffenen Person werden sie entfernt; beim Löschen des Trainers wird dessen Referenz geleert, während fremde Korrekturen erhalten bleiben.

Auswertungen berücksichtigen aktuelle aktive Gruppenmitgliedschaften und schließen aktuelle Owner, Admins und den Bot aus. Es gibt keine historischen Mitgliedschafts- oder Rollenverläufe und keine darauf gestützten Teilnahmequoten. Mitgliederranglisten bleiben auf berechtigte Gruppen beschränkt. Rückmeldungen und Korrekturen bleiben 400 Tage nach Trainingsende gespeichert, um rollierende Jahresauswertungen zu ermöglichen. Betreiber berücksichtigen diesen Zweck und die verlängerte Frist in ihren Datenschutzhinweisen. Vorher nach 90 Tagen gelöschte Rückmeldungen können nicht rekonstruiert werden; unvollständige Zeiträume werden gekennzeichnet.

## Geteilte Ranglisten

Ranglistentabellen sind über einen zufälligen 128-Bit-Link ohne Anmeldung erreichbar. Der Besitz des Links erlaubt Zugriff, auch nach Weiterleitung; dies ist keine personenbezogene Zugangsprüfung des Besuchers. In D1 wird nur der Tokenhash zusammen mit Gruppe, anfragender Person, Zeitraum und Ablauf gespeichert. Live-Links enden nach sieben Tagen oder früher bei entzogener Gruppenzugehörigkeit, Gruppendeaktivierung oder Kontolöschung der anfragenden Person. Demo-Links enden spätestens mit der Übungsrunde. Abgelaufene Linkdatensätze werden täglich entfernt. Tabellen tragen `noindex`, `no-store` und `no-referrer` und sind nicht in einer öffentlichen Übersicht verlinkt. Externe Proxy-/Providerlogs können den aufgerufenen URL-Pfad weiterhin erfassen; Betreiber müssen deren Zugriff und Aufbewahrung entsprechend begrenzen.

Für die Tabellen speichert TT getrennt pro Gruppe den ersten Namensteil aus dort empfangenen Anzeigenamen samt Änderungszeit, ohne verlässliche Prüfung, ob dies ein tatsächlicher Vorname ist. Telefonnummern und unbrauchbare Angaben werden durch „Mitglied“ ersetzt. Es gibt keine Rückbefüllung aus globalen Privatnamen. Diese Gruppennamen bleiben wie Mitgliedschaften bis zur Konto-/Gruppenlöschung oder gezielter Betreiberbereinigung erhalten und sind in beiden persönlichen Exporten enthalten. Neue Gruppennachrichten aktualisieren sie; private Nachrichten ändern sie nicht.
