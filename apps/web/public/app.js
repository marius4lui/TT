(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      /* response has no JSON body */
    }
    if (!response.ok) {
      const error = new Error(body.error || 'request_failed');
      error.status = response.status;
      throw error;
    }
    return body;
  };
  const post = (path, data = {}) => api(path, { method: 'POST', body: JSON.stringify(data) });
  const put = (path, data = {}) => api(path, { method: 'PUT', body: JSON.stringify(data) });
  const patch = (path, data = {}) => api(path, { method: 'PATCH', body: JSON.stringify(data) });
  const del = (path, data = {}) => api(path, { method: 'DELETE', body: JSON.stringify(data) });
  const userError = (value) => Object.assign(new Error(value), { name: 'UserInputError' });
  const message = (error) =>
    error?.name === 'UserInputError'
      ? error.message
      : {
          invalid_link:
            'Dieser Anmeldelink ist ungültig oder wurde bereits verwendet. Fordere im privaten WhatsApp-Chat einen neuen Link an.',
          registration_required: 'Für diese Funktion brauchst du ein freiwilliges TT-Konto.',
          not_ready: 'Der Dienst ist gerade nicht bereit. Bitte versuche es später erneut.',
          rate_limit: 'Zu viele Versuche in kurzer Zeit. Bitte warte kurz und versuche es erneut.',
          origin:
            'Die Anfrage konnte nicht sicher zugeordnet werden. Lade die Seite neu und versuche es erneut.',
          invalid_challenge: 'Die Anmeldung ist abgelaufen. Fordere einen neuen Link an.',
          reauthentication_required:
            'Aus Sicherheitsgründen ist eine frische Anmeldung nötig. Fordere im privaten WhatsApp-Chat einen neuen Anmeldelink an.',
          owner_transfer_required:
            'Die Owner-Rolle muss zuerst übertragen und von der anderen Person angenommen werden.',
          unauthorized: 'Deine Anmeldung ist abgelaufen. Melde dich erneut an.',
          forbidden: 'Für diesen Bereich brauchst du einen Trainerzugang.',
          state_changed:
            'Die Angaben wurden inzwischen geändert. Aktualisiere die Ansicht und versuche es erneut.',
          session_changed: 'Dieser Termin wurde inzwischen geändert. Aktualisiere die Ansicht.',
          attendance_changed:
            'Diese Rückmeldung wurde inzwischen geändert. Öffne die Rückmeldungen erneut und prüfe den aktuellen Stand.',
          invalid_input:
            'Bitte prüfe die Angaben. Alle Pflichtfelder müssen vollständig ausgefüllt sein.',
          invalid_calendar: 'Die Zeiten passen nicht zusammen. Prüfe Datum, Beginn und Ende.',
          privacy_required: 'Hinterlege zuerst die Datenschutzhinweise unter Einstellungen.',
          group_approval_required: 'Gib zuerst eine Trainingsgruppe frei und wähle sie unter Einstellungen aus.',
          group_unavailable:
            'Diese Gruppe ist derzeit nicht verfügbar. Aktualisiere die Gruppenliste.',
          consent_required: 'Bitte bestätige deine Auswahl, bevor du fortfährst.',
          origin_mismatch: 'Lade die Seite neu, damit die Anfrage sicher zugeordnet werden kann.',
          invalid_invite:
            'Dieser Einladungslink ist ungültig. Kopiere einen aktuellen Link aus der WhatsApp-Gruppe.',
          provider_unavailable:
            'WhatsApp ist gerade nicht erreichbar. Versuche es in einem Moment erneut.',
          request_changed: 'Diese Gruppenanfrage wurde bereits bearbeitet. Aktualisiere die Liste.',
          request_expired:
            'Diese Gruppenanfrage ist abgelaufen. Prüfe einen aktuellen Einladungslink.',
          approval_interrupted:
            'Der Beitritt wurde unterbrochen. Gleiche die Mitgliedschaft ab, um den aktuellen Stand zu prüfen.',
          invite_changed:
            'Der Link gehört inzwischen zu einer anderen Gruppe. Bitte prüfe einen aktuellen Einladungslink.',
          membership_unconfirmed:
            'Der Beitritt ist noch nicht bestätigt. Gleiche die Mitgliedschaft erneut ab.',
          approval_unconfirmed:
            'Das Ergebnis ist noch ungeklärt. Gleiche die Mitgliedschaft ab, bevor du erneut freigibst.',
        }[error?.message] ||
        'Das hat gerade nicht geklappt. Bitte prüfe deine Eingaben und versuche es erneut.';
  const showError = (node, error) => {
    const openDialog = $('dialog[open]');
    if (openDialog && node && !openDialog.contains(node)) {
      let localError = $('[data-dialog-error]', openDialog);
      if (!localError) {
        localError = text('p', '', 'auth-error');
        localError.dataset.dialogError = '';
        localError.setAttribute('role', 'alert');
        $('form', openDialog).prepend(localError);
      }
      node = localError;
    }
    if (node) {
      node.textContent = message(error);
      node.hidden = false;
      if (error?.status === 401) {
        const login = text('a', 'Erneut anmelden', 'error-login');
        login.href = '/login';
        node.append(document.createTextNode(' '), login);
      }
      node.setAttribute('tabindex', '-1');
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  };
  const clearError = (node) => {
    if (node) {
      node.textContent = '';
      node.hidden = true;
    }
  };
  const setBusy = (form, busy) => {
    if (!form) return;
    form.setAttribute('aria-busy', String(busy));
    $$('button[type="submit"],button[data-action]', form).forEach((button) => {
      button.disabled = busy;
      if (button.type === 'submit') {
        if (busy && !button.dataset.idleLabel) {
          button.dataset.idleLabel = button.textContent;
          button.textContent = 'Wird gespeichert …';
        } else if (!busy && button.dataset.idleLabel) {
          button.textContent = button.dataset.idleLabel;
          delete button.dataset.idleLabel;
        }
      }
    });
  };
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  };
  const button = (label, action, className = 'button button-outline') => {
    const node = text('button', label, className);
    node.type = 'button';
    node.dataset.action = action;
    return node;
  };
  const dateLabel = (value, withTime = false) => {
    const date = new Date(
      typeof value === 'string' && /^\d{12,14}$/.test(value) ? Number(value) : value,
    );
    if (Number.isNaN(date.valueOf())) return String(value || '');
    return new Intl.DateTimeFormat(
      'de-DE',
      withTime
        ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }
        : { dateStyle: 'full', timeZone: 'Europe/Berlin' },
    ).format(date);
  };
  const deliveryKindLabel = (kind) =>
    ({
      invite: 'Trainingseinladung',
      late: 'Verspätungsabfrage',
      trainer_summary: 'Trainerübersicht',
    })[kind] || 'Geplante Nachricht';
  const deliveryStatusLabel = (status) =>
    ({
      scheduled: 'geplant',
      paused: 'pausiert',
      pending: 'ausstehend',
      failed: 'fehlgeschlagen',
      uncertain: 'ungeklärt',
    })[status] || 'geplant';
  const formData = (form) => Object.fromEntries(new FormData(form).entries());
  const bool = (form, key) => $('input[name="' + key + '"]', form)?.checked === true;
  const route = (path) => `/api/v1/trainer${path}`;
  const updateNavigation = (me) => {
    const link = $('[data-auth-nav]');
    if (!link || !me?.user) return;
    link.href = me.role ? '/trainer' : '/konto';
    link.textContent = me.role ? 'Mein Trainerbereich' : 'Mein Konto';
  };

  // Native dialogs retain focus, support Escape and expose one explicit action.
  const confirmAction = ({
    title,
    description,
    label = 'Bestätigen',
    danger = false,
    minutes = false,
  }) =>
    new Promise((resolve) => {
      const dialog = $('[data-confirm-dialog]');
      $('[data-confirm-title]', dialog).textContent = title;
      $('[data-confirm-copy]', dialog).textContent = description;
      const accept = $('[data-confirm-accept]', dialog);
      accept.textContent = label;
      accept.className = `button ${danger ? 'button-danger' : 'button-dark'}`;
      const field = $('[data-confirm-field]', dialog);
      field.hidden = !minutes;
      const input = $('[data-confirm-minutes]', dialog);
      input.value = '';
      dialog.returnValue = '';
      const finish = () => {
        dialog.removeEventListener('close', finish);
        resolve(
          dialog.returnValue === 'accept'
            ? minutes
              ? { minutes: input.value ? Number(input.value) : undefined }
              : true
            : false,
        );
      };
      dialog.addEventListener('close', finish);
      dialog.showModal();
      (danger ? $('[data-confirm-cancel]', dialog) : minutes ? input : accept).focus();
    });

  async function initLogin(root) {
    const token = location.hash.slice(1);
    if (!token) {
      try {
        const me = await api('/api/v1/me');
        updateNavigation(me);
        if (me.user) location.replace(me.role ? '/trainer' : '/konto');
      } catch {
        /* A new visitor can request a link. */
      }
      return;
    }
    if (!/^[a-f0-9]{48}$/.test(token)) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      showError($('[data-login-error]', root), new Error('invalid_link'));
      return;
    }
    // Remove the bearer token from the address bar before any other interaction.
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    const states = $$('[data-login-state]', root);
    const errorNode = $('[data-login-error]', root);
    const state = (name) =>
      states.forEach((node) => {
        node.hidden = node.dataset.loginState !== name;
      });
    try {
      const preview = await post('/api/v1/auth/magic/preview', { token });
      if (preview.status !== 'ready') throw new Error('invalid_link');
      const needsRegistration = Boolean(preview.registrationRequired && !preview.role);
      $('[data-preview-title]', root).textContent = preview.role
        ? 'Anmeldung für den Trainerbereich'
        : 'Dein Anmeldelink';
      $('[data-preview-identity]', root).textContent = preview.displayName
        ? `Der Link gehört zu ${preview.displayName}${preview.accountHint ? ` (${preview.accountHint})` : ''}.`
        : 'Die Identität für diesen Link konnte nicht angezeigt werden.';
      const consent = $('[data-register-consent-wrap]', root);
      consent.hidden = !needsRegistration || !preview.privacyReady;
      const finish = $('[data-action="magic-finish"]', root);
      finish.disabled = Boolean(needsRegistration && !preview.privacyReady);
      if (needsRegistration && !preview.privacyReady) {
        const note = text(
          'p',
          'Die verantwortliche Stelle hat die Datenschutzhinweise noch nicht veröffentlicht. Eine Kontoanlage ist deshalb momentan nicht möglich.',
          'form-hint',
        );
        consent.after(note);
      }
      state('preview');
      finish.addEventListener('click', async () => {
        clearError(errorNode);
        if (needsRegistration && !$('[data-register-consent]', root).checked) {
          showError(
            errorNode,
            userError(
              'Bitte bestätige zuerst die freiwillige Registrierung und die Datenschutzhinweise.',
            ),
          );
          return;
        }
        finish.disabled = true;
        state('working');
        try {
          const result = await post('/api/v1/auth/magic/finish', {
            token,
            ...(needsRegistration ? { consent: true } : {}),
          });
          $('[data-done-link]', root).href =
            result.redirect || (result.role ? '/trainer' : '/konto');
          $('[data-done-link]', root).textContent = result.role
            ? 'Zum Trainerbereich'
            : 'Zum Konto';
          state('done');
          location.replace(result.redirect || (result.role ? '/trainer' : '/konto'));
        } catch (error) {
          state('preview');
          finish.disabled = false;
          showError(errorNode, error);
        }
      });
    } catch (error) {
      state('welcome');
      showError(errorNode, error);
    }
  }

  async function initAccount(root) {
    const errorNode = $('[data-account-error]', root);
    const pref = $('[data-account-preferences]', root);
    let me;
    try {
      me = await api('/api/v1/me');
    } catch (error) {
      showError(errorNode, error);
      return;
    }
    const user = me.user || {};
    updateNavigation(me);
    $('[data-account-name]', root).textContent = user.displayName || 'TT-Konto';
    $('[data-account-status]', root).textContent =
      `Angemeldet${user.registeredAt ? ` seit ${dateLabel(user.registeredAt)}` : ' · freiwilliges Konto noch nicht angelegt'}.`;
    $('[name="displayName"]', pref).value = user.displayName || '';
    $('[data-reminders]', pref).checked = Boolean(user.reminders);
    const hasAccount = user.registeredAt != null;
    $('[data-account-registration]', root).hidden = hasAccount;
    pref.hidden = !hasAccount;
    $('[data-account-trainer-link]', root).hidden = !me.role;
    $('[data-reminder-consent]', root).hidden = true;
    const transferNode = $('[data-owner-transfer]', root);
    try {
      const { transfer } = await api('/api/v1/account/owner-transfer');
      if (transfer) {
        transferNode.hidden = false;
        $('[data-owner-transfer-text]', transferNode).textContent =
          `${transfer.ownerName} möchte dir die Owner-Rolle übertragen. Die Übertragung wird erst nach deiner Bestätigung wirksam.`;
        transferNode.dataset.transferId = transfer.id;
      }
    } catch {
      /* non-owner or no pending transfer */
    }
    $('[data-account-registration]', root).addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setBusy(form, true);
      clearError(errorNode);
      try {
        await post('/api/v1/account/register', { consent: bool(form, 'consent') });
        location.reload();
      } catch (error) {
        showError(errorNode, error);
      } finally {
        setBusy(form, false);
      }
    });
    $('[data-reminders]', pref).addEventListener('change', (event) => {
      $('[data-reminder-consent]', root).hidden = !event.currentTarget.checked || user.reminders;
    });
    pref.addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(pref, true);
      clearError(errorNode);
      const feedback = $('[data-preferences-feedback]', root);
      try {
        const wantsReminder = bool(pref, 'reminders');
        const result = await patch('/api/v1/account/preferences', {
          displayName: $('[name="displayName"]', pref).value.trim(),
          reminders: wantsReminder,
          ...(wantsReminder && !user.reminders ? { reminderConsent: true } : {}),
        });
        user.displayName = result.user?.displayName || user.displayName;
        user.reminders = Boolean(result.user?.reminders);
        $('[data-account-name]', root).textContent = user.displayName;
        feedback.textContent = 'Deine Einstellungen wurden gespeichert.';
      } catch (error) {
        showError(errorNode, error);
      } finally {
        setBusy(pref, false);
      }
    });
    root.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      clearError(errorNode);
      try {
        if (action === 'logout') {
          await post('/api/v1/auth/logout');
          location.assign('/');
        }
        if (action === 'export') {
          const result = await api('/api/v1/account/data');
          const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = 'tt-kontodaten.json';
          link.click();
          URL.revokeObjectURL(link.href);
        }
        if (action === 'delete') {
          if ($('[data-delete-confirm]', root).value !== 'DELETE')
            throw userError('Bitte gib zur Bestätigung exakt DELETE ein.');
          if (
            !(await confirmAction({
              title: 'TT-Konto löschen?',
              description:
                'Dein TT-Konto und die dazu gespeicherten Daten werden endgültig gelöscht. Dieser Schritt lässt sich nicht rückgängig machen.',
              label: 'Endgültig löschen',
              danger: true,
            }))
          )
            return;
          await post('/api/v1/account/delete', { confirm: 'DELETE' });
          location.assign('/');
        }
        if (action === 'transfer-accept' || action === 'transfer-reject') {
          if (
            !(await confirmAction({
              title:
                action === 'transfer-accept'
                  ? 'Verantwortung übernehmen?'
                  : 'Übertragung ablehnen?',
              description: $('[data-owner-transfer-text]', transferNode).textContent,
              label: action === 'transfer-accept' ? 'Übertragung annehmen' : 'Ablehnen',
            }))
          )
            return;
          const id = transferNode.dataset.transferId;
          await post(
            `/api/v1/account/owner-transfer/${encodeURIComponent(id)}/${action === 'transfer-accept' ? 'accept' : 'reject'}`,
            { confirm: true },
          );
          location.assign('/trainer');
        }
      } catch (error) {
        showError(errorNode, error);
      }
    });
  }

  async function initTrainer(root) {
    const errorNode = $('[data-trainer-error]', root);
    const views = $$('[data-view-panel]', root);
    let overview;
    let attendanceSession = null;
    let attendanceData = null;
    let attendanceFilter = 'all';
    let attendanceQuery = '';
    let attendanceReturn = 'overview';
    let currentView = 'overview';
    let renderGeneration = 0;
    const timeLabel = (value) =>
      new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Berlin',
      }).format(new Date(value));
    const dayLabel = (value) =>
      new Intl.DateTimeFormat('de-DE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/Berlin',
      }).format(new Date(value));
    const nextSessions = () =>
      (overview.sessions || [])
        .filter(
          (item) => item.status === 'scheduled' && new Date(item.endAt).getTime() > Date.now(),
        )
        .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    const openEditor = (name) => {
      const dialog = $('[data-editor="' + name + '"]', root);
      if (!dialog) return;
      $$('[data-dialog-error]', dialog).forEach(clearError);
      if (name === 'session') {
        const form = $('form', dialog);
        const series = (overview.series || []).find((item) => item.active);
        if (!form.elements.date.value)
          form.elements.date.value = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Berlin',
          }).format(new Date());
        if (!form.elements.startTime.value)
          form.elements.startTime.value = series?.startTime || '18:00';
        if (!form.elements.endTime.value) form.elements.endTime.value = series?.endTime || '20:00';
        if (!form.elements.location.value) form.elements.location.value = series?.location || '';
      }
      if (name === 'series' && !dialog.open) {
        const form = $('form', dialog);
        form.reset();
        form.elements.seriesId.value = '';
        form.elements.version.value = '';
        form.elements.groupJid.disabled = false;
        $('[data-series-form-kicker]', form).textContent = 'NEUE SERIE';
        $('[data-series-form-title]', form).textContent = 'Wiederkehrendes Training';
        fillGroups();
      }
      dialog.showModal();
      $('input:not([type="hidden"]), select', dialog)?.focus();
    };
    const feedback = $('[data-trainer-feedback]', root);
    let feedbackTimer;
    const notify = (value) => {
      clearTimeout(feedbackTimer);
      feedback.textContent = value;
      feedback.hidden = false;
      feedbackTimer = setTimeout(() => {
        feedback.hidden = true;
      }, 6500);
    };
    const switchView = (name, focus = false) => {
      if (
        !views.some((panel) => panel.dataset.viewPanel === name) ||
        (name === 'admins' && !root.dataset.owner)
      )
        return;
      views.forEach((panel) => {
        panel.hidden = panel.dataset.viewPanel !== name;
      });
      $$('.trainer-nav [data-view]', root).forEach((item) => {
        const active = item.dataset.view === name;
        item.setAttribute('aria-pressed', String(active));
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
        if (focus && active) item.focus();
      });
      currentView = name;
      const activeNav = ['series', 'attendance'].includes(name)
        ? name === 'attendance' && attendanceReturn === 'overview'
          ? 'overview'
          : 'sessions'
        : ['settings', 'admins'].includes(name)
          ? 'more'
          : name;
      $$('.trainer-nav [data-view]', root).forEach((item) => {
        const active = item.dataset.view === activeNav;
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
      });
      $('[data-workspace-title]', root).textContent =
        {
          overview: 'Alles im Blick.',
          sessions: 'Dein Trainingsplan.',
          series: 'Woche für Woche.',
          requests: 'Eure Runde.',
          more: 'Dein TT.',
          settings: 'So läuft’s bei euch.',
          admins: 'Dein Trainerteam.',
          attendance: 'Wer ist dabei?',
        }[name] || 'Dein TT.';
      history.replaceState(null, '', '#' + (name === 'attendance' ? attendanceReturn : name));
      if (name === 'requests') loadRequests();
      if (name === 'admins') loadAdmins();
    };
    const groupName = (jid) =>
      overview?.groups?.find((group) => group.jid === jid)?.name ||
      jid ||
      'Gruppe nicht ausgewählt';
    const fillGroups = () =>
      $$('[data-group-select]', root).forEach((select) => {
        const current = select.value;
        select.replaceChildren(new Option('Gruppe auswählen', ''));
        (overview?.groups || [])
          .filter((group) => group.active)
          .forEach((group) => select.add(new Option(group.name, group.jid)));
        const active = (overview?.groups || []).filter((group) => group.active);
        select.value =
          current ||
          overview?.settings?.selectedGroup ||
          (active.length === 1 ? active[0].jid : '');
      });
    const load = async () => {
      clearError(errorNode);
      const me = await api('/api/v1/me');
      updateNavigation(me);
      if (!['owner', 'admin'].includes(me.role)) {
        location.replace('/konto');
        return;
      }
      $('[data-trainer-identity]', root).textContent =
        `${me.user?.displayName || 'Trainer'} · ${me.role === 'owner' ? 'Verantwortlicher Trainer' : 'Trainer'}`;
      root.dataset.owner = me.role === 'owner' ? 'true' : '';
      $$('[data-owner-only]', root).forEach((node) => {
        node.hidden =
          me.role !== 'owner' ||
          (node.dataset.viewPanel && node.dataset.viewPanel !== location.hash.slice(1));
      });
      overview = await api(route('/overview'));
      renderOverview();
      fillGroups();
      renderSeries();
      await renderSessions();
      renderSettings();
      root.setAttribute('aria-busy', 'false');
      return me;
    };
    const renderOverview = () => {
      const enabled = Boolean(overview.settings?.enabled);
      const banner = $('[data-run-state]', root);
      banner.classList.toggle('is-active', enabled);
      banner.classList.toggle('is-paused', !enabled);
      $('[data-run-label]', root).textContent = enabled
        ? 'Automatische Nachrichten aktiv'
        : 'Automatische Nachrichten pausiert';
      $('[data-run-description]', root).textContent = enabled
        ? 'TT erinnert eure Runde an die geplanten Trainings.'
        : 'Dein Plan steht. Automatische Trainingsnachrichten werden erst nach Aktivierung versendet.';
      $('[data-trainer-status]', root).textContent = overview.settings?.privacyReady
        ? 'Datenschutzhinweise hinterlegt'
        : 'Datenschutzhinweise fehlen';
      const activeGroups = (overview.groups || []).filter((group) => group.active);
      const setup = $('[data-setup-note]', root);
      setup.hidden = Boolean(activeGroups.length && overview.settings?.privacyReady);
      $('[data-setup-copy]', root).textContent = !activeGroups.length
        ? 'Verbinde zuerst eine Trainingsgruppe. Danach kannst du Termine planen.'
        : 'Deine Gruppe ist verbunden. Hinterlege die Datenschutzhinweise, um Trainingsnachrichten zu aktivieren.';
      const setupAction = $('[data-setup-action]', root);
      setupAction.dataset.view = activeGroups.length ? 'settings' : 'requests';
      setupAction.textContent = activeGroups.length ? 'Hinweise hinterlegen' : 'Gruppe verbinden';
      const toggle = $('[data-activation-title]', root);
      if (toggle)
        toggle.textContent = enabled
          ? 'Trainingsnachrichten sind aktiv'
          : 'Trainingsnachrichten sind pausiert';
      $('[data-activation-description]', root).textContent = enabled
        ? 'Du kannst den Nachrichtenbetrieb jederzeit pausieren. Der Trainingsplan bleibt erhalten.'
        : !overview.settings.privacyReady
          ? 'Speichere und bestätige zuerst die Datenschutzhinweise oben. Danach kannst du die Trainingsnachrichten aktivieren.'
          : 'Die Aktivierung erfolgt erst nach deiner ausdrücklichen Bestätigung.';
      $('[data-activation-button]', root).textContent = enabled
        ? 'Trainingsnachrichten pausieren'
        : 'Trainingsnachrichten aktivieren';
      const activationConsent = $('[name="confirm"]', $('[data-form="activation"]', root));
      activationConsent.closest('label').hidden = enabled;
      activationConsent.required = !enabled;
      activationConsent.checked = false;
      const delivery = $('[data-delivery-summary]', root);
      delivery.replaceChildren();
      const counts = overview.delivery?.counts || { pending: 0, failed: 0, uncertain: 0 };
      $('[data-delivery-teaser]', root).textContent =
        counts.failed || counts.uncertain
          ? (counts.failed || 0) + ' fehlgeschlagen · ' + (counts.uncertain || 0) + ' ungeklärt'
          : counts.pending
            ? counts.pending + ' Nachrichten ausstehend'
            : enabled
              ? 'Geplante Nachrichten ansehen'
              : 'Automatik pausiert · Zeitplan ansehen';
      const summary = text(
        'p',
        `Versandstatus · ${counts.pending || 0} ausstehend · ${counts.failed || 0} fehlgeschlagen · ${counts.uncertain || 0} ungeklärt`,
        'delivery-counts',
      );
      delivery.append(summary);
      if (overview.delivery?.lastCron)
        delivery.append(
          text(
            'p',
            `Letzte Aufgabenprüfung: ${dateLabel(overview.delivery.lastCron, true)}`,
            'form-hint',
          ),
        );
      const timeline = document.createElement('ol');
      timeline.className = 'delivery-timeline';
      (overview.delivery?.nextMessages || []).slice(0, 6).forEach((item) => {
        const li = document.createElement('li');
        li.append(text('strong', deliveryKindLabel(item.kind)));
        li.append(
          text('span', `${dateLabel(item.dueAt, true)} · ${deliveryStatusLabel(item.status)}`),
        );
        timeline.append(li);
      });
      if (!timeline.children.length)
        timeline.append(text('li', 'Keine anstehenden Nachrichten geplant.'));
      delivery.append(timeline);
    };
    const renderCountGrid = (data, sessionId, compact = false) => {
      const grid = text('div', '', 'response-grid' + (compact ? ' is-compact' : ''));
      [
        ['yes', 'Zusagen', 'yes'],
        ['no', 'Absagen', 'no'],
        ['late', 'Verspätet', 'late'],
        ['unanswered', 'Offen', 'unknown'],
      ].forEach(([key, label, filter]) => {
        const item = button(
          '',
          'attendance:' + sessionId + ':' + filter,
          'response-stat response-' + key,
        );
        item.append(text('strong', data.counts?.[key] ?? '–'), text('span', label));
        item.setAttribute('aria-label', (data.counts?.[key] ?? 0) + ' ' + label + ' ansehen');
        grid.append(item);
      });
      return grid;
    };
    const renderSessions = async () => {
      const generation = ++renderGeneration;
      const sessions = nextSessions();
      const renderList = (node, items, compact = false) => {
        node.replaceChildren();
        if (!items.length) {
          const empty = text('div', '', 'empty-state' + (compact ? ' empty-compact' : ''));
          empty.append(
            text(
              'strong',
              compact ? 'Platz für die nächste Runde.' : 'Euer Trainingsplan beginnt hier.',
            ),
            text(
              'p',
              compact
                ? 'Weitere Termine findest du hier, sobald sie geplant sind.'
                : 'Lege ein Training an oder richte einen festen wöchentlichen Termin ein.',
            ),
          );
          if (!compact)
            empty.append(
              button('＋ Erstes Training planen', 'create:session', 'button button-dark'),
            );
          node.append(empty);
          return;
        }
        items.forEach((session) => {
          const card = compact
            ? button('', 'attendance:' + session.id, 'session-card compact')
            : text('article', '', 'session-card');
          const date = new Date(session.startAt);
          const stamp = text(compact ? 'span' : 'div', '', 'date-stamp');
          stamp.append(
            text(
              'span',
              new Intl.DateTimeFormat('de-DE', {
                month: 'short',
                timeZone: 'Europe/Berlin',
              }).format(date),
            ),
            text(
              'strong',
              new Intl.DateTimeFormat('de-DE', {
                day: '2-digit',
                timeZone: 'Europe/Berlin',
              }).format(date),
            ),
          );
          const copy = text(compact ? 'span' : 'div', '', 'session-copy');
          copy.append(
            text(
              compact ? 'strong' : 'h3',
              new Intl.DateTimeFormat('de-DE', {
                weekday: 'long',
                timeZone: 'Europe/Berlin',
              }).format(date) +
                ', ' +
                timeLabel(session.startAt),
              'session-title',
            ),
            text(compact ? 'span' : 'p', groupName(session.groupJid), 'session-group'),
            text(
              'span',
              session.location + ' · bis ' + timeLabel(session.endAt),
              'session-location',
            ),
          );
          card.append(stamp, copy);
          if (compact) {
            const affordance = text('span', '', 'session-affordance');
            affordance.setAttribute('aria-hidden', 'true');
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('fill', 'none');
            icon.setAttribute('stroke', 'currentColor');
            icon.setAttribute('stroke-width', '1.7');
            icon.setAttribute('stroke-linecap', 'round');
            icon.setAttribute('stroke-linejoin', 'round');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M5 12h14m-5-5 5 5-5 5');
            icon.append(path);
            affordance.append(icon);
            card.append(affordance);
            card.setAttribute(
              'aria-label',
              `${groupName(session.groupJid)}, ${dateLabel(session.startAt, true)}: Rückmeldungen ansehen`,
            );
            node.append(card);
            return;
          }
          const actions = text('div', '', 'session-actions');
          actions.append(
            button(
              compact ? 'Ansehen →' : 'Rückmeldungen →',
              'attendance:' + session.id,
              'button button-outline',
            ),
          );
          if (!compact) {
            const more = text('details', '', 'session-more');
            more.append(text('summary', 'Ändern', 'text-button'));
            const options = text('div', '', 'session-options');
            options.append(
              button('Verschieben', 'move:' + session.id),
              button('Absagen', 'cancel:' + session.id, 'button button-danger'),
            );
            more.append(options);
            actions.append(more);
          }
          card.append(actions);
          node.append(card);
        });
      };
      renderList($('[data-sessions-list]', root), sessions.slice(1, 3), true);
      renderList($('[data-sessions-list-secondary]', root), sessions);
      const hero = $('[data-next-training]', root);
      hero.replaceChildren();
      const next = sessions[0];
      if (!next) {
        hero.classList.add('is-empty');
        hero.append(
          text('span', 'DEIN NÄCHSTES TRAINING', 'card-kicker'),
          text('h2', 'Zeit für die nächste Runde.'),
          text(
            'p',
            'Verbinde eure Gruppe und plane das erste Training. Zusagen und Absagen laufen hier zusammen.',
          ),
        );
        const actions = text('div', '', 'form-actions');
        actions.append(button('＋ Training planen', 'create:session', 'button button-dark'));
        const series = button('Wöchentliche Serie', 'create:series');
        actions.append(series);
        hero.append(actions);
      } else {
        hero.classList.remove('is-empty');
        const head = text('div', '', 'next-training-head');
        head.append(
          text(
            'span',
            new Date(next.startAt).getTime() <= Date.now()
              ? 'TRAINING LÄUFT'
              : 'DEIN NÄCHSTES TRAINING',
            'card-kicker',
          ),
          text('span', groupName(next.groupJid), 'group-pill'),
        );
        hero.append(head);
        hero.append(
          text('h2', dayLabel(next.startAt)),
          text('p', timeLabel(next.startAt) + ' – ' + timeLabel(next.endAt), 'next-time'),
          text('p', next.location || 'Ort folgt', 'next-location'),
        );
        const responses = text('div', '', 'next-responses');
        responses.append(text('p', 'Rückmeldungen werden geladen …', 'form-hint'));
        hero.append(responses);
        const actions = text('div', '', 'next-actions');
        actions.append(
          button('Rückmeldungen verwalten →', 'attendance:' + next.id, 'button button-dark'),
          button('Termin ändern', 'move:' + next.id, 'button button-outline'),
        );
        hero.append(actions);
        api(route('/sessions/' + encodeURIComponent(next.id) + '/attendance'))
          .then((data) => {
            if (generation !== renderGeneration) return;
            responses.replaceChildren(renderCountGrid(data, next.id));
            const notes = text('div', '', 'response-notes');
            [
              [
                'Verspätet',
                (p) => !p.needsConfirmation && p.response !== 'no' && p.punctuality === 'late',
              ],
              ['Absagen', (p) => !p.needsConfirmation && p.response === 'no'],
            ].forEach(([label, match]) => {
              const people = (data.participants || []).filter(match);
              if (!people.length) return;
              const line = text('p', '');
              line.append(
                text('strong', label + ': '),
                document.createTextNode(
                  people
                    .map(
                      (p) =>
                        p.name +
                        (label === 'Verspätet' && p.minutes ? ' (' + p.minutes + ' Min.)' : ''),
                    )
                    .join(', '),
                ),
              );
              notes.append(line);
            });
            if (notes.children.length) responses.append(notes);
            responses.append(
              text(
                'p',
                data.counts?.total
                  ? data.counts.total +
                      ' Gruppenmitglieder · Verspätungen können in Zusagen enthalten sein.'
                  : 'Noch keine Gruppenmitglieder verfügbar. Aktualisiere die Gruppe in den Einstellungen.',
                'response-footnote',
              ),
            );
          })
          .catch((error) => {
            if (generation === renderGeneration) {
              responses.replaceChildren(
                text('p', 'Rückmeldungen konnten nicht geladen werden.', 'form-hint'),
                button('Erneut laden', 'refresh', 'button button-outline'),
              );
            }
          });
      }
      const exceptionList = $('[data-exception-list]', root);
      exceptionList.replaceChildren();
      const exceptions = overview.exceptions || [];
      if (!exceptions.length)
        exceptionList.append(
          text('p', 'Keine Pausen oder Ausnahmen im Trainingsplan.', 'empty-copy'),
        );
      exceptions.forEach((exception) => {
        const card = document.createElement('article');
        card.className = 'exception-card';
        card.append(
          text(
            'p',
            groupName(
              overview.series?.find((series) => series.id === exception.seriesId)?.groupJid,
            ),
            'card-kicker',
          ),
        );
        card.append(
          text(
            'strong',
            `${dateLabel(`${exception.fromDate}T12:00:00`)} bis ${dateLabel(`${exception.toDate}T12:00:00`)}`,
          ),
        );
        card.append(text('span', exception.kind === 'pause' ? 'Trainingspause' : 'Ausnahme'));
        card.append(
          button('Pause entfernen', `delete-exception:${exception.id}`, 'button button-outline'),
        );
        exceptionList.append(card);
      });
    };
    const renderSeries = () => {
      const list = $('[data-series-list]', root);
      list.replaceChildren();
      const items = overview.series || [];
      if (!items.length) {
        list.append(text('p', 'Noch keine Trainingsserien eingerichtet.', 'empty-copy'));
        return;
      }
      items.forEach((series) => {
        const card = document.createElement('article');
        card.className = 'series-card';
        card.append(text('p', series.active ? 'Aktiv' : 'Beendet', 'card-kicker'));
        card.append(text('h3', groupName(series.groupJid)));
        card.append(
          text(
            'p',
            `${['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][series.weekday - 1] || ''} · ${series.startTime}–${series.endTime}`,
          ),
        );
        card.append(
          text(
            'p',
            `${series.location || 'Ort folgt'} · Einladung ${series.reminderTime} · Verspätungsinfo ${series.lateOffset} Min. vor Beginn`,
          ),
        );
        const actions = document.createElement('div');
        actions.className = 'form-actions';
        if (series.active) actions.append(button('Bearbeiten', `edit-series:${series.id}`));
        if (series.active)
          actions.append(
            button('Serie beenden', `end-series:${series.id}`, 'button button-danger'),
          );
        card.append(actions);
        list.append(card);
      });
    };
    const renderSettings = () => {
      $('[name="infoText"]', root).value = overview.settings?.infoText || '';
      $('[name="privacyText"]', root).value = overview.settings?.privacyText || '';
      $('[data-privacy-state]', root).textContent = overview.settings?.privacyReady
        ? 'Hinweise sind hinterlegt.'
        : 'Vor dem Start müssen vollständige Datenschutzhinweise hinterlegt werden.';
      const preference = overview.userPreference || {};
      const form = $('[data-form="summary-preference"]', root);
      $('[name="enabled"]', form).checked = Boolean(preference.enabled);
      $('[name="offsetMinutes"]', form).value = String(preference.offsetMinutes ?? 10);
      ['includeAbsent', 'includeLate', 'includeCounts'].forEach((key) => {
        $('[name="' + key + '"]', form).checked = preference[key] !== false;
      });
      $('[name="version"]', form).value = String(preference.version ?? 0);
    };
    const participantStatus = (participant) =>
      participant.needsConfirmation
        ? 'Erneut bestätigen'
        : participant.response === 'no'
          ? 'Abgesagt'
          : participant.punctuality === 'late'
            ? 'Verspätet' + (participant.minutes ? ' · ' + participant.minutes + ' Min.' : '')
            : participant.response === 'yes'
              ? 'Dabei' + (participant.punctuality === 'punctual' ? ' · pünktlich' : '')
              : 'Noch offen';
    const matchesFilter = (participant) =>
      attendanceFilter === 'all' ||
      (attendanceFilter === 'unknown'
        ? participant.needsConfirmation || participant.response === 'unknown'
        : !participant.needsConfirmation &&
          (attendanceFilter === 'late'
            ? participant.response !== 'no' && participant.punctuality === 'late'
            : participant.response === attendanceFilter));
    const renderParticipantList = () => {
      const list = $('[data-participant-list]', root);
      if (!list || !attendanceData) return;
      list.replaceChildren();
      const participants = (attendanceData.participants || []).filter(
        (p) =>
          matchesFilter(p) &&
          p.name.toLocaleLowerCase('de').includes(attendanceQuery.toLocaleLowerCase('de')),
      );
      $('[data-participant-result]', root).textContent =
        participants.length + ' ' + (participants.length === 1 ? 'Person' : 'Personen');
      if (!participants.length) {
        list.append(
          text(
            'p',
            attendanceData.participants?.length
              ? 'Keine Personen für diese Auswahl.'
              : 'Noch keine Gruppenmitglieder verfügbar. Aktualisiere die Gruppe in den Einstellungen.',
            'empty-copy',
          ),
        );
        return;
      }
      participants.forEach((participant) => {
        const row = text('article', '', 'participant-row');
        const avatar = text(
          'span',
          participant.name
            .split(/\s+/)
            .filter(Boolean)
            .map((x) => x[0])
            .slice(0, 2)
            .join('')
            .toUpperCase(),
          'participant-avatar',
        );
        const copy = text('div', '', 'participant-copy');
        copy.append(
          text('strong', participant.name),
          text('span', participantStatus(participant), 'participant-status'),
        );
        row.append(avatar, copy);
        const edit = text('details', '', 'participant-edit');
        const summary = text('summary', 'Ändern', 'text-button');
        summary.setAttribute('aria-label', participant.name + ': Rückmeldung ändern');
        edit.append(summary);
        const controls = text('div', '', 'participant-controls');
        [
          ['yes', 'Dabei'],
          ['no', 'Absage'],
          ['late', 'Verspätet'],
          ['punctual', 'Pünktlich'],
          ['unknown', 'Offen'],
        ].forEach(([value, label]) => {
          const control = button(
            label,
            'attendance-set:' + attendanceData.session.id + ':' + participant.userId + ':' + value,
            'button button-outline',
          );
          const selected =
            !participant.needsConfirmation &&
            (value === 'unknown'
              ? participant.response === 'unknown' && participant.punctuality === 'unknown'
              : participant.response === value || participant.punctuality === value);
          control.setAttribute('aria-pressed', String(selected));
          control.setAttribute('aria-label', participant.name + ': ' + label);
          controls.append(control);
        });
        edit.append(controls);
        row.append(edit);
        list.append(row);
      });
    };
    const renderAttendance = (data, container) => {
      attendanceData = data;
      container.replaceChildren();
      const session = data.session;
      const header = text('div', '', 'attendance-heading');
      const heading = text('h2', dayLabel(session.startAt));
      heading.id = 'attendance-title';
      heading.tabIndex = -1;
      header.append(
        text('p', groupName(session.groupJid), 'card-kicker'),
        heading,
        text(
          'p',
          timeLabel(session.startAt) +
            ' – ' +
            timeLabel(session.endAt) +
            ' · ' +
            (session.location || 'Ort folgt'),
          'view-lead',
        ),
      );
      container.append(header, renderCountGrid(data, session.id, true));
      const toolbar = text('div', '', 'attendance-toolbar');
      const label = text('label', 'Namen suchen', 'search-label');
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = 'Name suchen …';
      search.dataset.participantSearch = '';
      search.value = attendanceQuery;
      label.append(search);
      toolbar.append(label);
      const filters = text('div', '', 'attendance-filters');
      filters.setAttribute('aria-label', 'Rückmeldungen filtern');
      [
        ['all', 'Alle'],
        ['yes', 'Dabei'],
        ['no', 'Absagen'],
        ['late', 'Später'],
        ['unknown', 'Offen'],
      ].forEach(([value, label]) => {
        const b = button(label, 'filter:' + value, 'filter-chip');
        b.setAttribute('aria-pressed', String(attendanceFilter === value));
        filters.append(b);
      });
      toolbar.append(filters);
      container.append(toolbar);
      const count = text('p', '', 'form-hint');
      count.dataset.participantResult = '';
      container.append(count);
      const list = text('div', '', 'participant-list');
      list.dataset.participantList = '';
      container.append(list);
      renderParticipantList();
    };
    const loadRequests = async () => {
      const list = $('[data-request-list]', root);
      list.replaceChildren(text('p', 'Gruppenanfragen werden geladen …', 'empty-copy'));
      try {
        const { requests = [] } = await api(route('/group-requests'));
        const pending = requests.filter((item) =>
          ['pending', 'uncertain', 'joining'].includes(item.status),
        ).length;
        $('[data-request-count]', root).textContent = pending ? String(pending) : '';
        $('[data-request-count]', root).hidden = !pending;
        list.replaceChildren();
        if (!requests.length)
          list.append(text('p', 'Keine offenen Gruppenanfragen.', 'empty-copy'));
        requests
          .sort(
            (a, b) =>
              (['pending', 'uncertain', 'joining'].includes(b.status) ? 1 : 0) -
              (['pending', 'uncertain', 'joining'].includes(a.status) ? 1 : 0),
          )
          .forEach((request) => {
            const card = document.createElement('article');
            card.className = 'request-card';
            card.append(
              text(
                'p',
                request.status === 'uncertain'
                  ? 'Beitritt ungeklärt'
                  : request.status === 'pending'
                    ? 'Prüfung erforderlich'
                    : request.status === 'joining'
                      ? 'Beitritt läuft'
                      : request.status === 'approved'
                        ? 'Freigegeben'
                        : 'Abgelehnt',
                'card-kicker',
              ),
            );
            card.append(text('h3', request.subject || request.requesterName || 'Gruppenanfrage'));
            card.append(
              text(
                'p',
                `${request.source === 'link' ? 'Per Einladungslink geprüft' : 'Bot direkt in WhatsApp hinzugefügt'} · ${dateLabel(request.requestedAt, true)}`,
              ),
            );
            if (request.status === 'pending')
              card.append(
                text(
                  'p',
                  request.source === 'link'
                    ? 'Der Gruppenname wurde geprüft. Mit deiner Freigabe tritt TT bei und sendet eine Begrüßung.'
                    : 'TT ist bereits in der Gruppe. Mit deiner Freigabe wird sie verbunden und erhält eine Begrüßung.',
                  'form-hint',
                ),
              );
            if (request.status === 'approved')
              card.append(
                text(
                  'p',
                  'Gruppe verbunden. Die Begrüßung wurde zum Versand vorgemerkt. Automatische Trainingsnachrichten steuerst du separat unter Einstellungen.',
                  'form-hint',
                ),
              );
            if (request.error)
              card.append(text('p', message(new Error(request.error)), 'request-error'));
            const actions = document.createElement('div');
            actions.className = 'form-actions';
            if (request.status === 'pending') {
              actions.append(
                button(
                  'Freigeben und begrüßen',
                  `approve-request:${request.id}`,
                  'button button-dark',
                ),
              );
              actions.append(
                button('Ablehnen', `reject-request:${request.id}`, 'button button-danger'),
              );
            }
            if (request.status === 'uncertain')
              actions.append(
                button(
                  'Mitgliedschaft abgleichen',
                  `reconcile-request:${request.id}`,
                  'button button-outline',
                ),
              );
            card.append(actions);
            list.append(card);
          });
      } catch (error) {
        list.replaceChildren(text('p', message(error), 'auth-error'));
      }
    };
    const loadAdmins = async () => {
      const list = $('[data-admin-list]', root);
      list.replaceChildren(text('p', 'Trainerzugänge werden geladen …', 'empty-copy'));
      try {
        const data = await api(route('/admins'));
        list.replaceChildren();
        const select = $('[data-eligible-select]', root);
        select.replaceChildren(new Option('Person auswählen', ''));
        (data.eligible || []).forEach((person) =>
          select.add(new Option(`${person.displayName} · ${person.accountHint}`, person.id)),
        );
        (data.admins || []).forEach((admin) => {
          const row = document.createElement('article');
          row.className = 'admin-card';
          row.append(text('h3', admin.displayName));
          row.append(
            text(
              'p',
              `${admin.accountHint} · ${admin.role === 'owner' ? 'Owner' : 'Trainer-Admin'}`,
            ),
          );
          if (admin.role === 'admin')
            row.append(
              button('Zugang entfernen', `remove-admin:${admin.id}`, 'button button-danger'),
            );
          list.append(row);
        });
        const transfer = $('[data-owner-transfer-admin]', root);
        transfer.replaceChildren();
        transfer.hidden = true;
        if (data.pendingTransfer) {
          transfer.hidden = false;
          transfer.append(
            text(
              'p',
              `Offene Übertragung an ${data.pendingTransfer.candidateName}. Sie wird erst mit deren Bestätigung wirksam.`,
            ),
          );
        }
      } catch (error) {
        list.replaceChildren(text('p', message(error), 'auth-error'));
      }
    };
    const refresh = async () => {
      await load();
      if (currentView === 'attendance' && attendanceSession) {
        renderAttendance(
          await api(route(`/sessions/${encodeURIComponent(attendanceSession)}/attendance`)),
          $('[data-attendance-panel]', root),
        );
      }
    };
    $('.trainer-nav', root).addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = $$('.trainer-nav [data-view]', root).filter((tab) => !tab.hidden);
      const index = tabs.indexOf(event.target);
      if (index < 0) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      switchView(tabs[next].dataset.view, true);
    });
    try {
      await load();
      switchView(location.hash.slice(1) || 'overview');
      if (location.hash !== '#requests') loadRequests();
    } catch (error) {
      root.setAttribute('aria-busy', 'false');
      showError(errorNode, error);
    }

    root.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-view], [data-action]');
      if (!target) return;
      if (target.dataset.view) {
        switchView(target.dataset.view);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
      }
      const action = target.dataset.action;
      if (!overview && action !== 'refresh') {
        showError(
          errorNode,
          userError(
            'Die Trainingsdaten konnten noch nicht geladen werden. Klicke auf Aktualisieren.',
          ),
        );
        return;
      }
      target.disabled = true;
      try {
        if (action === 'settings-shortcut') {
          event.preventDefault();
          switchView('settings');
          return;
        }
        if (action === 'refresh') {
          try {
            await refresh();
          } catch (error) {
            showError(errorNode, error);
          }
        }
        if (action === 'close-move') {
          $('[data-move-dialog]', root).close();
          return;
        }
        if (action === 'refresh-groups') {
          try {
            const result = await post(route('/groups/refresh'));
            overview.groups = result.groups || [];
            fillGroups();
          } catch (error) {
            showError(errorNode, error);
          }
        }
        if (action === 'select-group') {
          try {
            const jid = $('[data-group-select]#selected-group', root).value;
            if (!jid) throw userError('Bitte wähle zuerst eine Gruppe aus.');
            await post(route('/groups/select'), { jid, confirm: true });
            await refresh();
          } catch (error) {
            showError(errorNode, error);
          }
        }
        if (action === 'load-requests') loadRequests();
        if (action === 'load-admins') loadAdmins();
        if (action === 'close-editor') {
          target.closest('dialog').close();
          return;
        }
        if (action.startsWith('create:')) {
          openEditor(action.slice(7));
          return;
        }
        if (action === 'summary-shortcut') {
          switchView('settings');
          const disclosure = $('details[data-create="summary"]', root);
          disclosure.open = true;
          disclosure.scrollIntoView({ block: 'start' });
          return;
        }
        if (action === 'attendance-back') {
          switchView(attendanceReturn);
          return;
        }
        if (action.startsWith('filter:')) {
          attendanceFilter = action.slice(7);
          $$('.filter-chip', root).forEach((item) =>
            item.setAttribute(
              'aria-pressed',
              String(item.dataset.action === 'filter:' + attendanceFilter),
            ),
          );
          renderParticipantList();
          return;
        }
        if (action.startsWith('attendance:')) {
          const [, id, filter] = action.split(':');
          if (currentView !== 'attendance')
            attendanceReturn = currentView === 'overview' ? 'overview' : 'sessions';
          attendanceSession = id;
          attendanceFilter = filter || 'all';
          attendanceQuery = '';
          switchView('attendance');
          const container = $('[data-attendance-panel]', root);
          container.replaceChildren(text('p', 'Rückmeldungen werden geladen …', 'empty-copy'));
          window.scrollTo({ top: 0, behavior: 'instant' });
          try {
            const data = await api(route('/sessions/' + encodeURIComponent(id) + '/attendance'));
            if (attendanceSession !== id) return;
            renderAttendance(data, container);
            $('h2', container).focus({ preventScroll: true });
          } catch (error) {
            container.replaceChildren(
              text('p', message(error), 'auth-error'),
              button('Erneut versuchen', 'attendance:' + id, 'button button-outline'),
            );
          }
        }
        if (action.startsWith('move:')) {
          const id = action.split(':')[1];
          const session = overview.sessions.find((item) => item.id === id);
          const dialog = $('[data-move-dialog]', root);
          const form = $('[data-form="move-session"]', dialog);
          form.elements.sessionId.value = id;
          form.elements.version.value = String(session.version);
          form.elements.date.value = session.date;
          form.elements.startTime.value = new Intl.DateTimeFormat('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Europe/Berlin',
          }).format(new Date(session.startAt));
          dialog.showModal();
        }
        if (action.startsWith('cancel:')) {
          const id = action.split(':')[1];
          const session = overview.sessions.find((item) => item.id === id);
          if (
            !(await confirmAction({
              title: 'Training absagen?',
              description: `${groupName(session.groupJid)} · ${dateLabel(session.startAt, true)}. Die Gruppe erhält eine Absage, wenn Trainingsnachrichten aktiv sind.`,
              label: 'Training absagen',
              danger: true,
            }))
          )
            return;
          try {
            await post(route(`/sessions/${encodeURIComponent(id)}/cancel`), {
              version: session.version,
            });
            await refresh();
            notify('Das Training wurde abgesagt.');
          } catch (error) {
            showError(errorNode, error);
          }
        }
        if (action.startsWith('edit-series:')) {
          const series = overview.series.find(
            (item) => item.id === action.slice('edit-series:'.length),
          );
          if (!series) return;
          const form = $('[data-form="series"]', root);
          form.elements.seriesId.value = series.id;
          form.elements.version.value = String(series.version);
          form.elements.groupJid.disabled = true;
          form.closest('dialog').showModal();
          for (const key of [
            'groupJid',
            'weekday',
            'startTime',
            'endTime',
            'location',
            'reminderTime',
            'lateOffset',
          ])
            form.elements[key].value = series[key];
          $('[data-series-form-kicker]', form).textContent = 'SERIE BEARBEITEN';
          $('[data-series-form-title]', form).textContent = 'Trainingsserie ändern';
          switchView('series');
          form.elements.weekday.focus();
        }
        if (action.startsWith('end-series:')) {
          const id = action.slice('end-series:'.length);
          const series = overview.series.find((item) => item.id === id);
          if (
            !(await confirmAction({
              title: 'Trainingsserie beenden?',
              description: `${groupName(series.groupJid)} · ${series.startTime}–${series.endTime}. Neue Termine werden nicht mehr angelegt. Bereits geplante Termine bleiben bestehen.`,
              label: 'Serie beenden',
              danger: true,
            }))
          )
            return;
          try {
            await post(route(`/series/${encodeURIComponent(id)}/end`), { version: series.version });
            await refresh();
          } catch (error) {
            showError(errorNode, error);
          }
        }
        if (action.startsWith('delete-exception:')) {
          const id = action.slice('delete-exception:'.length);
          const exception = overview.exceptions.find((item) => item.id === id);
          if (
            !exception ||
            !(await confirmAction({
              title: 'Trainingspause entfernen?',
              description: `${dateLabel(`${exception.fromDate}T12:00:00`)} bis ${dateLabel(`${exception.toDate}T12:00:00`)}. Noch bevorstehende Termine dieser Pause können dadurch wieder stattfinden.`,
              label: 'Pause entfernen',
            }))
          )
            return;
          try {
            await del(route(`/exceptions/${encodeURIComponent(id)}`), {
              version: exception.version,
            });
            await refresh();
          } catch (error) {
            showError(errorNode, error);
          }
        }
        if (action.startsWith('attendance-set:')) {
          const [, sessionId, userId, value] = action.split(':');
          try {
            let late = {};
            if (value === 'late') {
              late = await confirmAction({
                title: 'Verspätung eintragen',
                description:
                  'Wie viele Minuten später kommt die Person? Du kannst die genaue Zeit auch offenlassen.',
                label: 'Verspätung speichern',
                minutes: true,
              });
              if (!late) return;
            }
            const data = attendanceData;
            const participant = data.participants.find((item) => item.userId === userId);
            await post(
              route(
                `/sessions/${encodeURIComponent(sessionId)}/attendance/${encodeURIComponent(userId)}`,
              ),
              {
                sessionVersion: data.session.version,
                expectedUpdatedAt: participant.updatedAt,
                response: value,
                ...late,
              },
            );
            renderAttendance(
              await api(route(`/sessions/${encodeURIComponent(sessionId)}/attendance`)),
              $('[data-attendance-panel]', root),
            );
            await renderSessions();
            notify('Rückmeldung gespeichert.');
          } catch (error) {
            showError(errorNode, error);
          }
        }
        if (
          action.startsWith('approve-request:') ||
          action.startsWith('reject-request:') ||
          action.startsWith('reconcile-request:')
        ) {
          const [verb, id] = action.split(':');
          const promptText =
            verb === 'approve-request'
              ? 'TT verbindet die geprüfte Gruppe und sendet einmal eine Begrüßung mit Trainername, Rückmeldehilfe und Trainingslink. Diese Begrüßung wird auch bei pausiertem Trainingsbetrieb gesendet. Automatische Trainingseinladungen bleiben separat einstellbar.'
              : verb === 'reject-request'
                ? 'Diese Gruppenanfrage ablehnen?'
                : 'TT prüft, ob der Beitritt erfolgreich war. Bei bestätigter Mitgliedschaft wird die Gruppe verbunden und ihre einmalige Begrüßung zum Versand vorgemerkt.';
          if (
            !(await confirmAction({
              title:
                verb === 'approve-request'
                  ? 'Gruppe freigeben?'
                  : verb === 'reject-request'
                    ? 'Anfrage ablehnen?'
                    : 'Mitgliedschaft abgleichen?',
              description: promptText,
              label:
                verb === 'approve-request'
                  ? 'Freigeben und begrüßen'
                  : verb === 'reject-request'
                    ? 'Ablehnen'
                    : 'Abgleichen',
              danger: verb === 'reject-request',
            }))
          )
            return;
          try {
            await post(
              route(`/group-requests/${encodeURIComponent(id)}/${verb.replace('-request', '')}`),
              { confirm: true },
            );
            await loadRequests();
            if (verb === 'approve-request' || verb === 'reconcile-request') {
              await refresh();
              notify('Die Gruppe wurde verbunden. Ihre Begrüßung ist zum Versand vorgemerkt.');
            }
          } catch (error) {
            showError(errorNode, error);
          }
        }
        if (action.startsWith('remove-admin:')) {
          const id = action.slice('remove-admin:'.length);
          if (
            !(await confirmAction({
              title: 'Trainerzugang entfernen?',
              description:
                'Diese Person verliert ihren Zugriff auf die Trainingsverwaltung. Ihr freiwilliges Mitgliedskonto bleibt erhalten.',
              label: 'Zugang entfernen',
              danger: true,
            }))
          )
            return;
          try {
            await del(route(`/admins/${encodeURIComponent(id)}`), { confirm: true });
            await loadAdmins();
          } catch (error) {
            showError(errorNode, error);
          }
        }
      } catch (error) {
        showError(errorNode, error);
      } finally {
        target.disabled = false;
      }
    });

    root.addEventListener('input', (event) => {
      if (event.target.matches('[data-participant-search]')) {
        attendanceQuery = event.target.value;
        renderParticipantList();
      }
    });

    root.addEventListener(
      'invalid',
      (event) => {
        const field = event.target;
        const form = field.closest('[data-form]');
        if (!form || form.querySelector(':invalid') !== field) return;
        const label = field.labels?.[0]?.textContent.trim() || 'Eingabe';
        showError(errorNode, userError(`${label}: ${field.validationMessage}`));
      },
      true,
    );
    root.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-form]');
      if (!form) return;
      event.preventDefault();
      if (form.getAttribute('aria-busy') === 'true') return;
      if (!overview) {
        showError(errorNode, userError('Bitte lade die Trainingsdaten zuerst über Aktualisieren.'));
        return;
      }
      clearError(errorNode);
      $$('[data-dialog-error]', root).forEach(clearError);
      setBusy(form, true);
      try {
        const values = formData(form);
        switch (form.dataset.form) {
          case 'single-session':
            await post(route('/sessions'), {
              groupJid: values.groupJid,
              date: values.date,
              startTime: values.startTime,
              endTime: values.endTime,
              location: values.location,
            });
            break;
          case 'pause':
            await post(route('/pauses'), {
              groupJid: values.groupJid,
              fromDate: values.fromDate,
              toDate: values.toDate,
            });
            break;
          case 'series': {
            const id = values.seriesId;
            if (values.endTime <= values.startTime)
              throw userError(
                'Das Ende muss am selben Tag nach dem Beginn liegen. Bitte prüfe beide Uhrzeiten.',
              );
            if (
              !id &&
              overview.series.some(
                (series) =>
                  series.active &&
                  series.groupJid === values.groupJid &&
                  series.weekday === Number(values.weekday) &&
                  series.startTime === values.startTime,
              )
            )
              throw userError(
                'Für diese Gruppe gibt es an diesem Wochentag zur gleichen Uhrzeit bereits eine Serie. Öffne die bestehende Serie über „Bearbeiten“.',
              );
            const data = {
              weekday: Number(values.weekday),
              startTime: values.startTime,
              endTime: values.endTime,
              location: values.location,
              reminderTime: values.reminderTime,
              lateOffset: Number(values.lateOffset),
              ...(id ? { version: Number(values.version) } : { groupJid: values.groupJid }),
            };
            if (id) await patch(route(`/series/${encodeURIComponent(id)}`), data);
            else await post(route('/series'), data);
            form.reset();
            form.elements.seriesId.value = '';
            form.elements.version.value = '';
            form.elements.groupJid.disabled = false;
            $('[data-series-form-kicker]', form).textContent = 'NEUE SERIE';
            $('[data-series-form-title]', form).textContent = 'Wiederkehrendes Training';
            break;
          }
          case 'settings-info':
            await put(route('/settings'), { infoText: values.infoText, confirm: true });
            break;
          case 'settings-privacy':
            await put(route('/settings'), { privacyText: values.privacyText, confirm: true });
            break;
          case 'summary-preference':
            await put(route('/summary-preference'), {
              enabled: bool(form, 'enabled'),
              offsetMinutes: Number(values.offsetMinutes),
              includeAbsent: bool(form, 'includeAbsent'),
              includeLate: bool(form, 'includeLate'),
              includeCounts: bool(form, 'includeCounts'),
              version: Number(values.version),
            });
            break;
          case 'activation':
            if (!overview.settings.enabled && !overview.settings.privacyReady) {
              const privacy = $('[data-create="privacy"]', root);
              privacy.open = true;
              $('#privacy-text', privacy).focus();
              throw userError('Bitte zuerst die Datenschutzhinweise speichern und bestätigen. Danach kannst du hier aktivieren.');
            }
            await put(route('/settings'), { enabled: !overview.settings.enabled, confirm: true });
            break;
          case 'group-request':
            await post(route('/group-requests'), { inviteLink: values.inviteLink });
            form.reset();
            await loadRequests();
            notify('Deine Gruppenanfrage wurde gespeichert.');
            $('[data-request-list]', root).scrollIntoView({ block: 'nearest' });
            return;
          case 'move-session':
            await post(route(`/sessions/${encodeURIComponent(values.sessionId)}/move`), {
              version: Number(values.version),
              date: values.date,
              startTime: values.startTime,
            });
            $('[data-move-dialog]', root).close();
            await refresh();
            notify('Der Trainingstermin wurde verschoben.');
            return;
          case 'admin-role':
            if (
              !(await confirmAction({
                title:
                  values.role === 'owner' ? 'Owner-Rolle übertragen?' : 'Trainerzugang vergeben?',
                description: `${form.elements.userId.selectedOptions[0]?.textContent}. ${values.role === 'owner' ? 'Diese Person erhält eine Anfrage zur Übertragung. Du bleibst Owner, bis sie annimmt.' : 'Diese Person darf Trainings und Gruppeneinstellungen verwalten.'}`,
                label: values.role === 'owner' ? 'Übertragung anfragen' : 'Zugang vergeben',
              }))
            )
              return;
            if (values.role === 'owner')
              await post(route('/admins/transfer'), { userId: values.userId, confirm: true });
            else
              await post(route('/admins'), { userId: values.userId, role: 'admin', confirm: true });
            await loadAdmins();
            notify(
              values.role === 'owner'
                ? 'Die Anfrage zur Owner-Übertragung wurde gespeichert.'
                : 'Der Trainerzugang wurde vergeben.',
            );
            return;
          default:
            return;
        }
        await refresh();
        const notices = {
          'single-session': 'Der Trainingstermin wurde angelegt.',
          pause: 'Die Trainingspause wurde gespeichert.',
          series: 'Die Trainingsserie wurde gespeichert.',
          'settings-info': 'Die Trainingsinformationen sind veröffentlicht.',
          'settings-privacy': 'Die Datenschutzhinweise wurden gespeichert.',
          'summary-preference': 'Deine Trainererinnerung wurde gespeichert.',
          activation: overview.settings.enabled
            ? 'Trainingsnachrichten sind jetzt aktiv.'
            : 'Trainingsnachrichten sind jetzt pausiert.',
        };
        notify(notices[form.dataset.form] || 'Gespeichert.');
        if (['single-session', 'pause', 'series'].includes(form.dataset.form)) {
          form.closest('dialog').close();
          if (form.dataset.form !== 'series') form.reset();
        }
      } catch (error) {
        showError(errorNode, error);
      } finally {
        setBusy(form, false);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const login = $('[data-login]');
    if (login) initLogin(login);
    const account = $('[data-account]');
    if (account) initAccount(account);
    const trainer = $('[data-trainer]');
    if (trainer) initTrainer(trainer);
    if (!trainer && !account && !login)
      api('/api/v1/me')
        .then(updateNavigation)
        .catch(() => {});
  });
})();
