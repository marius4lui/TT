# Stand der Open-Source-Vorbereitung

Ziel: TT unter AGPL-3.0-only veröffentlichen und auf einem eigenen Cloudflare-Account mit Workers/D1 betreiben können. Ein VPS-/Docker-Port ist nicht Bestandteil dieses Schritts.

## Im Quellcode vorbereitet

- AGPL-Lizenztext, Paketmetadaten und sichtbarer, konfigurierbarer Quellcode-Link.
- Neutrale Konfiguration, getrennte ignorierte Produktionsdatei, eigener Worker/D1/Transport und eigene HTTPS-Origin.
- Neutrale Startwerte für neue Datenbanken und keine produktive Fallback-Domain in der Anwendung.
- Plattformübergreifendes Setup; Windows-Zwischenablage-Helfer verwenden die eigene konfigurierte Botidentität.
- README, Hosting-, Konfigurations-, Architektur-, Betriebs-, Datenschutz- und Beitragsdokumentation.
- Sicherheitsmeldeweg, Issue-/PR-Vorlagen, Abhängigkeitsupdates und Windows-Testjob.
- Sofortiger Hintergrundversand nach Webänderungen mit Regressionstests und lokalem Worker-Smoke.
- Formatierungsfehler in der Browserdatei behoben.

## Vor der öffentlichen Freigabe abschließen

1. **Git-Historie bewusst behandeln.** Der aktuelle Baum enthält keine ursprünglichen produktiven Deployment-Ziele mehr. Frühere Commits enthalten weiterhin Botnummer, Domains, Infrastruktur-IDs und private Betriebsnotizen. Diese Angaben sind nicht automatisch Secrets; sie sollten trotzdem nicht unbeabsichtigt veröffentlicht werden. Gitleaks fand in der bestehenden Historie keine erkannten Secrets. Entweder die Veröffentlichung der verbleibenden historischen Angaben bewusst akzeptieren oder einen neuen öffentlichen Git-Verlauf aus dem bereinigten Stand erstellen. Ein bloßes Löschen aktueller Dateien entfernt alte Inhalte nicht. Die vorhandene `main`-Historie wurde nicht umgeschrieben.
2. **Repository-Zugang freigeben.** GitHub-Sichtbarkeit ändern oder ein öffentliches Repository mit bereinigtem Verlauf anlegen; danach Clone und Quellcode-Link ohne Anmeldung prüfen. Die Vorbereitungen allein ändern keine GitHub-Einstellung.
3. **Private Sicherheitsmeldungen aktivieren.** GitHub Private Vulnerability Reporting einschalten und den in SECURITY.md beschriebenen Weg prüfen. Den aktuell bestätigten GitHub-Actions-Abrechnungsblock beheben und CI des veröffentlichten Stands einschließlich Windows-Job erfolgreich ausführen; Details in VALIDATION.md.
4. **Unabhängige Erstinstallation abnehmen.** Mit einem frischen Cloudflare-Account/D1 und eigener Evolution-Instanz die Hosting-Anleitung durchführen. Verwendete Evolution-Version dokumentieren; eine belastbare unterstützte Versionsmatrix fehlt noch.
5. **Produktionsfix ausrollen.** Nach dem Deploy die Terminänderung aus dem Web ohne zusätzliche Chatnachricht prüfen und `lastCron` beobachten. Die lokale Reproduktion behebt den fehlenden Versand-Anstoß, beweist aber nicht, dass ein bestehender produktiver Cron korrekt läuft.

## Einordnung

Die Anwendung bleibt an Cloudflare und Evolution gebunden, ist aber für ein eigenes Cloudflare-Konto konfigurierbar. Der Quellcode ist lizenzseitig vorbereitet; „öffentlich zugänglich“, „frisch installiert“ und „an echten Geräten abgenommen“ sind separate, noch zu bestätigende Zustände. Prüfdetails stehen in [VALIDATION.md](VALIDATION.md).
