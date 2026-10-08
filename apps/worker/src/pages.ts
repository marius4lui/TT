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
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f7f7f2">
    <title>${escapeHtml(title)} · TT</title>
    <link rel="stylesheet" href="/style.css">
    <script src="/app.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#inhalt">Zum Inhalt springen</a>
    <header class="site-header">
      <a class="brand" href="/" aria-label="TT Startseite">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span>TT<span class="brand-period">.</span></span>
      </a>
      <nav class="main-nav" aria-label="Hauptnavigation">
        <a href="/info"${activePath === '/info' ? ' aria-current="page"' : ''}>Training</a>
        <a href="/datenschutz"${activePath === '/datenschutz' ? ' aria-current="page"' : ''}>Datenschutz</a>
        <a class="nav-login" href="/login"${activePath === '/login' || activePath === '/konto' ? ' aria-current="page"' : ''}>Anmelden <span aria-hidden="true">↗</span></a>
      </nav>
    </header>
    <main id="inhalt">${content}</main>
    <footer class="site-footer">
      <span>TT <span aria-hidden="true">·</span> Tischtennis gemeinsam planen</span>
      <nav aria-label="Weitere Links"><a href="/info">Training</a><a href="/datenschutz">Datenschutz</a></nav>
    </footer>
  </body>
</html>`;

export interface PageOptions {
  botName: string;
  infoText: string;
  privacyText: string;
  botNumber: string;
  origin: string;
}

export function renderPage(path: string, options: PageOptions): string | null {
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const botName = escapeHtml(options.botName || 'Marius Bot');
  const infoText = escapeHtml(options.infoText).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>\n');
  const privacyText = escapeHtml(options.privacyText)
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>\n');
  const phone = String(options.botNumber ?? '').replace(/\D/g, '');
  const botLink = phone ? `https://wa.me/${encodeURIComponent(phone)}` : '';

  if (normalizedPath === '/') {
    const contact = botLink
      ? `<a class="button button-dark" href="${escapeHtml(botLink)}" rel="noopener noreferrer">${botName} auf WhatsApp <span aria-hidden="true">↗</span></a>`
      : `<a class="button button-dark" href="/info">Training ansehen <span aria-hidden="true">↗</span></a>`;
    return shell(
      'Tischtennis gemeinsam planen',
      `<section class="home-hero">
      <div class="hero-copy">
        <p class="eyebrow"><span class="eyebrow-dot"></span> Tischtennis. Einfach organisiert.</p>
        <h1>Mehr Spiel.<br><span>Weniger Abstimmung.</span></h1>
        <p class="hero-lead">Trainingsinfos und Rückmeldungen an einem Ort. TT hält eure Runde über WhatsApp auf dem Laufenden.</p>
        <div class="hero-actions">${contact}<a class="text-link" href="/info">So läuft’s <span aria-hidden="true">→</span></a></div>
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
      <div class="auth-intro"><p class="eyebrow"><span class="eyebrow-dot"></span> Dein TT-Konto</p><h1>Ein kurzer Weg.<br><span>Dein WhatsApp.</span></h1><p class="hero-lead">Bestätige, dass du Zugriff auf dein WhatsApp-Konto hast. TT verwendet dafür einen einmaligen Code.</p>
        <div class="auth-facts"><div><span class="fact-check" aria-hidden="true">✓</span><span>Kein Passwort nötig</span></div><div><span class="fact-check" aria-hidden="true">✓</span><span>Erinnerungen bleiben optional</span></div></div>
      </div>
      <div class="auth-card">
        <div class="auth-card-top"><span class="whatsapp-glyph" aria-hidden="true">◉</span><span class="card-kicker">ANMELDUNG</span></div>
        <div data-auth-panel="start"><h2>Mit WhatsApp fortfahren</h2><p>Wir zeigen dir einen Code. Sende ihn im Chat mit ${botName}; danach kannst du hier weitergehen.</p><button class="button button-dark button-full" type="button" data-action="start">Anmeldung starten <span aria-hidden="true">→</span></button></div>
        <div data-auth-panel="challenge" hidden><h2>Code im Chat senden</h2><p>Öffne WhatsApp und sende diese Nachricht an ${botName}.</p><div class="code-box" data-code aria-label="Einmaliger Anmeldecode"></div><a class="button button-green button-full" data-wa-link href="#" target="_blank" rel="noopener noreferrer">WhatsApp öffnen <span aria-hidden="true">↗</span></a><p class="expiry-note" role="status">Der Code läuft nach wenigen Minuten ab. Diese Seite wartet auf deine Bestätigung.</p></div>
        <div data-auth-panel="confirmed" hidden><h2>Bestätigt</h2><p>Dein WhatsApp-Konto ist bestätigt. Wir schließen die Anmeldung ab.</p><span class="loading-line" role="status">Konto wird geöffnet …</span></div>
        <div data-auth-panel="account" hidden><h2>Du bist angemeldet<span data-auth-name></span></h2><p>Dein TT-Konto ist bereit. Persönliche Erinnerungen kannst du freiwillig im WhatsApp-Chat verwalten.</p><a class="button button-dark button-full" href="/konto">Zum Konto <span aria-hidden="true">→</span></a></div>
        <p class="auth-error" data-auth-error role="alert" hidden></p>
        <button class="text-button" type="button" data-action="retry" hidden>Erneut versuchen</button>
        <p class="auth-legal">Mit der Anmeldung wird ein TT-Konto erstellt oder geöffnet. <a href="/datenschutz">Datenschutzhinweise ansehen</a></p>
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
      <div class="content-card account-card"><div class="account-avatar" aria-hidden="true">TT</div><div class="account-copy"><div class="card-kicker">ANGEMELDET ALS</div><h2 data-account-name>Dein TT-Konto</h2><p class="account-status" data-account-status role="status">Konto wird geladen …</p></div><button class="button button-outline" type="button" data-action="logout">Abmelden <span aria-hidden="true">↗</span></button></div>
      <div class="small-callout"><span class="callout-icon" aria-hidden="true">◎</span><div><h2>Erinnerungen sind freiwillig</h2><p>Persönliche Trainingsnachrichten werden nur nach deiner gesonderten Zustimmung aktiviert. Verwalte deine Auswahl im Chat mit dem Bot.</p></div>${botLink ? `<a class="text-link" href="${escapeHtml(botLink)}" rel="noopener noreferrer">WhatsApp öffnen <span aria-hidden="true">→</span></a>` : ''}</div>
      <p class="auth-error" data-account-error role="alert" hidden></p>
    </section>`,
      '/konto',
    );
  }

  return null;
}
