import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSetupArgs, validateOrigin } from '../deployment.mjs';

test('setup uses separate local and production configurations and accepts explicit overrides', () => {
  assert.equal(parseSetupArgs([], '/project', {}).configPath, '/project/wrangler.jsonc');
  assert.equal(
    parseSetupArgs(['--remote'], '/project', {}).configPath,
    '/project/wrangler.production.jsonc',
  );
  const options = parseSetupArgs(
    ['--remote', '--connect', '--config', 'club.jsonc', '--origin', 'https://club.example.org'],
    '/project',
    {},
  );
  assert.equal(options.configPath, '/project/club.jsonc');
  assert.equal(options.origin, 'https://club.example.org');
  assert.equal(options.connect, true);
  assert.equal(
    parseSetupArgs(['--remote'], '/project', { TT_CONFIG: 'custom.jsonc' }).configPath,
    '/project/custom.jsonc',
  );
  for (const argv of [
    ['--config'],
    ['--origin', '--remote'],
    ['--remote', '--local'],
    ['--connect'],
    ['--typo'],
  ])
    assert.throws(() => parseSetupArgs(argv, '/project', {}));
});

test('public origin accepts any deployment hostname but rejects unsafe and non-origin URLs', () => {
  assert.equal(validateOrigin('https://club.example.org/'), 'https://club.example.org');
  assert.equal(validateOrigin('https://tt.example.workers.dev'), 'https://tt.example.workers.dev');
  assert.equal(validateOrigin('http://localhost:8787', false), 'http://localhost:8787');
  for (const value of [
    '',
    undefined,
    'http://club.example.org',
    'https://a:b@club.example.org',
    'https://club.example.org/path',
    'https://club.example.org?secret=x',
    'https://club.example.org/#x',
  ])
    assert.throws(() => validateOrigin(value));
  assert.throws(() => validateOrigin('http://localhost:8787'));
  assert.throws(() => validateOrigin('http://club.example.org', false));
});
