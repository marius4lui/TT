const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });

const shell = (title: string, content: string, activePath: string): string => `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#f7f7f2">
    <title>${escapeHtml(title)} · TT</title>
    <link rel="stylesheet" href="/style.css">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <script src="/app.js" defer></script>
  </head>
  <body${activePath === '/trainer' ? ' class="workspace-page"' : ['/info', '/datenschutz'].includes(activePath) ? ' class="reading-page"' : ''}>
    <a class="skip-link" href="#inhalt">Zum Inhalt springen</a>
    <header class="site-header">
      <a class="brand" href="/" aria-label="TT Startseite">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span>TT<span class="brand-period">.</span></span>
      </a>
      <nav class="main-nav" aria-label="Hauptnavigation">
        <a href="/info"${activePath === '/info' ? ' aria-current="page"' : ''}>Training</a>
        <a href="/datenschutz"${activePath === '/datenschutz' ? ' aria-current="page"' : ''}>Datenschutz</a>
        <a href="/trainer"${activePath === '/trainer' ? ' aria-current="page"' : ''}>Trainer</a>
        <a class="nav-login" data-auth-nav href="/login"${activePath === '/login' || activePath === '/konto' ? ' aria-current="page"' : ''}>Anmelden <span aria-hidden="true">↗</span></a>
      </nav>
    </header>
    <main id="inhalt">${content}</main>
    <dialog class="move-dialog confirm-dialog" data-confirm-dialog aria-labelledby="confirm-title" aria-describedby="confirm-copy"><form method="dialog" class="form-card"><h2 id="confirm-title" data-confirm-title></h2><p id="confirm-copy" data-confirm-copy></p><label data-confirm-field hidden>Verspätung in Minuten (optional)<input type="number" min="1" max="240" step="1" data-confirm-minutes inputmode="numeric"></label><div class="form-actions"><button type="submit" value="cancel" class="button button-outline" data-confirm-cancel formnovalidate>Abbrechen</button><button type="submit" value="accept" class="button button-dark" data-confirm-accept>Bestätigen</button></div></form></dialog>
    <footer class="site-footer">
      <span>TT <span aria-hidden="true">·</span> Tischtennis gemeinsam planen</span>
      <nav aria-label="Weitere Links"><a href="/info">Training</a><a href="/datenschutz">Datenschutz</a><a href="/trainer">Trainer</a><a href="/source">Quellcode · AGPL-3.0</a></nav>
    </footer>
  </body>
</html>`;

const renderPlainText = (value: unknown): string =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>\n')}</p>`)
    .join('\n');

export interface PageOptions {
  botName: string;
  infoText: string;
  privacyText: string;
  botNumber: string;
  origin: string;
}

export function renderPage(path: string, options: PageOptions): string | null {
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const botName = escapeHtml(options.botName || 'TTBot');
  const infoText = renderPlainText(options.infoText);
  const privacyText = renderPlainText(options.privacyText);
  const phone = String(options.botNumber ?? '').replace(/\D/g, '');
  const botLink = phone ? `https://wa.me/${encodeURIComponent(phone)}` : '';
  const loginLink = phone
    ? `https://wa.me/${encodeURIComponent(phone)}?text=${encodeURIComponent('/login')}`
    : '';

  if (normalizedPath === '/') {
    const contact = `<a class="button button-dark" href="/login">Anmelden <span aria-hidden="true">↗</span></a>`;
    return shell(
      'Tischtennis gemeinsam planen',
      `<section class="home-hero">
      <div class="hero-copy">
        <p class="eyebrow"><span class="eyebrow-dot"></span> Tischtennis. Einfach organisiert.</p>
        <h1>Mehr Spiel.<br><span>Weniger Abstimmung.</span></h1>
        <p class="hero-lead">Trainingsinfos und Rückmeldungen an einem Ort. TT hält eure Runde über WhatsApp auf dem Laufenden. Ein Konto bleibt freiwillig.</p>
        <div class="hero-actions">${contact}<a class="text-link" href="/info">Training ansehen <span aria-hidden="true">→</span></a></div>
        <p class="quiet-note">Ein Konto ist freiwillig. Für die Teilnahme brauchst du keins.</p>
      </div>
      <div class="hero-art" role="img" aria-label="Grafische Tischtennisplatte mit Schlägern und Ball">
        <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
        <div class="table-art"><div class="table-net"></div><div class="table-line"></div></div>
        <div class="paddle paddle-a"><span></span></div><div class="paddle paddle-b"><span></span></div>
        <div class="ping-ball"></div>
        <span class="art-caption">SPIELTAG, GUT GEPLANT.</span>
      </div>
    </section>
    <section class="home-bottom" aria-label="Über TT">
      <div><span class="step-number">01</span><h2>Plan kennen</h2><p>Die nächsten Trainingsinfos findest du auf der Trainingsseite.</p></div>
      <div><span class="step-number">02</span><h2>Rückmelden</h2><p>Reagiere in der Gruppe oder schreib dem Bot direkt.</p></div>
      <div><span class="step-number">03</span><h2>Optional anmelden</h2><p>Ein Konto kann persönliche Erinnerungen ermöglichen. Du entscheidest getrennt darüber.</p></div>
    </section>`,
      '/',
    );
  }

  if (normalizedPath === '/info') {
    return shell(
      'Trainingsinfos',
      `<section class="page-intro"><p class="eyebrow"><span class="eyebrow-dot"></span> Willkommen am Tisch</p><h1>Training, <span>auf einen Blick.</span></h1><p class="hero-lead">Alles Wichtige zur Trainingsrunde und dazu, wie du dich zurückmeldest.</p></section>
      <section class="content-card info-card"><div class="card-kicker">TRAININGSINFORMATIONEN</div>${options.infoText.trim() ? `<div class="rich-copy">${infoText}</div>` : `<p class="empty-copy">Trainingsinformationen werden hier veröffentlicht, sobald sie eingerichtet sind.</p>`}</section>
      <section class="small-callout"><span class="callout-icon" aria-hidden="true">↗</span><div><h2>Frage oder Rückmeldung?</h2><p>Du kannst TT auch direkt über WhatsApp erreichen. Ein Konto und persönliche Erinnerungen sind freiwillig.</p></div>${botLink ? `<a class="text-link" href="${escapeHtml(botLink)}" rel="noopener noreferrer">${botName} öffnen <span aria-hidden="true">→</span></a>` : ''}</section>`,
      '/info',
    );
  }

  if (normalizedPath === '/datenschutz') {
    return shell(
      'Datenschutz',
      `<section class="page-intro"><p class="eyebrow"><span class="eyebrow-dot"></span> Klar und nachvollziehbar</p><h1>Datenschutz<span class="title-period">.</span></h1><p class="hero-lead">Informationen zur Nutzung von TT und zu deinen Rechten.</p></section>
      <section class="content-card privacy-card"><div class="card-kicker">DATENSCHUTZHINWEISE</div>${options.privacyText.trim() ? `<div class="rich-copy">${privacyText}</div>` : `<div class="notice-box"><span class="notice-mark" aria-hidden="true">i</span><p>Die Datenschutzhinweise sind noch nicht veröffentlicht. Bitte nutze TT erst, wenn die verantwortliche Stelle und die Informationen zur Datenverarbeitung hier eingetragen sind.</p></div>`}</section>`,
      '/datenschutz',
    );
  }

  if (normalizedPath === '/login') {
    return shell(
      'Mit WhatsApp anmelden',
      `<section class="auth-layout" data-login>
      <div class="auth-intro"><p class="eyebrow"><span class="eyebrow-dot"></span> Dein Zugang zu TT</p><h1>Ein kurzer Weg.<br><span>Dein WhatsApp.</span></h1><p class="hero-lead">Melde dich mit dem persönlichen Link an, den dir der TT-Bot im privaten WhatsApp-Chat schickt. Dein Trainerzugang führt direkt zur Verwaltung.</p>
        <div class="auth-facts"><div><span class="fact-check" aria-hidden="true">✓</span><span>Kein Passwort nötig</span></div><div><span class="fact-check" aria-hidden="true">✓</span><span>Einmaliger Link</span></div><div><span class="fact-check" aria-hidden="true">✓</span><span>Erinnerungen separat wählbar</span></div></div>
      </div>
      <div class="auth-card">
        <div class="auth-card-top"><span class="whatsapp-glyph" aria-hidden="true">◉</span><span class="card-kicker">ANMELDUNG</span></div>
        <div data-login-state="welcome"><h2>Link im WhatsApp-Chat anfordern</h2><p>Öffne den privaten TT-Chat und sende /login. Dein persönlicher Link führt dich direkt zu deinem Bereich.</p>${loginLink ? `<a class="button button-green button-full" href="${escapeHtml(loginLink)}" target="_blank" rel="noopener noreferrer">WhatsApp-Chat öffnen <span aria-hidden="true">↗</span></a>` : ''}<p class="expiry-note">Öffne einen Link nur, wenn du ihn selbst angefordert hast. Verwende keine weitergeleiteten Links.</p></div>
        <div data-login-state="preview" hidden><h2 data-preview-title>Dein Anmeldelink</h2><p data-preview-identity></p><p class="notice-copy">Das bist du und du hast den Link selbst angefordert? Dann kannst du dich anmelden.</p><label class="consent-choice" data-register-consent-wrap hidden><input type="checkbox" data-register-consent><span>TT-Konto freiwillig anlegen und den <a href="/datenschutz" target="_blank" rel="noopener noreferrer">Datenschutzhinweisen</a> zustimmen. Persönliche Erinnerungen bleiben aus.</span></label><button class="button button-dark button-full" type="button" data-action="magic-finish">Anmelden</button></div>
        <div data-login-state="working" hidden><h2>Anmeldung wird abgeschlossen</h2><p role="status">Einen Moment bitte …</p><span class="loading-line" aria-hidden="true"></span></div>
        <p class="auth-error" data-login-error role="alert" hidden></p>
        <div data-login-state="done" hidden><h2>Du bist angemeldet</h2><p>Dein Zugang ist bereit.</p><a class="button button-dark button-full" data-done-link href="/konto">Weiter <span aria-hidden="true">→</span></a></div>
        <p class="auth-legal">TT prüft den Zugriff auf dein WhatsApp-Konto; das ist keine amtliche Identitätsprüfung. <a href="/datenschutz">Datenschutzhinweise ansehen</a></p>
      </div>
    </section>`,
      '/login',
    );
  }

  if (normalizedPath === '/konto') {
    return shell(
      'Dein Konto',
      `<section class="account-layout" data-account>
      <div class="page-intro"><p class="eyebrow"><span class="eyebrow-dot"></span> Persönlicher Bereich</p><h1>Dein Konto<span class="title-period">.</span></h1><p class="hero-lead">Dein Zugang zu TT bleibt an dein WhatsApp-Konto gebunden.</p></div>
      <p class="auth-error" data-account-error role="alert" hidden></p>
      <div class="content-card account-card"><div class="account-avatar" aria-hidden="true">TT</div><div class="account-copy"><div class="card-kicker">ANGEMELDET ALS</div><h2 data-account-name>Dein TT-Konto</h2><p class="account-status" data-account-status role="status">Konto wird geladen …</p></div><a class="button button-dark" href="/trainer" data-account-trainer-link hidden>Zur Trainingsverwaltung</a><button class="button button-outline" type="button" data-action="logout">Abmelden <span aria-hidden="true">↗</span></button></div>
      <form class="content-card account-settings registration-card" data-account-registration hidden><div class="card-kicker">FREIWILLIGES KONTO</div><h2>TT-Konto anlegen</h2><p>Als Trainer kannst du dich auch ohne Mitgliedskonto anmelden. Für persönliche Einstellungen wird ein freiwilliges Konto benötigt.</p><label class="consent-choice"><input type="checkbox" name="consent" required><span>Ich möchte ein freiwilliges TT-Konto anlegen und habe die <a href="/datenschutz" target="_blank" rel="noopener noreferrer">Datenschutzhinweise</a> gelesen. Erinnerungen bleiben separat ausgeschaltet.</span></label><button class="button button-dark" type="submit">Konto anlegen</button></form>
      <form class="content-card account-settings" data-account-preferences hidden><div><div class="card-kicker">DEIN KONTO</div><h2>Angaben und Erinnerungen</h2></div><label for="account-name">Anzeigename</label><input id="account-name" name="displayName" maxlength="80" autocomplete="name" required><label class="consent-choice"><input type="checkbox" name="reminders" data-reminders><span><strong>Persönliche Trainingserinnerungen erhalten</strong><br>Freiwillig. Die Teilnahme und Gruppenrückmeldungen funktionieren auch ohne diese Auswahl.</span></label><p class="form-hint" data-reminder-consent hidden>Wenn du die Erinnerungen einschaltest, ist das deine gesonderte Zustimmung zu persönlichen Trainingsnachrichten. Du kannst sie jederzeit wieder ausschalten.</p><button class="button button-dark" type="submit">Änderungen speichern</button><p class="account-feedback" data-preferences-feedback role="status"></p></form>
      <details class="content-card account-data"><summary>Meine Daten und Kontolöschung</summary><p>Du kannst die zu deinem TT-Konto gespeicherten Angaben herunterladen oder die Löschung beantragen. Inhalte bei WhatsApp oder Evolution sind davon getrennt.</p><div class="account-actions"><button class="button button-outline" type="button" data-action="export">Daten herunterladen</button></div><div class="delete-account" data-delete-area><label>Zur Bestätigung DELETE eingeben<input type="text" data-delete-confirm autocomplete="off" spellcheck="false"></label><button class="button button-danger" type="button" data-action="delete">TT-Konto endgültig löschen</button><p class="form-hint">Owner-Konten können erst nach einer bestätigten Rollenübertragung gelöscht werden.</p></div></details>
      <section class="content-card owner-transfer-card" data-owner-transfer hidden><div class="card-kicker">ROLLENÜBERTRAGUNG</div><h2>Owner-Übertragung bestätigen?</h2><p data-owner-transfer-text></p><div class="account-actions"><button class="button button-dark" type="button" data-action="transfer-accept">Übertragung annehmen</button><button class="button button-outline" type="button" data-action="transfer-reject">Ablehnen</button></div></section>
    </section>`,
      '/konto',
    );
  }

  if (normalizedPath === '/trainer') {
    return shell(
      'Trainerbereich',
      `<section class="trainer-app" data-trainer aria-busy="true">
  <aside class="workspace-sidebar"><a class="brand workspace-brand" href="/" aria-label="TT Startseite"><span class="brand-mark" aria-hidden="true"><span></span></span><span>TT<span class="brand-period">.</span></span><small>DEIN TRAINING.</small></a><nav class="trainer-nav" aria-label="Trainerbereiche" role="tablist"><button type="button" id="tab-overview" role="tab" aria-controls="panel-overview" aria-selected="true" tabindex="0" data-view="overview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg><span>Start</span></button>
<button type="button" id="tab-sessions" role="tab" aria-controls="panel-sessions" aria-selected="false" tabindex="-1" data-view="sessions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-13 5h2m4 0h2"/></svg><span>Trainingsplan</span></button>
<button type="button" id="tab-requests" role="tab" aria-controls="panel-requests" aria-selected="false" tabindex="-1" data-view="requests"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>Gruppen</span><span class="nav-count" data-request-count hidden></span></button>
<button type="button" id="tab-more" role="tab" aria-controls="panel-more" aria-selected="false" tabindex="-1" data-view="more"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg><span>Mehr</span></button></nav><div class="sidebar-bottom"><a href="/info">Trainingsinfos ↗</a><a href="/konto">Mein Konto</a><a href="/source">TT · Quellcode (AGPL-3.0)</a></div></aside>
  <div class="workspace-main">
    <header class="trainer-heading"><div><p class="eyebrow" data-trainer-greeting>DEINE TRAININGSRUNDE</p><h1 data-workspace-title>Alles im Blick.</h1><p class="account-status" data-trainer-identity role="status">Dein Trainerbereich wird geladen …</p></div><button class="icon-button refresh-button" type="button" data-action="refresh" aria-label="Trainingsdaten aktualisieren"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.6 7a7 7 0 0 1 11.6-2L20 8M4 16l2.8 3A7 7 0 0 0 18.4 17"/></svg></button></header>
    <p class="auth-error" data-trainer-error role="alert" hidden></p><p class="feedback-banner" data-trainer-feedback role="status" hidden></p>
    <section class="trainer-view" role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" data-view-panel="overview">
      <div class="setup-note" data-setup-note hidden><div><strong>Bereit für eure erste Runde?</strong><p data-setup-copy></p></div><button type="button" class="button button-dark" data-setup-action data-view="requests">Gruppe verbinden</button></div>
      <div class="next-training" data-next-training aria-live="polite"><div class="skeleton skeleton-title"></div><div class="skeleton"></div><p class="form-hint">Dein nächstes Training wird geladen …</p></div>
      <div class="section-heading upcoming-heading"><div><p class="card-kicker">GUT VORAUSGEPLANT</p><h2>Danach am Tisch</h2></div><button class="text-button" type="button" data-view="sessions">Alle Termine →</button></div><div class="session-list compact-sessions" data-sessions-list></div>
      <div class="overview-bottom"><div class="trainer-banner" data-run-state role="status"><span class="state-dot"></span><div><strong data-run-label>Nachrichten werden geprüft</strong><p data-run-description></p></div><button class="text-button" type="button" data-action="settings-shortcut">Ändern →</button></div><details class="delivery-disclosure content-card"><summary><span><strong>Nachrichten &amp; Versand</strong><small data-delivery-teaser>Versandstatus wird geladen …</small></span><span aria-hidden="true">⌄</span></summary><div class="delivery-summary" data-delivery-summary></div></details></div>
    </section>
    <section class="trainer-view" role="tabpanel" id="panel-sessions" aria-labelledby="tab-sessions" data-view-panel="sessions" hidden>
      <div class="section-heading"><div><p class="card-kicker">DEIN KALENDER</p><h2>Die nächsten Trainings</h2></div><button class="button button-dark" type="button" data-action="create:session">＋ Termin</button></div>
      <div class="plan-tools"><button class="button button-outline" type="button" data-view="series">Wöchentliche Serien →</button><button class="button button-outline" type="button" data-action="create:pause">Pause eintragen</button></div><div class="session-list" data-sessions-list-secondary></div>
      <details class="content-card form-disclosure pause-history"><summary><span>Trainingspausen<small>Ferien und andere Ausnahmen verwalten</small></span><span aria-hidden="true">⌄</span></summary><div class="exception-list" data-exception-list></div></details>
    </section>
    <section class="trainer-view" role="tabpanel" id="panel-series" aria-labelledby="series-title" data-view-panel="series" hidden><button type="button" class="back-link" data-view="sessions">← Trainingsplan</button><div class="section-heading"><div><p class="card-kicker">JEDE WOCHE</p><h2 id="series-title">Dein Trainingsrhythmus</h2></div><button class="button button-dark" type="button" data-action="create:series">＋ Serie</button></div><p class="view-lead">Einmal planen. Die nächsten Termine entstehen automatisch.</p><div class="series-list" data-series-list></div></section>
    <section class="trainer-view" role="tabpanel" id="panel-requests" aria-labelledby="tab-requests" data-view-panel="requests" hidden><div class="section-heading"><div><p class="card-kicker">GRUPPENZUGANG</p><h2>Gruppenanfragen</h2></div><button class="button button-outline" type="button" data-action="load-requests">Aktualisieren</button></div><form class="content-card form-card request-create" data-form="group-request"><div class="card-kicker">1 · EINLADUNGSLINK PRÜFEN</div><h3>WhatsApp-Gruppe hinzufügen</h3><p>Kopiere den Einladungslink aus WhatsApp. Wir prüfen zuerst den Gruppennamen. Erst nach deiner Freigabe tritt TT bei und begrüßt eure Runde.</p><label>Einladungslink<input type="url" name="inviteLink" autocomplete="off" placeholder="https://chat.whatsapp.com/…" required></label><button class="button button-dark" type="submit">Link prüfen</button></form><div class="section-heading"><div><p class="card-kicker">2 · PRÜFEN UND FREIGEBEN</p><h3>Deine Gruppenanfragen</h3><p class="form-hint">Auch Gruppen, in denen TT direkt hinzugefügt wurde, erscheinen hier. Die Freigabe sendet eine einmalige Begrüßung. Trainingsnachrichten aktivierst du separat.</p></div></div><div class="request-list" data-request-list><p class="empty-copy">Anfragen werden geladen …</p></div></section>

    <section class="trainer-view" role="tabpanel" id="panel-more" aria-labelledby="tab-more" data-view-panel="more" hidden><div class="section-heading"><div><p class="card-kicker">PASST ZU DEINER RUNDE</p><h2>Deine Einstellungen</h2></div></div><div class="more-menu"><button data-view="settings" type="button"><span class="menu-icon" aria-hidden="true">⚙</span><span><strong>Gruppe &amp; Nachrichten</strong><small>Automatik, Trainingsinfos und Datenschutz</small></span><span aria-hidden="true">→</span></button><button data-action="summary-shortcut" type="button"><span class="menu-icon" aria-hidden="true">◷</span><span><strong>Meine Trainerübersicht</strong><small>Wer kommt? Persönliche Nachricht vor Beginn</small></span><span aria-hidden="true">→</span></button><button data-view="admins" data-owner-only hidden type="button"><span class="menu-icon" aria-hidden="true">♙</span><span><strong>Trainerzugänge</strong><small>Rollen vergeben und Verantwortung übertragen</small></span><span aria-hidden="true">→</span></button><a href="/konto"><span class="menu-icon" aria-hidden="true">◎</span><span><strong>Mein Konto</strong><small>Persönliche Angaben, Daten und Abmeldung</small></span><span aria-hidden="true">→</span></a></div><p class="form-hint more-privacy" data-trainer-status></p><a class="text-link" href="/datenschutz">Datenschutzhinweise ↗</a></section>
    <section class="trainer-view" role="tabpanel" id="panel-settings" aria-labelledby="settings-title" data-view-panel="settings" hidden><button type="button" class="back-link" data-view="more">← Mehr</button><div class="section-heading"><div><p class="card-kicker">DEINE RUNDE</p><h2 id="settings-title" tabindex="-1">Einstellungen</h2></div></div><div class="settings-grid"><section class="content-card form-card"><div class="card-kicker">TRAININGSGRUPPE</div><h3>Verbundene Gruppe</h3><p class="form-hint">Nur Gruppen auswählen, deren Mitglieder über TT informiert wurden.</p><label for="selected-group">Gruppe</label><select id="selected-group" data-group-select required></select><div class="form-actions"><button class="button button-dark" type="button" data-action="select-group">Gruppe auswählen</button><button class="button button-outline" type="button" data-action="refresh-groups">Gruppen aktualisieren</button></div></section><details class="form-disclosure content-card" data-create="info"><summary><span>Trainingsinformationen<small>Öffentliche Infos für deine Mitglieder</small></span><span class="disclosure-plus" aria-hidden="true">＋</span></summary><form class="form-card" data-form="settings-info"><div class="card-kicker">ÖFFENTLICHE TRAININGSINFOS</div><h3>Informationen für Mitglieder</h3><label for="info-text">Text auf der Trainingsseite</label><textarea id="info-text" name="infoText" rows="5" maxlength="6000"></textarea><button class="button button-dark" type="submit">Informationen veröffentlichen</button></form></details><details class="form-disclosure content-card" data-create="privacy"><summary><span>Datenschutzhinweise<small>Verantwortliche Stelle und Datenverarbeitung</small></span><span class="disclosure-plus" aria-hidden="true">＋</span></summary><form class="form-card" data-form="settings-privacy"><div class="card-kicker">DATENSCHUTZHINWEISE</div><h3>Verantwortliche und Verarbeitung</h3><label for="privacy-text">Vollständiger Datenschutzhinweis</label><textarea id="privacy-text" name="privacyText" rows="7" minlength="20" maxlength="6000" required></textarea><label class="consent-choice"><input type="checkbox" name="confirm" required><span>Ich habe die Angaben mit der verantwortlichen Stelle geprüft und werde die Gruppe vor dem Start informieren.</span></label><button class="button button-dark" type="submit">Hinweise speichern und bestätigen</button><p class="form-hint" data-privacy-state></p></form></details><details class="form-disclosure content-card" data-create="summary"><summary><span>Meine Trainererinnerung<small>Persönliche Übersicht vor dem Training</small></span><span class="disclosure-plus" aria-hidden="true">＋</span></summary><form class="form-card" data-form="summary-preference"><div class="card-kicker">PERSÖNLICHE TRAINERERINNERUNG</div><h3>Zusammenfassung vor dem Training</h3><label class="switch-row"><input type="checkbox" name="enabled"><span>Zusammenfassung senden</span></label><label>Minuten vor Beginn<input type="number" name="offsetMinutes" min="0" max="120" value="10" required></label><label class="switch-row"><input type="checkbox" name="includeCounts" checked><span>Anzahl der Zusagen und offenen Antworten</span></label><label class="switch-row"><input type="checkbox" name="includeAbsent" checked><span>Absagen</span></label><label class="switch-row"><input type="checkbox" name="includeLate" checked><span>Verspätungen</span></label><input type="hidden" name="version" value="0"><button class="button button-outline" type="submit">Erinnerungen speichern</button></form></details><form class="content-card activation-card" data-form="activation"><div class="card-kicker">NACHRICHTENBETRIEB</div><h3 data-activation-title>Trainingsnachrichten sind pausiert</h3><p data-activation-description>Du entscheidest ausdrücklich, wann TT Nachrichten an die Gruppe sendet.</p><label class="consent-choice"><input type="checkbox" name="confirm" required><span>Die Gruppe wurde informiert und ich habe die Einstellungen geprüft.</span></label><button class="button button-green" type="submit" data-activation-button>Trainingsnachrichten aktivieren</button></form></div></section>

    <section class="trainer-view" role="tabpanel" id="panel-admins" aria-labelledby="admins-title" data-view-panel="admins" hidden data-owner-only><button type="button" class="back-link" data-view="more">← Mehr</button><div class="section-heading"><div><p class="card-kicker">ROLLEN UND ZUGRIFF</p><h2 id="admins-title">Trainer verwalten</h2></div><button class="button button-outline" type="button" data-action="load-admins">Aktualisieren</button></div><div class="admin-grid"><form class="content-card form-card" data-form="admin-role"><div class="card-kicker">PERSONAL AUSWÄHLEN</div><h3>Rolle vergeben</h3><label>Person<select name="userId" data-eligible-select required></select></label><label>Rolle<select name="role"><option value="admin">Trainer-Admin</option><option value="owner">Owner übertragen</option></select></label><button class="button button-dark" type="submit">Rolle vergeben</button><p class="form-hint">Wähle die Person anhand ihres Namens und der angezeigten WhatsApp-Kennung aus.</p></form><div class="admin-list" data-admin-list></div></div><div class="transfer-incoming" data-owner-transfer-admin hidden></div></section>
    <section class="trainer-view" id="panel-attendance" data-view-panel="attendance" aria-labelledby="attendance-title" hidden><button class="back-link" type="button" data-action="attendance-back">← Zurück</button><div data-attendance-panel class="attendance-panel" aria-live="polite"></div></section>
  </div>
  <dialog class="editor-dialog" data-editor="session" aria-labelledby="editor-session"><div class="dialog-heading"><h2 id="editor-session">Ein Training hinzufügen</h2><button class="icon-button" type="button" data-action="close-editor" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><form class="form-card" data-form="single-session"><div class="card-kicker">EINZELTERMIN</div><h3>Training hinzufügen</h3><label for="session-group">Gruppe</label><select id="session-group" name="groupJid" required data-group-select></select><div class="field-grid"><label>Datum<input type="date" name="date" required></label><label>Beginn<input type="time" name="startTime" required></label><label>Ende<input type="time" name="endTime" required></label></div><label>Ort<input name="location" minlength="2" maxlength="200" placeholder="z. B. Sporthalle am Park" required></label><button class="button button-dark" type="submit">Training anlegen</button></form></dialog><dialog class="editor-dialog" data-editor="series" aria-labelledby="editor-series"><div class="dialog-heading"><h2 id="editor-series">Wöchentliches Training</h2><button class="icon-button" type="button" data-action="close-editor" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><form class="form-card" data-form="series"><div class="card-kicker" data-series-form-kicker>NEUE SERIE</div><h3 data-series-form-title>Wiederkehrendes Training</h3><input type="hidden" name="seriesId"><input type="hidden" name="version"><label for="series-group">Gruppe</label><select id="series-group" name="groupJid" required data-group-select></select><label>Wochentag<select name="weekday" required><option value="1">Montag</option><option value="2">Dienstag</option><option value="3">Mittwoch</option><option value="4">Donnerstag</option><option value="5">Freitag</option><option value="6">Samstag</option><option value="7">Sonntag</option></select></label><div class="field-grid"><label>Beginn<input type="time" name="startTime" required value="18:00"></label><label>Ende<input type="time" name="endTime" required value="20:00"></label></div><label>Ort<input name="location" minlength="2" maxlength="200" placeholder="z. B. Sporthalle am Park" required></label><div class="field-grid"><label>Einladung am Vortag<input type="time" name="reminderTime" value="18:00" required></label><label>Verspätungsinfo (Min.)<input type="number" name="lateOffset" min="0" max="240" value="30" required></label></div><div class="form-actions"><button class="button button-dark" type="submit">Serie speichern</button></div></form></dialog><dialog class="editor-dialog" data-editor="pause" aria-labelledby="editor-pause"><div class="dialog-heading"><h2 id="editor-pause">Trainingspause</h2><button class="icon-button" type="button" data-action="close-editor" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><form class="form-card" data-form="pause"><div class="card-kicker">PAUSE</div><h3>Trainingspause</h3><label for="pause-group">Gruppe</label><select id="pause-group" name="groupJid" required data-group-select></select><div class="field-grid"><label>Von<input type="date" name="fromDate" required></label><label>Bis einschließlich<input type="date" name="toDate" required></label></div><button class="button button-outline" type="submit">Pause speichern</button></form></dialog>
  <dialog class="editor-dialog" data-move-dialog aria-labelledby="move-dialog-title"><div class="dialog-heading"><h2 id="move-dialog-title">Training verschieben</h2><button class="icon-button" type="button" data-action="close-move" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><form class="form-card" data-form="move-session"><input type="hidden" name="sessionId"><input type="hidden" name="version"><label>Neues Datum<input type="date" name="date" required></label><label>Neue Startzeit<input type="time" name="startTime" required></label><div class="form-actions"><button class="button button-dark" type="submit">Termin ändern</button><button class="button button-outline" type="button" data-action="close-move">Abbrechen</button></div></form></dialog>
</section>`,
      '/trainer',
    );
  }

  return null;
}
