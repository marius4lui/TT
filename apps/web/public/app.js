(() => {
  const authRoot = document.querySelector('[data-login]');
  const accountRoot = document.querySelector('[data-account]');
  const request = async (path, init = {}) => {
    let response;
    try {
      response = await fetch(path, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new Error(
        'Der Dienst ist gerade nicht erreichbar. Prüfe deine Verbindung und versuche es erneut.',
      );
    }
    let payload = {};
    try {
      const body = await response.json();
      if (body && typeof body === 'object') payload = body;
    } catch {
      /* The API may have no body on errors. */
    }
    if (!response.ok) {
      const messages = {
        not_ready:
          'Die Anmeldung ist derzeit noch nicht freigeschaltet. Bitte wende dich an den Trainer.',
        rate_limit: 'Zu viele Versuche. Bitte warte kurz und versuche es später erneut.',
        origin:
          'Die Anfrage konnte nicht bestätigt werden. Lade die Seite neu und starte es erneut.',
        origin_mismatch:
          'Die Anfrage konnte nicht bestätigt werden. Lade die Seite neu und starte es erneut.',
        invalid_challenge:
          'Der Anmeldecode ist abgelaufen oder passt nicht zu diesem Browser. Starte bitte eine neue Anmeldung.',
        unauthorized: 'Deine Anmeldung ist abgelaufen. Melde dich bitte erneut an.',
        internal_error: 'Der Dienst ist gerade nicht verfügbar. Bitte versuche es später erneut.',
      };
      const code = typeof payload.error === 'string' ? payload.error : '';
      throw new Error(
        Object.hasOwn(messages, code)
          ? messages[code]
          : 'Die Anfrage konnte gerade nicht abgeschlossen werden. Bitte versuche es erneut.',
      );
    }
    return payload;
  };
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  if (authRoot) {
    const panels = [...authRoot.querySelectorAll('[data-auth-panel]')];
    const error = authRoot.querySelector('[data-auth-error]');
    const retry = authRoot.querySelector('[data-action="retry"]');
    const startButton = authRoot.querySelector('[data-action="start"]');
    let active = false;
    let attempt = 0;
    const setStartLabel = (label) => {
      const children = [document.createTextNode(label)];
      if (label === 'Anmeldung starten') {
        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '→';
        children.push(arrow);
      }
      startButton.replaceChildren(...children);
    };
    const show = (name) =>
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.authPanel !== name;
      });
    const showError = (message) => {
      error.textContent = message;
      error.hidden = false;
      retry.hidden = false;
    };
    const clearError = () => {
      error.textContent = '';
      error.hidden = true;
      retry.hidden = true;
    };

    const finishWhenConfirmed = async (currentAttempt) => {
      const startedAt = Date.now();
      while (active && currentAttempt === attempt && Date.now() - startedAt < 5 * 60 * 1000) {
        const result = await request('/api/v1/auth/status');
        if (result.status === 'confirmed') {
          show('confirmed');
          await request('/api/v1/auth/finish', { method: 'POST' });
          if (currentAttempt !== attempt) return;
          const me = await request('/api/v1/me');
          const user = me.user || {};
          const displayName = user.displayName || user.display_name || user.name;
          if (displayName)
            authRoot.querySelector('[data-auth-name]').textContent = `, ${displayName}`;
          show('account');
          return;
        }
        if (result.status === 'expired' || result.status === 'failed')
          throw new Error('Der Code ist abgelaufen. Starte bitte eine neue Anmeldung.');
        await pause(2500);
      }
      if (active && currentAttempt === attempt)
        throw new Error('Die Anmeldung ist abgelaufen. Starte bitte erneut.');
    };

    const start = async () => {
      if (active) return;
      active = true;
      attempt += 1;
      const currentAttempt = attempt;
      clearError();
      startButton.disabled = true;
      startButton.textContent = 'Anmeldung wird vorbereitet …';
      try {
        const result = await request('/api/v1/auth/start', { method: 'POST' });
        if (currentAttempt !== attempt) return;
        if (!result.code || !result.waLink)
          throw new Error(
            'Der Anmeldecode konnte nicht angezeigt werden. Bitte versuche es erneut.',
          );
        const wa = new URL(result.waLink, window.location.origin);
        if (wa.protocol !== 'https:' || !['wa.me', 'api.whatsapp.com'].includes(wa.hostname))
          throw new Error('Der WhatsApp-Link ist ungültig. Bitte starte die Anmeldung erneut.');
        authRoot.querySelector('[data-code]').textContent = result.code;
        const link = authRoot.querySelector('[data-wa-link]');
        link.href = wa.href;
        show('challenge');
        await finishWhenConfirmed(currentAttempt);
      } catch (failure) {
        if (currentAttempt === attempt) {
          active = false;
          startButton.disabled = false;
          setStartLabel('Anmeldung starten');
          showError(failure.message || 'Etwas ist schiefgelaufen. Bitte versuche es erneut.');
        }
      }
    };
    startButton.addEventListener('click', start);
    retry.addEventListener('click', () => {
      attempt += 1;
      active = false;
      clearError();
      show('start');
      startButton.disabled = false;
      setStartLabel('Anmeldung starten');
    });
  }

  if (accountRoot) {
    const status = accountRoot.querySelector('[data-account-status]');
    const error = accountRoot.querySelector('[data-account-error]');
    const name = accountRoot.querySelector('[data-account-name]');
    const logout = accountRoot.querySelector('[data-action="logout"]');
    request('/api/v1/me')
      .then((result) => {
        const user = result.user || result;
        name.textContent = user.displayName || user.display_name || user.name || 'Dein TT-Konto';
        status.textContent = 'Du bist angemeldet. Persönliche Erinnerungen sind optional.';
      })
      .catch(() => {
        status.textContent = 'Deine Anmeldung ist nicht mehr aktiv.';
        const link = document.createElement('a');
        link.href = '/login';
        link.textContent = 'Erneut anmelden';
        link.className = 'text-link';
        status.after(link);
      });
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      error.hidden = true;
      try {
        await request('/api/v1/auth/logout', { method: 'POST' });
        window.location.assign('/login');
      } catch (failure) {
        logout.disabled = false;
        error.textContent = failure.message || 'Abmelden war gerade nicht möglich.';
        error.hidden = false;
      }
    });
  }
})();
