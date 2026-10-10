import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local operator helper: the one-time code is copied directly, never logged or
// saved. WhatsApp identity is still proven by the human sending and confirming it.
const root = fileURLToPath(new URL('../', import.meta.url));
function node(script, args) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], {
    cwd: root,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 90000,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error || result.status !== 0) throw new Error('operator_command_failed');
  return result.stdout;
}
try {
  if (process.platform !== 'win32') throw new Error('windows_required');
  const state = JSON.parse(
    node('node_modules/wrangler/bin/wrangler.js', [
      'd1',
      'execute',
      'DB',
      '--remote',
      '--command',
      "SELECT value FROM settings WHERE key='bot_jid';",
      '--json',
    ]),
  );
  const jid = state[0]?.results?.[0]?.value;
  if (jid !== '4915237295324@s.whatsapp.net') throw new Error('unexpected_bot');
  const output = node('scripts/setup.mjs', ['--remote', '--reset-bootstrap']);
  const message = output.match(/^\/einrichten [a-f0-9]{48}\s*$/m)?.[0]?.trim();
  if (!message) {
    if (output.includes('Ein Owner ist bereits eingerichtet.')) {
      console.log('Der erste Admin ist bereits eingerichtet. Schreibe /login privat an TTBot.');
    } else throw new Error('bootstrap_missing');
  } else {
    const clipboard = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Set-Clipboard -Value ([Console]::In.ReadToEnd())',
      ],
      { input: message, encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
    if (clipboard.error || clipboard.status !== 0) throw new Error('clipboard_failed');
    console.log('Admin-Einrichtungsbefehl in die Zwischenablage kopiert (30 Minuten gueltig).');
    console.log(
      'Privat an TTBot, +49 1523 7295324, einfuegen und senden. Danach mit JA bestaetigen.',
    );
    console.log(
      'Anschliessend /login senden und Gruppen, Trainingsplan und Datenschutz im Web einrichten.',
    );
  }
} catch {
  console.error(
    'Einrichtung nicht abgeschlossen. Cloudflare-Anmeldung, Verbindung und Bot-Konfiguration pruefen. Kein Code ausgegeben.',
  );
  process.exitCode = 1;
}
