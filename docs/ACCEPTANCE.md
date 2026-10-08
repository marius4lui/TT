# Abnahme vor Freigabe

Stand: 8. Oktober 2026. Für diese Repository-Kopie sind keine produktiven Dienste oder eine echte WhatsApp-Testgruppe bestätigt. Alle Punkte unten sind offen, bis ein Ergebnis und ein knappes, datensparsames Protokoll vorliegen. `pnpm check` und Worker-Builds ersetzen keine reale WhatsApp-Abnahme.

Für jeden Test nur Datum, Testumgebung, App-/Betriebssystemversion, Ergebnis und technische Referenz festhalten. Keine vollständigen Telefonnummern, Login-Codes, API-Schlüssel, Chatverläufe oder unnötigen personenbezogenen Daten in das Protokoll aufnehmen.

## Vorbedingungen

- [ ] Verantwortliche Stelle, Rechtsgrundlage, Empfänger, Dienstleister und Löschfristen festgelegt; vollständige Datenschutzhinweise auf `/datenschutz` veröffentlicht.
- [ ] Gruppe vor Aktivierung über den Bot und die Verarbeitung informiert; alternative Rückmeldung beim Trainer ist bekannt.
- [ ] Getrennte Testgruppe und möglichst getrennte Evolution-Testinstanz ausgewählt; produktiver Webhook wird durch Tests nicht überschrieben.
- [ ] `EVOLUTION_URL`, `EVOLUTION_INSTANCE` und API-Key gegen die wirkliche Instanz geprüft; keine Zugangsdaten in Git oder Logs.
- [ ] D1-Migrationen auf dem vorgesehenen Ziel angewendet; Worker-, Asset-, Cron- und Domain-Bindings geprüft.
- [ ] `node scripts/setup.mjs --help` geprüft; Einrichtungscode, Owner-Freigabe und Webhook-Authentifizierung in der vorgesehenen Umgebung verifiziert.

## Automatisierte Projektprüfungen

- [ ] `pnpm install --frozen-lockfile` läuft mit Node.js 24 und pnpm 11.9.0.
- [ ] `pnpm check` ist in CI erfolgreich: TypeScript-Prüfung, Vitest und Wrangler-Dry-Run.
- [ ] `pnpm smoke` startet den lokalen Wrangler-Worker mit Mock-Evolution und führt den Ende-zu-Ende-Smokeablauf ohne echte WhatsApp-Nachrichten aus.
- [ ] Migrationen laufen lokal gegen eine frische D1-Datenbank; Remote-Migration separat auf das richtige Ziel geprüft.
- [ ] Unbekannte `/api/v1/*`-Routen liefern JSON-404 und niemals versehentlich HTML.
- [ ] Öffentliche Seiten enthalten keine vertraulichen Daten; Login- und personenbezogene Antworten tragen `Cache-Control: no-store`.

## Evolution und WhatsApp

- [ ] Verbindung, echte API-Version, Instanzname und Authentifizierung der Evolution-Instanz dokumentiert.
- [ ] In Testgruppe und Privatdialog je eine Nachricht senden und empfangen; Bot ist Mitglied und hat benötigte Schreibrechte.
- [ ] Webhook akzeptiert nur authentifizierte Ereignisse der eingerichteten Instanz; falscher Token, falsche Instanz, doppelte Ereignisse und Historienimport erzeugen keine Aktion.
- [ ] Webhook-Payloads enthalten potenziell API-Schlüssel: Schlüssel werden vor Logs und Speicherung zuverlässig entfernt.
- [ ] Kein Bot-Endlosdialog durch eigene ausgehende Nachrichten oder wiederholte Events.
- [ ] Evolution-Ausfall, HTTP 429, eindeutiger Fehler und Timeout nach möglicher Annahme unterscheiden sich korrekt; `uncertain` wird nicht blind wiederholt.

## Anmeldung und Identität

- [ ] Ersteinrichtung mit korrektem, falschem und abgelaufenem Code sowie zwei gleichzeitigen Erstversuchen; höchstens ein Owner wird angelegt.
- [ ] `/einrichten CODE` mit korrektem, falschem und abgelaufenem Code geprüft; `JA` ernennt nur den reservierten ersten Owner, `NEIN` schließt den Versuch und zwei gleichzeitige Versuche erzeugen höchstens einen Owner.
- [ ] Ausstehende Terminänderungen lassen sich mit `/bestätigen` übernehmen und `/abbrechen` verwerfen; ohne passende Änderung verändern beide Befehle keine Daten.
- [ ] Login-Challenge läuft ab, kann nicht wiederverwendet werden und bleibt an den ursprünglichen Browser gebunden.
- [ ] Weitergeleiteter Code, fehlende WhatsApp-Bestätigung und fremder Browser können keine Session erstellen. Bei einem noch nicht registrierten Konto muss nach der Challenge-Bestätigung zusätzlich die separate freiwillige Registrierung bestätigt werden.
- [ ] GET-Aufrufe lösen weder Anmeldung noch Challenge-Verbrauch aus; Cookies sind Secure, HttpOnly und SameSite.
- [ ] `/api/v1/me` erfordert eine gültige Serversession; Logout widerruft sie und setzt das Cookie zurück.
- [ ] Identitätsvarianten mit Gruppen-JID, Telefonnummern-JID und LID führen nicht zu falschen Kontozusammenführungen.

## Training und Rückmeldungen

- [ ] Serien, Ausfall, Pause, Verschiebung, Sondertermin, Sommer-/Winterzeit und Änderung kurz vor Versand geprüft.
- [ ] Ausnahme hat Vorrang vor Serie; abgesagte oder geänderte Termine erzeugen keine veralteten Erinnerungen.
- [ ] `👍` und `👎`, Wechsel, Entfernen, Hautfarbvarianten und `⏰` auf Android und iOS geprüft; echte Reaktion der Person und Nachricht werden korrekt zugeordnet.
- [ ] Gruppen- und Privatantworten nacheinander geprüft; Entfernen einer alten Reaktion überschreibt keine neuere Entscheidung.
- [ ] Nachrichten mit Tippfehler, Negation, Kondition, möglicher Verspätung, Drittperson und irrelevanter Aussage geprüft; mehrdeutige Fälle fragen nach und tragen nichts falsch ein.
- [ ] `/übersicht` zeigt nur berechtigten Trainern Teilnahmedaten.
- [ ] Einwilligung für persönliche Erinnerungen ist standardmäßig aus; Opt-in wird nachweisbar gespeichert und `/stop` beendet auch schon geplante persönliche Sendungen.
- [ ] Teilnahme ohne TT-Konto, Konto ohne Erinnerungszustimmung und Widerruf getrennt geprüft.

## Öffentliche Website und Betrieb

- [ ] `/info` und `/datenschutz` zeigen die freigegebenen Trainertexte; Sonderzeichen und HTML aus Datenbankwerten werden als Text behandelt.
- [ ] `/login` startet nur nach aktivem POST; Challenge-Status bleibt an Browserbindung gebunden und endet nach Bestätigung/Logout erwartungsgemäß.
- [ ] `/konto` zeigt nur das eigene angemeldete Konto; nach Logout ist der Inhalt nicht aus Cache abrufbar.
- [ ] Mobile Darstellung und Tastaturbedienung auf kleinen und großen Bildschirmen geprüft; dieses Ergebnis ist noch nicht durch einen Browser-Visualtest bestätigt.
- [ ] Worker-Cron und D1 sind erreichbar; Alter wartender Jobs, unklare Sendefälle und Auth-Fehler können ohne Offenlegung von Identitäten geprüft werden.
- [ ] Rückweg bei WhatsApp-Ausfall, D1-Restore und Worker-Rollback geprobt; Datenbankänderungen werden nicht als automatisch rückgängig dargestellt.

## Freigabeentscheidung

Freigabe erst nach Klärung aller Vorbedingungen und erfolgreicher kritischer Fälle in einer echten, ausdrücklich ausgewählten Testgruppe. Ein nicht unterstützter Reaktions- oder Identitätsfall wird als Einschränkung dokumentiert; er darf nicht als erfolgreich abgenommen gelten. Die Freigabe muss von der verantwortlichen Stelle und dem Betreiber festgehalten werden.
