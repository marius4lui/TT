import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parse as parseJsonc } from 'jsonc-parser';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSetupArgs, validateOrigin } from './deployment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let options;
try {
  options = parseSetupArgs(process.argv.slice(2), root);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const { remote, connect, configPath } = options;
const args = options.flags;
if (args.has('--help')) {
  console.log(
    `TT einrichten\n\nnode scripts/setup.mjs --local\nnode scripts/setup.mjs --remote --connect --origin https://training.example.org\n\n--config PATH        Wrangler-Konfiguration (remote: wrangler.production.jsonc)\n--origin URL         Öffentliche HTTPS-Adresse; für eine neue Remote-Datenbank erforderlich\n--local              Lokale Datenbank, kurzlebigen ersten Admincode erzeugen\n--remote             Bereits erstellte D1-Datenbank verwenden\n--connect            Evolution prüfen, Instanz-Webhook konfigurieren, Worker-Secret setzen\n--reset-bootstrap    Abgebrochene/abgelaufene Einrichtung bewusst neu beginnen\n--replace-webhook    Einen anderen vorhandenen Instanz-Webhook bewusst ersetzen\n\nVorher D1-Migrationen anwenden. --connect braucht EVOLUTION_URL, EVOLUTION_INSTANCE und EVOLUTION_API_KEY ausschließlich in der Prozessumgebung. Kein WhatsApp-Nachrichtenversand.\nEine abgeschlossene Owner-Einrichtung wird niemals zurückgesetzt.`,
  );
  process.exit(0);
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
async function wrangler(argv, input) {
  return new Promise((res, rej) => {
    const child = spawn(
      process.execPath,
      [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...argv, '--config', configPath],
      {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      },
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    // Upstream errors can contain credentials. Report only the command and exit code.
    child.stderr.on('data', () => {});
    child.on('error', () =>
      rej(new Error('Wrangler konnte nicht gestartet werden. Bitte pnpm install ausführen.')),
    );
    child.on('exit', (code) =>
      code === 0
        ? res(stdout)
        : rej(
            new Error(
              `Wrangler ${argv[0]} fehlgeschlagen (Exit ${code}). Konfiguration und Berechtigungen prüfen.`,
            ),
          ),
    );
    child.stdin.end(input ?? '');
  });
}
async function sql(statement) {
  // Remote --file is an import: it returns an import summary instead of SELECT /
  // RETURNING rows. Use the query path for both environments. SQL contains only
  // configuration and random credential hashes, never API keys or raw codes.
  const output = await wrangler([
    'd1',
    'execute',
    'DB',
    remote ? '--remote' : '--local',
    '--command',
    statement,
    '--json',
  ]);
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.some((item) => item.success !== true))
    throw new Error('Die Datenbankabfrage wurde nicht erfolgreich bestätigt.');
  return parsed.flatMap((item) => item.results ?? []);
}
async function api(path, body) {
  const base = new URL(process.env.EVOLUTION_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    throw new Error('Evolution braucht eine HTTPS-Basisadresse ohne Zugangsdaten in der URL.');
  const response = await fetch(`${base.toString().replace(/\/$/, '')}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: process.env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Evolution-Aufruf fehlgeschlagen (HTTP ${response.status}). API-Vertrag und Berechtigungen prüfen.`,
    );
  return response.json();
}
try {
  const configErrors = [];
  const config = parseJsonc(await readFile(configPath, 'utf8'), configErrors, {
    allowTrailingComma: true,
  });
  if (
    configErrors.length ||
    !config?.name ||
    !config.d1_databases?.some((db) => db.binding === 'DB')
  )
    throw new Error('Die Wrangler-Konfiguration ist ungültig oder enthält keine DB-Bindung.');
  const configuredOrigin = (await sql("SELECT value FROM settings WHERE key='origin';"))[0]?.value;
  const origin = validateOrigin(
    options.origin ?? (remote ? configuredOrigin : 'http://localhost:8787'),
    remote,
  );
  const state = (await sql('SELECT state,expires_at FROM bootstrap WHERE id=1;'))[0];
  const existingOwners =
    (await sql("SELECT COUNT(*) AS n FROM roles WHERE role='owner';"))[0]?.n ?? 0;
  if (
    state &&
    state.state !== 'completed' &&
    existingOwners === 0 &&
    !args.has('--reset-bootstrap')
  )
    throw new Error(
      'Ein Einrichtungsversuch existiert bereits. Für einen bewussten neuen Versuch --reset-bootstrap verwenden.',
    );
  if (connect) {
    for (const name of ['EVOLUTION_URL', 'EVOLUTION_INSTANCE', 'EVOLUTION_API_KEY'])
      if (!process.env[name]) throw new Error(`${name} fehlt in der Prozessumgebung.`);
    if (
      config.vars?.EVOLUTION_URL !== process.env.EVOLUTION_URL ||
      config.vars?.EVOLUTION_INSTANCE !== process.env.EVOLUTION_INSTANCE
    )
      throw new Error(
        'Die Werte EVOLUTION_URL und EVOLUTION_INSTANCE in der gewählten Wrangler-Konfiguration müssen vor --connect zur Prozessumgebung passen.',
      );
    const instance = encodeURIComponent(process.env.EVOLUTION_INSTANCE);
    const status = await api(`/instance/connectionState/${instance}`);
    if ((status.instance?.state ?? status.state) !== 'open')
      throw new Error(
        'Die Evolution-Instanz ist noch nicht mit WhatsApp verbunden. Bitte zuerst beim Anbieter verbinden.',
      );
    const instances = await api(`/instance/fetchInstances?instanceName=${instance}`);
    const candidates = (Array.isArray(instances) ? instances : [instances]).map(
      (item) => item.instance ?? item,
    );
    const item = candidates.find(
      (item) =>
        item.name === process.env.EVOLUTION_INSTANCE ||
        item.instanceName === process.env.EVOLUTION_INSTANCE,
    );
    const botJid = item?.ownerJid ?? item?.owner ?? item?.wuid;
    if (typeof botJid !== 'string' || !/^\d{5,20}@s\.whatsapp\.net$/.test(botJid))
      throw new Error(
        'Die eigene Telefonnummer konnte nicht sicher aus Evolution gelesen werden. Instanzvertrag prüfen.',
      );
    const current = await api(`/webhook/find/${instance}`);
    const webhook = current?.webhook ?? current ?? {};
    const target = `${origin}/webhooks/evolution`;
    if (webhook.enabled && webhook.url && webhook.url !== target && !args.has('--replace-webhook'))
      throw new Error(
        'Ein anderer Instanz-Webhook ist aktiv. Für diese Botnummer eine eigene Instanz verwenden oder bewusst --replace-webhook angeben.',
      );
    const token = randomBytes(32).toString('hex');
    // TT remains paused. Set receiving credentials before directing provider events here.
    await sql(
      `INSERT INTO settings(key,value) VALUES('origin',${quote(origin)}),('webhook_token_hash',${quote(hash(token))}),('bot_jid',${quote(botJid)}),('enabled','0') ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
    );
    await wrangler(['secret', 'put', 'EVOLUTION_API_KEY'], `${process.env.EVOLUTION_API_KEY}\n`);
    await api(`/webhook/set/${instance}`, {
      webhook: {
        enabled: true,
        url: target,
        headers: { Authorization: `Bearer ${token}` },
        byEvents: false,
        base64: false,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'CONNECTION_UPDATE',
          'GROUP_PARTICIPANTS_UPDATE',
          'GROUPS_UPSERT',
        ],
      },
    });
    const verify = await api(`/webhook/find/${instance}`);
    const configured = verify.webhook ?? verify;
    if (configured.url !== target || configured.enabled !== true)
      throw new Error('Evolution hat den erwarteten Webhook nicht bestätigt. TT bleibt pausiert.');
    if (configured.headers?.Authorization !== `Bearer ${token}`)
      throw new Error(
        'Evolution hat den authentifizierten Webhook-Header nicht bestätigt. Anbieter-Vertrag prüfen; TT bleibt pausiert.',
      );
    const expectedEvents = [
      'MESSAGES_UPSERT',
      'MESSAGES_UPDATE',
      'CONNECTION_UPDATE',
      'GROUP_PARTICIPANTS_UPDATE',
      'GROUPS_UPSERT',
    ];
    if (
      !Array.isArray(configured.events) ||
      !expectedEvents.every((event) => configured.events.includes(event)) ||
      configured.webhookByEvents === true ||
      configured.byEvents === true
    )
      throw new Error(
        'Evolution hat Ereignisse oder Webhook-Routing nicht wie erwartet übernommen. TT bleibt pausiert.',
      );
    console.log(
      'Evolution verbunden, Webhook eingerichtet. TT bleibt bis zur Aktivierung im Trainerbereich pausiert.',
    );
    console.log(
      'EVOLUTION_URL und EVOLUTION_INSTANCE müssen außerdem in der gewählten Wrangler-Konfiguration zu dieser Instanz passen.',
    );
  }
  await sql(
    `INSERT INTO settings(key,value) VALUES('origin',${quote(origin)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
  );
  if (state?.state === 'completed' || existingOwners > 0) {
    console.log(
      'Ein Owner ist bereits eingerichtet. Die Ersteinrichtung bleibt dauerhaft geschlossen.',
    );
  } else {
    if (state && !args.has('--reset-bootstrap'))
      throw new Error(
        'Ein Einrichtungsversuch existiert bereits. Für einen bewussten neuen Versuch --reset-bootstrap verwenden.',
      );
    const code = randomBytes(24).toString('hex'),
      expires = Date.now() + 30 * 60000;
    const rows = await sql(
      `INSERT INTO bootstrap(id,state,code_hash,expires_at) SELECT 1,'pending',${quote(hash(code))},${expires} WHERE NOT EXISTS(SELECT 1 FROM roles WHERE role='owner') ON CONFLICT(id) DO UPDATE SET state='pending',code_hash=excluded.code_hash,expires_at=excluded.expires_at,reserved_user_id=NULL,reservation_event_id=NULL WHERE bootstrap.state!='completed' AND NOT EXISTS(SELECT 1 FROM roles WHERE role='owner') RETURNING id;`,
    );
    if (!rows.length)
      throw new Error('Die Einrichtung wurde inzwischen abgeschlossen. Kein neuer Code erzeugt.');
    console.log('Einmaliger Einrichtungscode, 30 Minuten gültig. Nur privat an den Bot senden:');
    console.log(`/einrichten ${code}`);
    console.log('Danach JA bestätigen. Den Code nicht in Gruppen oder Git ablegen.');
  }
} catch (error) {
  if (process.env.TT_SETUP_DIAGNOSTIC === '1') {
    const location = error instanceof Error ? error.stack?.match(/setup\.mjs:(\d+):(\d+)/) : null;
    console.error(
      `Setup diagnostic: ${error instanceof Error ? error.name : 'Unknown'} at line ${location?.[1] ?? 'unknown'}`,
    );
  }
  // Only application-created fixed errors are shown; never output fetch request/response data.
  const known =
    error instanceof Error &&
    /^(Wrangler|Evolution|EVOLUTION_|Die |Ein |In der|Einrichtung|Die eigene|Die entfernte)/.test(
      error.message,
    );
  console.error(
    known
      ? error.message
      : 'Einrichtung fehlgeschlagen. Verbindung und lokale Konfiguration prüfen; keine Zugangsdaten wurden ausgegeben.',
  );
  process.exitCode = 1;
}
