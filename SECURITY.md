# Sicherheitsmeldungen

Bitte Sicherheitslücken nicht mit ausnutzbaren Details in einem öffentlichen Issue melden. Verwende nach Aktivierung die private GitHub-Meldung unter **Security → Report a vulnerability** des Repositorys. Falls diese Funktion noch nicht verfügbar ist, bitte den Maintainer in einem Issue ausschließlich um einen privaten Kontaktweg, ohne Schwachstellendetails oder Nutzerdaten anzuhängen.

Hilfreich sind betroffene Version bzw. Commit, Voraussetzungen, erwartetes und beobachtetes Verhalten sowie eine Reproduktion mit synthetischen Daten. Keine API-Keys, Einmal-Login-Links, Sessioncookies, echten Telefonnummern oder Nachrichtenverläufe übermitteln.

Aktuell wird der jeweils aktuelle Entwicklungsstand gepflegt; es gibt noch keine zugesicherte LTS-Version oder Reaktionsfrist. Private Vulnerability Reporting muss vor der öffentlichen Freigabe in den Repository-Einstellungen aktiviert werden.

## Für Betreiber

- Eigene Secrets ausschließlich im vorgesehenen Secret Store ablegen; Beispielwerte ersetzen.
- HTTP- und Providerlogs auf personenbezogene Daten prüfen; Zugangsnachweise nicht protokollieren.
- Unklare Versandaufträge nicht blind wiederholen.
- Updates zunächst mit isolierter Datenbank und Mock-Transport prüfen.
- Bei offengelegten Zugangsdaten diese widerrufen bzw. rotieren. Entfernen aus dem aktuellen Git-Stand widerruft sie nicht.
