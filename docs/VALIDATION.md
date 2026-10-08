# Implementierungsnachweis

Geprüft am 8. Oktober 2026 unter Windows mit Node.js 24, pnpm 11.9.0,
Vitest 5.0.3 und Wrangler 4.149.0. Es wurden keine echten WhatsApp-Nachrichten
versandt und keine Cloudflare-Produktionsressourcen angelegt oder verändert.

## Erfolgreich lokal geprüft

- `pnpm check`: TypeScript, 158 Tests in zehn Dateien und Worker-Dry-Run.
- `pnpm smoke`: echter lokaler workerd mit isolierter D1 und HTTP-Simulation
  der Evolution-API; Einrichtung, Owner-Bestätigung, Gruppenauswahl,
  Datenschutzhinweise, Aktivierung, Sondertraining, Cron-Einladung,
  Hautfarben-Reaktion, WhatsApp-Code, Registrierung, getrennte Zustimmung
  für persönliche Erinnerungen und anschließende Websession.
- Negativfälle: falscher Webhook-Token, fremde Browserbindung,
  wiederholter Loginabschluss, Rollenentzug, konkurrierende Terminänderung,
  Transaktionsabbruch und Wiederholung nach erfolgreichem Commit.
- `pnpm db:migrate:local`: alle vier Migrationen auf frischer lokaler D1.
- `node scripts/setup.mjs --local`: Einmalcode erzeugt; erneuter Aufruf
  ohne ausdrückliches Zurücksetzen korrekt abgelehnt. Der Code wird hier
  nicht gespeichert.
- `pnpm audit`: keine bekannten Sicherheitslücken zum Prüfzeitpunkt.
- `pnpm format:check`: einheitliche Formatierung.

Der Laufzeittest fand einen Fehler beim Aufruf des nativen Worker-`fetch`.
Die Bindung wurde korrigiert und durch einen Regressionstest abgesichert.
Teilnahmeänderungen und Bestätigungsaufträge sowie bestätigte Traineränderungen
und Änderungsnachrichten werden jeweils atomar in D1 gespeichert.

## Bewusst noch nicht bestätigt

Eine neue Telefonnummer und Evolution-Instanz stehen noch nicht zur Verfügung.
Echte Provider-Payloads, Reaktionen und Kontaktkarten auf Android/iOS,
WhatsApp-Zustellung und der produktive Betrieb von `tt.bz3.eu` sind daher offen.
Es fand kein Browser-Visualtest statt. Cookie- und Loginprotokolle wurden über
HTTP getestet; das ersetzt die spätere Geräteabnahme nicht.

Die Regeln zur Erkennung von Verspätungen decken die getesteten deutschen
Formulierungen ab. Sie garantieren kein Verständnis beliebiger natürlicher
Sprache; mehrdeutige Aussagen erfordern eine Bestätigung.

Das Speichern der Bot-Kontaktkarte kann WhatsApp technisch nicht verlässlich
bestätigen und gewährt keinen zusätzlichen Identitätsnachweis. Auch Historien-
und Live-Ereignisse müssen beim wirklichen Provider geprüft werden, weil
Evolution-Versionen diese Metadaten unterschiedlich weiterreichen können.

GitHub CI ist eingerichtet, konnte aber beim [ersten Lauf](https://github.com/marius4lui/TT/actions/runs/37825385582)
keinen Job starten: GitHub meldet fehlgeschlagene Kontozahlungen oder ein
erreichtes Ausgabenlimit. Deshalb ist die frische Linux-Ausführung in GitHub
noch nicht bestätigt. Nach Klärung der Kontosperre den Workflow erneut ausführen.
Die lokal erfolgreichen Tests sind davon getrennt zu bewerten. Die Checkliste
in [ACCEPTANCE.md](ACCEPTANCE.md) bleibt die Grundlage für die spätere Freigabe;
das konkrete Vorgehen steht in [OPERATIONS.md](OPERATIONS.md).
