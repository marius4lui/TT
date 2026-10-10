import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, modify, applyEdits } from 'jsonc-parser';

const root = fileURLToPath(new URL('../', import.meta.url));
export class SafeError extends Error {}

export function credentials(env = process.env) {
  let url;
  try {
    url = new URL(env.EVOLUTION_URL);
  } catch {
    throw new SafeError('Gespeicherte HTTPS-URL fehlt oder ist ungültig.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new SafeError('Evolution benötigt eine HTTPS-Basisadresse ohne Zugangsdaten in der URL.');
  if (
    !env.EVOLUTION_INSTANCE?.trim() ||
    env.EVOLUTION_INSTANCE.length > 100 ||
    /[\x00-\x1f\x7f]/.test(env.EVOLUTION_INSTANCE)
  )
    throw new SafeError('Gespeicherter Instanzname ist ungültig.');
  if (!env.EVOLUTION_API_KEY || /[\x00-\x1f\x7f]/.test(env.EVOLUTION_API_KEY))
    throw new SafeError('Gespeicherter API-Key fehlt oder ist ungültig.');
  return {
    url: url.href.replace(/\/$/, ''),
    instance: env.EVOLUTION_INSTANCE,
    key: env.EVOLUTION_API_KEY,
  };
}

export function apiClient(config, fetcher = globalThis.fetch.bind(globalThis)) {
  return async (path, body) => {
    let response;
    try {
      response = await fetcher(`${config.url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { apikey: config.key, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new SafeError(
        'Evolution nicht erreichbar; Schreibausgang möglicherweise unklar. Kein automatischer Wiederholungsversuch.',
      );
    }
    if (!response.ok)
      throw new SafeError(
        `Evolution-Aufruf fehlgeschlagen (HTTP ${response.status}). Keine automatische Wiederholung.`,
      );
    try {
      return await response.json();
    } catch {
      throw new SafeError('Evolution liefert keine gültige JSON-Antwort.');
    }
  };
}

export async function connection(config, api) {
  const instance = encodeURIComponent(config.instance);
  const state = await api(`/instance/connectionState/${instance}`);
  if ((state.instance?.state ?? state.state) !== 'open')
    throw new SafeError('Instanz noch nicht mit WhatsApp verbunden. Zuerst beim Anbieter koppeln.');
  const list = await api(`/instance/fetchInstances?instanceName=${instance}`);
  const own = (Array.isArray(list) ? list : [list])
    .map((item) => item.instance ?? item)
    .find((item) => (item.name ?? item.instanceName) === config.instance);
  const jid = own?.ownerJid ?? own?.owner ?? own?.wuid;
  if (typeof jid !== 'string' || !/^[1-9]\d{6,14}@s\.whatsapp\.net$/.test(jid))
    throw new SafeError('Botnummer nicht eindeutig aus der verbundenen Instanz ermittelbar.');
  return jid;
}

async function run(script, args, exposeOutput = false) {
  const output = await new Promise((res, rej) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    let stdout = '';
    child.stdout.on('data', (part) => {
      stdout += part;
    });
    child.stderr.on('data', () => {});
    child.once('error', () =>
      rej(new SafeError('Lokales Werkzeug konnte nicht gestartet werden.')),
    );
    child.once('close', (code) =>
      code === 0
        ? res(stdout)
        : rej(
            new SafeError(
              'Einrichtung/Deployment fehlgeschlagen. TT nicht als betriebsbereit behandeln; keine Provider-Ausgaben veröffentlicht.',
            ),
          ),
    );
  });
  // Only setup.mjs has deliberately printable application output (including the one-time admin code).
  if (exposeOutput) console.log(output.trim());
}

export async function prepareDemo({ config, api, botJid, number, statePath }) {
  if (!/^[1-9]\d{6,14}$/.test(number ?? '') || `${number}@s.whatsapp.net` === botJid)
    throw new SafeError('Eine eigene zweite WhatsApp-Testnummer ist erforderlich.');
  const instance = encodeURIComponent(config.instance);
  const identity = createHash('sha256')
    .update(JSON.stringify([config.url, config.instance, botJid, number]))
    .digest('hex');
  let journal;
  try {
    journal = JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new SafeError('Demo-Journal unlesbar. Keine neue Gruppe angelegt.');
  }
  if (journal && journal.identity !== identity)
    throw new SafeError(
      'Das gespeicherte Demo-Journal gehört zu anderen Zugangsdaten oder einer anderen Testnummer. Erst bestehende Demo prüfen.',
    );
  if (journal?.state === 'creating')
    throw new SafeError(
      'Früherer Gruppenaufbau hat einen unklaren Ausgang. Bestehende Gruppe zuerst beim Anbieter prüfen; keine zweite Gruppe erzeugt.',
    );
  if (journal?.state === 'sending')
    throw new SafeError(
      'Frühere Testnachricht hat einen unklaren Ausgang. Nachricht zuerst in WhatsApp prüfen; nicht erneut gesendet.',
    );
  const save = () => writeFile(statePath, JSON.stringify(journal, null, 2), { mode: 0o600 });
  if (!journal) {
    const candidates = await api(`/chat/whatsappNumbers/${instance}`, { numbers: [number] });
    if (
      !Array.isArray(candidates) ||
      !candidates.some((item) => item.exists === true && item.jid === `${number}@s.whatsapp.net`)
    )
      throw new SafeError(
        'Die zweite Testnummer konnte nicht eindeutig als WhatsApp-Konto bestätigt werden.',
      );
    journal = {
      identity,
      subject: `TT Demo ${new Date().toISOString().slice(0, 10)} ${randomUUID().slice(0, 6)}`,
      state: 'creating',
    };
    // Persist intent before every external write. Unknown outcomes are never retried blindly.
    await save();
    const group = await api(`/group/create/${instance}`, {
      subject: journal.subject,
      participants: [number],
      description:
        'Private TT-Demogruppe für Einrichtung und Tests. Keine reguläre Trainingsgruppe.',
    });
    if (!/^\d+(?:-\d+)?@g\.us$/.test(group?.id ?? ''))
      throw new SafeError(
        'Gruppenaufbau nicht eindeutig bestätigt. Bestehende Gruppe beim Anbieter prüfen.',
      );
    journal.groupId = group.id;
    journal.state = 'created';
    await save();
  }
  if (
    !['created', 'ready'].includes(journal.state) ||
    !/^\d+(?:-\d+)?@g\.us$/.test(journal.groupId ?? '')
  )
    throw new SafeError('Demo-Journal enthält keinen gültigen Gruppenzustand.');
  const groups = await api(`/group/fetchAllGroups/${instance}?getParticipants=true`);
  const current = Array.isArray(groups) && groups.find((group) => group.id === journal.groupId);
  // Do not use ambiguous LID digits as phone numbers, or send to a group with extra participants.
  const members = current?.participants?.map((p) =>
    typeof p === 'string'
      ? p
      : p.id?.endsWith('@lid') && /^\d+@s\.whatsapp\.net$/.test(p.phoneNumber ?? '')
        ? p.phoneNumber
        : p.id,
  );
  const allowed = new Set([botJid, `${number}@s.whatsapp.net`]);
  if (
    !current ||
    current.subject !== journal.subject ||
    !Array.isArray(members) ||
    members.length !== 2 ||
    members.some((id) => !allowed.has(id)) ||
    new Set(members).size !== 2
  )
    throw new SafeError(
      'Demo-Mitglieder nicht eindeutig auf Bot und Testkonto begrenzt. Gruppe manuell prüfen; keine Testnachricht gesendet.',
    );
  if (journal.state === 'created') {
    journal.state = 'sending';
    await save();
    const result = await api(`/message/sendText/${instance}`, {
      number: journal.groupId,
      text: '🏓 TT-Demogruppe ist vorbereitet. Diese Nachricht prüft nur den Transport. Die echte Trainingseinladung folgt nach der privaten Admin-Einrichtung. Reaktionen und Login testen wir anschließend mit deinem zweiten WhatsApp-Konto.',
      linkPreview: false,
    });
    if (typeof result.key?.id !== 'string' || !result.key.id)
      throw new SafeError(
        'Testnachricht ohne bestätigte Nachrichten-ID. Nicht automatisch wiederholen.',
      );
    journal.state = 'ready';
    journal.messageId = result.key.id;
    await save();
  }
  return { groupId: journal.groupId, subject: journal.subject };
}

export async function main() {
  const [action, ...flags] = process.argv.slice(2);
  if (
    !['check', 'setup', 'demo'].includes(action) ||
    flags.some((flag) => flag !== '--reset-bootstrap') ||
    (flags.length && action !== 'setup')
  )
    throw new SafeError('Verwendung über scripts/evolution.ps1: Check, Setup oder Demo.');
  const config = credentials(),
    api = apiClient(config);
  const botJid = await connection(config, api);
  console.log('Evolution-Zugang und verbundene Botinstanz erfolgreich geprüft.');
  if (action === 'setup') {
    const path = join(root, 'wrangler.jsonc'),
      errors = [];
    let source = await readFile(path, 'utf8');
    const original = parse(source, errors, { allowTrailingComma: true });
    if (
      errors.length ||
      original.name !== 'tt' ||
      !original.routes?.some((route) => route.pattern === 'tt.bz3.eu' && route.custom_domain)
    )
      throw new SafeError('Unerwartetes Worker-Konfigurationsziel.');
    const webhook = await api(`/webhook/find/${encodeURIComponent(config.instance)}`);
    const existing = webhook?.webhook ?? webhook ?? {};
    if (existing.enabled && existing.url && existing.url !== 'https://tt.bz3.eu/webhooks/evolution')
      throw new SafeError(
        'Andere Anwendung nutzt den Instanz-Webhook. Kein Deployment oder Austausch vorgenommen.',
      );
    for (const [key, value] of [
      ['EVOLUTION_URL', config.url],
      ['EVOLUTION_INSTANCE', config.instance],
    ])
      source = applyEdits(
        source,
        modify(source, ['vars', key], value, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      );
    await writeFile(path, source);
    await run(join(root, 'node_modules/wrangler/bin/wrangler.js'), ['deploy']);
    await run(join(root, 'scripts/setup.mjs'), ['--remote', '--connect', ...flags], true);
    console.log(
      'Provider-Konfiguration veröffentlicht. Bootstrap privat bestätigen; Automatik bleibt bis /aktivieren pausiert.',
    );
  } else if (action === 'demo') {
    if (!process.env.TT_CREDENTIAL_DIRECTORY)
      throw new SafeError('Lokaler geschützter Ablagepfad fehlt.');
    const group = await prepareDemo({
      config,
      api,
      botJid,
      number: process.env.TT_DEMO_NUMBER,
      statePath: join(process.env.TT_CREDENTIAL_DIRECTORY, 'demo.json'),
    });
    console.log(
      `Demogruppe bereit: ${group.subject}\nNach der Owner-Einrichtung privat an den Bot senden:\n/gruppe ${group.groupId}\nDanach /bestätigen. Es wurde keine vorhandene Trainingsgruppe umgestellt.`,
    );
    console.log(
      'Ein erfolgreicher Transporttest ersetzt keine Reaktions-, Login- oder Geräteabnahme.',
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      error instanceof SafeError
        ? error.message
        : 'Aktion fehlgeschlagen; keine vertraulichen Provider-Ausgaben veröffentlicht.',
    );
    process.exitCode = 1;
  });
}
