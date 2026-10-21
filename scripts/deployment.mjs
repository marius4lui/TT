import { resolve } from 'node:path';

export function parseSetupArgs(argv, root, env = process.env) {
  const result = { remote: false, connect: false, flags: new Set(), origin: undefined };
  let config;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (['--config', '--origin'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Ein Wert für ${flag} fehlt.`);
      if (flag === '--config') config = value;
      else result.origin = value;
    } else if (
      [
        '--local',
        '--remote',
        '--connect',
        '--reset-bootstrap',
        '--replace-webhook',
        '--help',
      ].includes(flag)
    ) {
      result.flags.add(flag);
    } else throw new Error('Die Setup-Option ist unbekannt. Siehe --help.');
  }
  result.remote = result.flags.has('--remote');
  result.connect = result.flags.has('--connect');
  if ((result.remote && result.flags.has('--local')) || (result.connect && !result.remote))
    throw new Error(
      'Die Optionen --local/--remote widersprechen sich oder --connect fehlt --remote.',
    );
  result.configPath = resolve(
    root,
    config || env.TT_CONFIG || (result.remote ? 'wrangler.production.jsonc' : 'wrangler.jsonc'),
  );
  return result;
}

export function validateOrigin(value, remote = true) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'Die öffentliche Adresse fehlt oder ist ungültig. --origin https://training.example.org verwenden.',
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        !remote &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error(
      'Die öffentliche Adresse muss eine HTTPS-Origin ohne Pfad, Zugangsdaten oder Parameter sein.',
    );
  return url.origin;
}
