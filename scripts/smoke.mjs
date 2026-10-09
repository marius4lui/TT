import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Temporal } from '@js-temporal/polyfill';

// A completely local workerd/D1/HTTP protocol acceptance test. No accounts or browser are used.
const root = fileURLToPath(new URL('../', import.meta.url));
const folder = join(root, '.wrangler', `smoke-${randomUUID()}`);
const persist = join(folder, 'state');
const config = join(folder, 'wrangler.json');
const wranglerPath = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const instance = 'tt-smoke',
  fakeKey = 'local-smoke-api-key';
const ownerJid = '491701000001@s.whatsapp.net',
  memberJid = '491701000002@s.whatsapp.net';
const botJid = '491701000003@s.whatsapp.net',
  groupJid = '120363100000@g.us';
const invitedGroup = '120363100001@g.us',
  inviteCode = 'LocalSmokeInvitationCode';
let inviteAccepted = false;
const webhookToken = randomBytes(32).toString('hex'),
  setupCode = randomBytes(24).toString('hex');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const children = new Set(),
  sent = [];
let provider,
  worker,
  origin,
  stage = 'prepare',
  eventClock = Date.now(),
  failed = false,
  commandIndex = 0;
const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
function check(condition, code) {
  if (!condition) throw new Error(code);
}

function child(args, options = {}) {
  const localEnv = { ...process.env };
  for (const key of Object.keys(localEnv))
    if (/^(?:EVOLUTION_|CLOUDFLARE_|CF_API)/.test(key)) delete localEnv[key];
  const subprocess = spawn(process.execPath, [wranglerPath, ...args], {
    cwd: root,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...localEnv, CI: '1', WRANGLER_SEND_METRICS: 'false', ...options.env },
  });
  children.add(subprocess);
  subprocess.once('close', () => children.delete(subprocess));
  subprocess.stderr.on('data', () => {}); // Provider/config errors can contain credentials; never print them.
  return subprocess;
}
async function cli(args) {
  return new Promise((resolveCli, rejectCli) => {
    const subprocess = child([...args, '--config', config]);
    let stdout = '';
    const timeout = setTimeout(() => {
      void stop(subprocess);
      rejectCli(new Error('local_cli_timeout'));
    }, 45000);
    subprocess.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    subprocess.once('error', () => {
      clearTimeout(timeout);
      rejectCli(new Error('local_cli_start_failed'));
    });
    subprocess.once('close', (code) => {
      clearTimeout(timeout);
      code === 0 ? resolveCli(stdout) : rejectCli(new Error(`local_cli_exit_${code}`));
    });
  });
}
async function sql(statement) {
  const path = join(folder, `query-${randomUUID()}.sql`);
  try {
    await writeFile(path, statement, { mode: 0o600 });
    const result = JSON.parse(
      await cli([
        'd1',
        'execute',
        'DB',
        '--local',
        '--persist-to',
        persist,
        '--file',
        path,
        '--json',
      ]),
    );
    return result;
  } finally {
    await unlink(path).catch(() => {});
  }
}
async function stop(subprocess) {
  if (!subprocess?.pid || subprocess.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolveStop) => {
      const killer = spawn('taskkill', ['/PID', String(subprocess.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', resolveStop);
      killer.once('close', resolveStop);
    });
  } else {
    try {
      process.kill(-subprocess.pid, 'SIGTERM');
    } catch {
      subprocess.kill();
    }
    await pause(250);
    try {
      process.kill(-subprocess.pid, 'SIGKILL');
    } catch {
      /* already stopped */
    }
  }
}
async function freePort() {
  const listener = createPortServer();
  await new Promise((res, rej) => {
    listener.once('error', rej);
    listener.listen(0, '127.0.0.1', res);
  });
  const port = listener.address().port;
  await new Promise((res) => listener.close(res));
  return port;
}
async function local(path, init = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
}
async function waitSent(offset, predicate, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const message = sent.slice(offset).find(predicate);
    if (message) return message;
    check(worker.exitCode === null, 'worker_stopped');
    await pause(50);
  }
  throw new Error('expected_reply_timeout');
}
async function webhook(sender, text, extra = {}) {
  eventClock = Math.max(Date.now(), eventClock + 1);
  const group = extra.group === true;
  const response = await local('/webhooks/evolution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webhookToken}` },
    body: JSON.stringify({
      instance,
      event: 'messages.upsert',
      apikey: 'fake-envelope-secret',
      data: {
        key: {
          id: randomUUID(),
          fromMe: false,
          remoteJid: group ? groupJid : sender,
          ...(group ? { participant: sender } : {}),
        },
        messageTimestamp: eventClock,
        pushName: sender === ownerJid ? 'Smoke Trainer' : 'Smoke Mitglied',
        message: extra.reaction ? { reactionMessage: extra.reaction } : { conversation: text },
      },
    }),
  });
  check(response.status === 202 && (await response.json()).accepted === 1, 'webhook_accept_failed');
}
async function command(sender, text, expected) {
  commandIndex++;
  const offset = sent.length;
  await webhook(sender, text);
  return waitSent(
    offset,
    (message) => message.number === sender && message.text?.includes(expected),
  );
}
const cookie = (response) =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('Set-Cookie') ?? ''])
    .map((value) => value.split(';')[0])
    .filter(Boolean)
    .join('; ');
const progress = (text) => console.log(`Smoke: ${text}`);

try {
  await mkdir(folder, { recursive: true });
  provider = createServer(async (request, response) => {
    try {
      check(request.headers.apikey === fakeKey, 'mock_api_key_missing');
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const data = raw ? JSON.parse(raw) : undefined;
      response.setHeader('Content-Type', 'application/json');
      if (
        request.method === 'POST' &&
        [`/message/sendText/${instance}`, `/message/sendContact/${instance}`].includes(request.url)
      ) {
        const id = `smoke-provider-${randomUUID()}`;
        sent.push({ ...data, id, path: request.url });
        response.statusCode = 201;
        response.end(JSON.stringify({ key: { id } }));
      } else if (request.url === `/group/fetchAllGroups/${instance}?getParticipants=true`) {
        response.end(
          JSON.stringify([
            {
              id: groupJid,
              subject: 'TT lokale Smokegruppe',
              participants: [
                { id: ownerJid, admin: 'admin' },
                { id: memberJid, admin: null },
                { id: botJid, admin: 'admin' },
              ],
            },
            ...(inviteAccepted
              ? [
                  {
                    id: invitedGroup,
                    subject: 'TT Einladungstest',
                    participants: [
                      { id: ownerJid, admin: 'admin' },
                      { id: botJid },
                      { id: memberJid },
                    ],
                  },
                ]
              : []),
          ]),
        );
      } else if (request.url === `/group/inviteInfo/${instance}?inviteCode=${inviteCode}`) {
        response.end(JSON.stringify({ id: invitedGroup, subject: 'TT Einladungstest' }));
      } else if (request.url === `/group/acceptInviteCode/${instance}?inviteCode=${inviteCode}`) {
        inviteAccepted = true;
        response.end(JSON.stringify({ accepted: true, groupJid: invitedGroup }));
      } else if (request.url === `/instance/connectionState/${instance}`)
        response.end(JSON.stringify({ instance: { state: 'open' } }));
      else {
        response.statusCode = 404;
        response.end('{}');
      }
    } catch {
      response.statusCode = 400;
      response.end('{}');
    }
  });
  await new Promise((res, rej) => {
    provider.once('error', rej);
    provider.listen(0, '127.0.0.1', res);
  });
  const providerPort = provider.address().port,
    workerPort = await freePort(),
    inspectorPort = await freePort();
  origin = `http://127.0.0.1:${workerPort}`;
  await writeFile(
    config,
    JSON.stringify(
      {
        name: 'tt-local-smoke',
        main: resolve(root, 'apps/worker/src/index.ts'),
        compatibility_date: '2026-10-08',
        compatibility_flags: ['nodejs_compat'],
        assets: {
          directory: resolve(root, 'apps/web/public'),
          binding: 'ASSETS',
          run_worker_first: true,
        },
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'tt-smoke',
            database_id: randomUUID(),
            migrations_dir: resolve(root, 'migrations'),
          },
        ],
        vars: {
          EVOLUTION_URL: `http://127.0.0.1:${providerPort}`,
          EVOLUTION_INSTANCE: instance,
          EVOLUTION_API_KEY: fakeKey,
        },
        observability: { enabled: false },
      },
      null,
      2,
    ),
  );
  // Explicit empty env files prevent inherited project dev vars from changing the local fake provider.
  await writeFile(join(folder, '.dev.vars'), '');
  await writeFile(join(folder, '.env'), '');
  stage = 'migrations';
  await cli(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist]);
  await sql(`INSERT INTO settings(key,value) VALUES('webhook_token_hash',${quote(hash(webhookToken))}),('bot_jid',${quote(botJid)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
UPDATE settings SET value=${quote(origin)} WHERE key='origin';
INSERT INTO bootstrap(id,state,code_hash,expires_at) VALUES(1,'pending',${quote(hash(setupCode))},${Date.now() + 1800000});`);
  stage = 'worker readiness';
  worker = child([
    'dev',
    '--local',
    '--test-scheduled',
    '--ip',
    '127.0.0.1',
    '--port',
    String(workerPort),
    '--inspector-port',
    String(inspectorPort),
    '--persist-to',
    persist,
    '--config',
    config,
    '--log-level',
    'error',
    '--show-interactive-dev-session=false',
  ]);
  worker.stdout.on('data', () => {});
  const readyUntil = Date.now() + 45000;
  let ready = false;
  while (Date.now() < readyUntil && !ready) {
    check(worker.exitCode === null, 'worker_start_failed');
    try {
      ready = (await local('/health')).status === 200;
    } catch {
      /* startup */
    }
    if (!ready) await pause(150);
  }
  check(ready, 'worker_readiness_timeout');
  progress('local workerd and isolated D1 ready');

  stage = 'bootstrap and trainer setup';
  await command(ownerJid, `/einrichten ${setupCode}`, 'JA');
  await command(ownerJid, 'JA', 'erste Owner');
  await command(ownerJid, `/gruppe ${groupJid}`, '/bestätigen');
  await command(ownerJid, '/bestätigen', 'Übernommen');
  await command(
    ownerJid,
    '/datenschutz Verantwortlich: Smoke Testverein. Kontakt: lokaler Trainer. Daten dienen ausschließlich der lokalen Testorganisation.',
    '/bestätigen',
  );
  await command(ownerJid, '/bestätigen', 'Übernommen');
  await command(ownerJid, '/aktivieren', '/bestätigen');
  await command(ownerJid, '/bestätigen', 'Übernommen');
  const tomorrow = Temporal.PlainDate.from(
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(Date.now()),
  )
    .add({ days: 1 })
    .toString();
  await command(ownerJid, `/sondertraining ${tomorrow} 18:00 20:00 Smokehalle`, '/bestätigen');
  await command(ownerJid, '/bestätigen', 'Übernommen');
  progress('owner bootstrap, group/privacy activation and training confirmed');

  stage = 'scheduler and reaction';
  await sql(`UPDATE training_sessions SET invite_at=${Date.now() - 1000};`);
  const inviteOffset = sent.length;
  const scheduled = await local('/cdn-cgi/local/scheduled');
  check(scheduled.ok, 'scheduler_trigger_failed');
  const invitation = await waitSent(
    inviteOffset,
    (message) => message.number === groupJid && message.text?.includes('👍 Ich komme'),
  );
  await webhook(memberJid, '', {
    group: true,
    reaction: { key: { id: invitation.id, remoteJid: groupJid, fromMe: true }, text: '👍🏽' },
  });
  progress('actual local cron invocation and group reaction accepted without chat spam');

  stage = 'one-message magic login, web registration and optional reminders';
  const api = (path, method, data, session = '') =>
    local(path, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(session ? { Cookie: session } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const loginOffset = sent.length;
  const loginReply = await command(memberJid, 'Ich möchte mich anmelden', '/login#');
  const token = loginReply.text.match(/\/login#([a-f0-9]{48})/)?.[1];
  check(!!token, 'magic_token_missing');
  const preview = await api('/api/v1/auth/magic/preview', 'POST', { token });
  check(
    preview.status === 200 && (await preview.json()).registrationRequired === true,
    'magic_preview_failed',
  );
  const missingConsent = await api('/api/v1/auth/magic/finish', 'POST', { token });
  check(missingConsent.status === 409, 'registration_consent_missing');
  const finish = await api('/api/v1/auth/magic/finish', 'POST', { token, consent: true });
  check(finish.status === 200, 'login_finish_failed');
  const sessionCookie = cookie(finish)
    .split('; ')
    .filter((part) => part.startsWith('__Host-tt-session='))
    .join('; ');
  check(
    sessionCookie && finish.headers.get('Set-Cookie')?.includes('HttpOnly'),
    'session_cookie_missing',
  );
  const beforeConsent = await local('/api/v1/me', { headers: { Cookie: sessionCookie } });
  check(
    beforeConsent.status === 200 && (await beforeConsent.json()).user.reminders === false,
    'registration_implied_reminders',
  );
  const preference = await api(
    '/api/v1/account/preferences',
    'PATCH',
    { reminders: true, reminderConsent: true },
    sessionCookie,
  );
  check(preference.status === 200, 'web_reminder_consent_failed');
  const me = await local('/api/v1/me', { headers: { Cookie: sessionCookie } });
  check(me.status === 200 && (await me.json()).user.reminders === true, 'separate_consent_failed');
  const replay = await api('/api/v1/auth/magic/finish', 'POST', { token, consent: true });
  check(replay.status === 401, 'login_replay_not_rejected');
  check(
    sent.slice(loginOffset).filter((message) => message.number === memberJid).length === 1,
    'login_or_consent_spam',
  );
  const trainerLink = await command(ownerJid, '/login', '/login#');
  const trainerToken = trainerLink.text.match(/\/login#([a-f0-9]{48})/)?.[1];
  const trainerFinish = await api('/api/v1/auth/magic/finish', 'POST', { token: trainerToken });
  check(
    trainerFinish.status === 200 && (await trainerFinish.json()).redirect === '/trainer',
    'trainer_login_failed',
  );
  const trainerCookie = cookie(trainerFinish);
  const trainerMe = await local('/api/v1/me', { headers: { Cookie: trainerCookie } });
  const trainerIdentity = await trainerMe.json();
  check(
    trainerIdentity.role === 'owner' &&
      trainerIdentity.user.registeredAt === null &&
      trainerIdentity.registrationRequired === false,
    'trainer_participant_registration_leaked',
  );
  const overview = await local('/api/v1/trainer/overview', { headers: { Cookie: trainerCookie } });
  check(
    overview.status === 200 && (await overview.json()).sessions.length === 1,
    'trainer_overview_failed',
  );
  const summaryPreference = await api(
    '/api/v1/trainer/summary-preference',
    'PUT',
    {
      enabled: true,
      offsetMinutes: 10,
      includeAbsent: true,
      includeLate: true,
      includeCounts: true,
      version: 0,
    },
    trainerCookie,
  );
  check(summaryPreference.status === 200, 'trainer_summary_without_participant_failed');
  const forbiddenTrainer = await local('/api/v1/trainer/overview', {
    headers: { Cookie: sessionCookie },
  });
  check(forbiddenTrainer.status === 403, 'trainer_role_not_enforced');
  const unauthorized = await local('/webhooks/evolution', {
    method: 'POST',
    headers: { Authorization: 'Bearer intentionally-wrong', 'Content-Type': 'application/json' },
    body: '{}',
  });
  check(unauthorized.status === 401, 'webhook_auth_not_enforced');
  progress(
    'single-message login, web consent, direct trainer access and replay rejection verified',
  );

  stage = 'final durable state';
  const result = await sql(`SELECT state,code_hash FROM bootstrap;
SELECT COUNT(*) AS n FROM roles WHERE role='owner';
SELECT COUNT(*) AS n FROM training_sessions WHERE status='scheduled' AND version=1;
SELECT response,punctuality FROM attendance a JOIN users u ON u.id=a.user_id WHERE u.jid=${quote(memberJid)};
SELECT registered_at,reminders FROM users WHERE jid=${quote(memberJid)};
SELECT purpose,accepted FROM consents ORDER BY created_at;
SELECT state,LENGTH(token_hash) AS digest_length FROM auth_magic_links;
SELECT COUNT(*) AS n FROM auth_sessions WHERE LENGTH(token_hash)=64;
SELECT COUNT(*) AS n FROM inbox_events WHERE status!='done' OR payload!='';
SELECT COUNT(*) AS n FROM outbox_jobs WHERE status IN ('failed','uncertain','processing');
SELECT COUNT(*) AS n FROM messages WHERE kind='invite' AND chat_jid=${quote(groupJid)};`);
  const rows = result.map((item) => item.results);
  check(
    rows[0]?.[0]?.state === 'completed' && rows[0][0].code_hash === null,
    'bootstrap_durable_state_failed',
  );
  check(rows[1]?.[0]?.n === 1 && rows[2]?.[0]?.n === 1, 'roles_or_training_state_failed');
  check(
    rows[3]?.[0]?.response === 'yes' && rows[4]?.[0]?.registered_at && rows[4][0].reminders === 1,
    'attendance_or_account_state_failed',
  );
  check(
    rows[5]?.some((row) => row.purpose === 'registration' && row.accepted === 1) &&
      rows[5]?.some((row) => row.purpose === 'reminders' && row.accepted === 1),
    'consent_records_failed',
  );
  check(
    rows[6]?.length === 2 &&
      rows[6].every((row) => row.state === 'used' && row.digest_length === 64) &&
      rows[7]?.[0]?.n === 2,
    'auth_durable_state_failed',
  );
  check(
    rows[8]?.[0]?.n === 0 && rows[9]?.[0]?.n === 0 && rows[10]?.[0]?.n === 1,
    'inbox_or_outbox_state_failed',
  );
  check(
    !sent.some((message) => message.path === `/message/sendContact/${instance}`),
    'unexpected_contact_card_spam',
  );
  progress('PASS — local Worker, D1, cron, Evolution mock, reactions and authentication');
  if (process.argv.includes('--browser')) {
    // Hold the exact tested Worker/D1 for authorized browser acceptance; no UI mocks
    // or authentication bypass. The URL came through the same WhatsApp transport.
    const reply = await command(ownerJid, '/login', '/login#');
    const url = reply.text.match(/https?:\/\/\S+\/login#[a-f0-9]{48}/)?.[0];
    check(!!url, 'browser_login_missing');
    await writeFile(
      join(folder, 'browser-login.json'),
      JSON.stringify({ url, origin, stopFile: join(folder, 'browser-stop') }),
    );
    progress(`browser acceptance ready: ${join(folder, 'browser-login.json')}`);
    const until = Date.now() + 30 * 60000;
    while (Date.now() < until) {
      if (
        await access(join(folder, 'browser-stop')).then(
          () => true,
          () => false,
        )
      )
        break;
      await pause(1000);
    }
  }
} catch (error) {
  failed = true;
  // Print only our fixed stage label. Never print captured Wrangler output, HTTP bodies, codes or cookies.
  const code =
    error instanceof Error && /^[a-z_]+(?:_\d+)?$/.test(error.message)
      ? error.message
      : 'local_test_failed';
  await writeFile(
    join(folder, 'diagnostic.json'),
    JSON.stringify(
      {
        stage,
        commandIndex,
        code,
        replies: sent.map((message) => ({
          number: message.number,
          path: message.path,
          text: message.text?.replace(/\b[a-f0-9]{32,128}\b/gi, '[protected]').slice(0, 160),
        })),
      },
      null,
      2,
    ),
  ).catch(() => {});
  console.error(
    `Smoke failed during ${stage} (command ${commandIndex}, ${code}). Local diagnostic state remains under .wrangler; no external provider was used.`,
  );
} finally {
  for (const subprocess of [...children]) await stop(subprocess);
  if (provider) {
    provider.closeAllConnections();
    await new Promise((res) => provider.close(res));
  }
}
if (failed) process.exitCode = 1;
