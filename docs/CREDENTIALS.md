# Optionale Windows-Zugangsdatenverwaltung

Die plattformübergreifende Einrichtung steht in [SELF_HOSTING.md](SELF_HOSTING.md). Dieser Helfer ist optional. Vor `Setup` die eigene `wrangler.production.jsonc` anlegen, D1 migrieren und `$env:TT_ORIGIN = 'https://training.example.org'` auf die tatsächliche öffentliche Adresse setzen. Optional wählt `$env:TT_CONFIG` eine andere Wrangler-Datei.

`Evolution-Zugangsdaten.cmd` startet die verdeckte Eingabe. Alternativ aus dem Repository:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/evolution.ps1 -Action Save
```

URL, Instanzname und API-Key werden gemeinsam per Windows DPAPI verschlüsselt
unter `%LOCALAPPDATA%\TT\evolution.dpapi` gespeichert. Der API-Key wird verdeckt
eingelesen. Die Ablage ist auf den aktuellen Windows-Benutzer und SYSTEM beschränkt;
die Verschlüsselung verwendet keinen im Repository gespeicherten Schlüssel.
Es genügt das normale Windows-Konto; Administratorrechte sind nicht erforderlich.
Programme und Codex unter diesem Konto können den Zugang für die vorgesehenen
Aktionen entschlüsseln. Das schützt nicht vor Schadsoftware in derselben Sitzung.
Siehe [Microsofts DPAPI-Dokumentation für PowerShell](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/convertfrom-securestring).

Ein erneutes `Save` ersetzt nur den lokalen Zugang. Die Cloudflare-Secrets bleiben
bis `Setup` unverändert. Zugangsdaten niemals in Chat, Git oder Kommandozeilenargumente
kopieren. Die Daten sind an Windows-Konto/Rechner gebunden und nicht als portable
Sicherung gedacht.

## Aktionen

```powershell
.\scripts\evolution.ps1 -Action Status
.\scripts\evolution.ps1 -Action Check
.\scripts\evolution.ps1 -Action Setup
.\scripts\evolution.ps1 -Action Demo
```

- `Status` zeigt nur, ob Zugang und Testnummer gespeichert sind.
- `Check` entschlüsselt den Zugang im Prozess und prüft Verbindung und Botidentität.
- `Setup` prüft zuerst die Instanz und einen bestehenden Webhook. Ein fremder
  Webhook wird nicht überschrieben. Es aktualisiert URL/Instanz in der eigenen `wrangler.production.jsonc`,
  veröffentlicht den Worker und verwendet das vorhandene Setup für Secret,
  authentifizierten Webhook und Einmalcode. TT bleibt pausiert. Den ausgegebenen
  Code vom eigenen Haupthandy privat an den Bot senden und mit `JA` bestätigen.
  Für einen bewusst neu begonnenen, noch nicht abgeschlossenen Bootstrap gibt es
  `-ResetBootstrap`; bestehende Owner werden niemals ersetzt.
- `Demo` legt eine eigene Demogruppe mit genau Bot und zuvor angegebener zweiter
  Testnummer an und sendet eine Transport-Testnachricht. Die Testnummer kann
  mit `-TestNumber` gesetzt werden. Der Bot selbst ist nicht diese zweite Nummer.
  Gruppe und Versandstatus werden im geschützten lokalen `demo.json` gespeichert.
  Wiederholungen verwenden dieselbe Gruppe und senden die Testnachricht nicht erneut.

Die Zugänge werden nur für den jeweiligen Unterprozess in Prozess-Umgebungsvariablen
geladen. Vorherige Werte werden auch bei Fehlern wiederhergestellt. Es werden keine
dauerhaften Klartext-Umgebungsvariablen, `.env`-Dateien oder Secret-Argumente angelegt.

## Echte Abnahme

Die Demogruppe wird nicht ohne Trainerdialog als aktive Trainingsgruppe ausgewählt.
Das Skript nennt dafür `/gruppe JID` und `/bestätigen`. Keine andere Gruppe wird
umgestellt. Bei einem unklaren Schreibausgang stoppt das lokale Journal weitere
Versuche; zuerst Gruppe bzw. Nachricht über die echte Instanz prüfen. Ein bloßes
Löschen des Journals könnte doppelte Gruppen oder Nachrichten erzeugen.

Eine erfolgreiche API-Antwort bestätigt keine vollständige Zustellung oder Reaktion.
Für die vollständige Abnahme muss der Nutzer auf dem zweiten echten WhatsApp-Konto
Owner-, Registrierungs- und Login-Dialoge bestätigen sowie tatsächlich reagieren.
Diese Identitätsnachweise werden nicht durch gefälschte Webhooks oder direkten
Datenbankzugriff ersetzt. Die ausführliche Checkliste steht in [ACCEPTANCE.md](ACCEPTANCE.md).

## Regressionstests ohne echte Nachrichten

```powershell
node --test scripts/tests/evolution-live.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/credentials.test.ps1
```

Der Windows-Test verwendet ausschließlich kurzlebige synthetische Zugangsdaten in
einem separaten temporären Verzeichnis. Er überprüft Verschlüsselung, ACL, Ersetzen,
Entschlüsseln und Wiederherstellen der Prozessumgebung. Die JavaScript-Tests prüfen
Fehlerbereinigung, Gruppengrenzen und das Verhalten bei unklaren Schreibausgängen.
