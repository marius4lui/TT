import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentials, apiClient, prepareDemo } from '../evolution-live.mjs';

const config = { url: 'https://example.invalid', instance: 'test', key: 'synthetic-secret' };
const botJid = '491701000001@s.whatsapp.net',
  number = '491701000002';
test('credentials reject key-bearing URLs and invalid values', () => {
  for (const url of [
    'http://example.invalid',
    'https://user:pass@example.invalid',
    'https://example.invalid?key=abc',
  ])
    assert.throws(() =>
      credentials({ EVOLUTION_URL: url, EVOLUTION_INSTANCE: 'test', EVOLUTION_API_KEY: 'fake' }),
    );
  assert.equal(
    credentials({
      EVOLUTION_URL: config.url,
      EVOLUTION_INSTANCE: 'test',
      EVOLUTION_API_KEY: 'fake',
    }).url,
    config.url,
  );
});
test('provider errors never disclose response or request secrets and never retry', async () => {
  let calls = 0;
  const api = apiClient(config, async (_, request) => {
    calls++;
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.apikey, config.key);
    return new Response(config.key, { status: 500 });
  });
  await assert.rejects(
    api('/group/create/test', {}),
    (e) => !e.message.includes(config.key) && e.message.includes('500'),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    apiClient(config, async () => {
      throw new Error(config.key);
    })('/x'),
    (e) => !e.message.includes(config.key),
  );
});
for (const scenario of [
  'success',
  'create-timeout',
  'send-timeout',
  'extra-member',
  'ambiguous-lid',
]) {
  test(`demo journal: ${scenario}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tt-demo-test-')),
      statePath = join(directory, 'demo.json');
    let subject,
      creates = 0,
      sends = 0;
    const api = async (path, body) => {
      if (path.includes('whatsappNumbers'))
        return [{ exists: true, jid: number + '@s.whatsapp.net' }];
      if (path.includes('group/create')) {
        creates++;
        subject = body.subject;
        assert.deepEqual(body.participants, [number]);
        if (scenario === 'create-timeout') throw new Error('uncertain');
        return { id: '120363123456@g.us' };
      }
      if (path.includes('fetchAllGroups')) {
        const participants = [
          { id: '100001@lid', phoneNumber: botJid },
          { id: '100002@lid', phoneNumber: number + '@s.whatsapp.net' },
        ];
        if (scenario === 'extra-member') participants.push({ id: '491701000003@s.whatsapp.net' });
        if (scenario === 'ambiguous-lid') participants[1].phoneNumber = '100002@lid';
        return [{ id: '120363123456@g.us', subject, participants }];
      }
      if (path.includes('sendText')) {
        sends++;
        if (scenario === 'send-timeout') throw new Error('uncertain');
        return { key: { id: 'fake-message' } };
      }
      throw new Error('Unexpected API call');
    };
    const invoke = () => prepareDemo({ config, api, botJid, number, statePath });
    try {
      if (scenario === 'success') {
        await invoke();
        await invoke();
        assert.equal(sends, 1);
        await assert.rejects(
          prepareDemo({ config, api, botJid, number: '491701000004', statePath }),
        );
      } else {
        await assert.rejects(invoke());
        await assert.rejects(invoke());
        assert.equal(sends, scenario === 'send-timeout' ? 1 : 0);
      }
      assert.equal(creates, 1);
      assert.ok(!(await readFile(statePath, 'utf8')).includes(config.key));
    } finally {
      await unlink(statePath).catch(() => {});
      await rmdir(directory);
    }
  });
}
