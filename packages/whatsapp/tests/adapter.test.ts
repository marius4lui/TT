import { describe, expect, it, vi } from 'vitest';
import {
  EvolutionClient,
  normalizeControlWebhook,
  normalizeWebhook,
  TransportError,
} from '../src/index';

const now = Date.parse('2026-10-08T17:00:00Z');
const inbound = (message: Record<string, unknown> = { conversation: 'Ich komme später' }) => ({
  event: 'messages.upsert',
  instance: 'tt-test',
  apikey: 'secret-in-envelope',
  data: {
    key: {
      id: 'event-1',
      remoteJid: '120363123456@g.us',
      fromMe: false,
      participant: '491701234567@s.whatsapp.net',
    },
    pushName: 'Paul',
    messageTimestamp: now / 1000,
    message,
  },
});

describe('inbound normalization', () => {
  it('uses the outer reacting sender, never the reaction target author or bot envelope sender', () => {
    const payload = inbound({
      reactionMessage: {
        key: {
          id: 'invitation',
          remoteJid: '120363123456@g.us',
          fromMe: true,
          participant: '491709999999@s.whatsapp.net',
        },
        text: '👍🏽',
      },
    });
    const [event] = normalizeWebhook(payload, 'tt-test', now);
    expect(event.senderJid).toBe('491701234567@s.whatsapp.net');
    expect(event.reaction).toEqual({ targetId: 'invitation', emoji: '👍🏽' });
    expect(JSON.stringify(event)).not.toContain('secret-in-envelope');
    expect(
      normalizeWebhook(
        inbound({ reactionMessage: { key: { id: 'invitation' }, text: '' } }),
        'tt-test',
        now,
      )[0].reaction?.emoji,
    ).toBe('');
  });
  it('rejects foreign instance, outgoing, status/history/old/future messages and missing outer sender', () => {
    expect(normalizeWebhook(inbound(), 'foreign', now)).toEqual([]);
    const outgoing = inbound();
    outgoing.data.key.fromMe = true;
    expect(normalizeWebhook(outgoing, 'tt-test', now)).toEqual([]);
    expect(normalizeWebhook({ ...inbound(), event: 'messages.set' }, 'tt-test', now)).toEqual([]);
    expect(
      normalizeWebhook(
        { ...inbound(), data: { ...inbound().data, type: 'append' } },
        'tt-test',
        now,
      ),
    ).toEqual([]);
    expect(
      normalizeWebhook(
        { ...inbound(), data: { ...inbound().data, messageTimestamp: now / 1000 - 86401 } },
        'tt-test',
        now,
      ),
    ).toEqual([]);
    expect(
      normalizeWebhook(
        { ...inbound(), data: { ...inbound().data, messageTimestamp: now / 1000 + 301 } },
        'tt-test',
        now,
      ),
    ).toEqual([]);
    expect(
      normalizeWebhook(
        {
          ...inbound(),
          data: {
            ...inbound().data,
            key: { id: 'x', fromMe: false, remoteJid: 'status@broadcast' },
          },
        },
        'tt-test',
        now,
      ),
    ).toEqual([]);
    expect(
      normalizeWebhook(
        {
          ...inbound(),
          data: {
            ...inbound().data,
            key: { id: 'x', fromMe: false, remoteJid: '120363123456@g.us' },
          },
        },
        'tt-test',
        now,
      ),
    ).toEqual([]);
  });
  it('unwraps ephemeral texts and uses both native and Evolution-flattened quote metadata', () => {
    const payload = inbound({
      ephemeralMessage: {
        message: {
          extendedTextMessage: { text: '/spät 10', contextInfo: { stanzaId: 'late-prompt' } },
        },
      },
    });
    expect(normalizeWebhook(payload, 'tt-test', now)[0]).toMatchObject({
      text: '/spät 10',
      quotedId: 'late-prompt',
    });
    expect(
      normalizeWebhook(
        { ...inbound(), data: { ...inbound().data, contextInfo: { stanzaId: 'invitation' } } },
        'tt-test',
        now,
      )[0].quotedId,
    ).toBe('invitation');
  });
  it('joins only explicit phone/LID sender aliases and refuses conflicting phone aliases', () => {
    const payload = inbound();
    const lid = {
      ...payload,
      data: {
        ...payload.data,
        key: {
          ...payload.data.key,
          participant: '123456:8@lid',
          participantAlt: '491701234567@s.whatsapp.net',
        },
      },
    };
    expect(normalizeWebhook(lid, 'tt-test', now)[0]).toMatchObject({
      senderJid: '491701234567@s.whatsapp.net',
      aliases: ['123456@lid', '491701234567@s.whatsapp.net'],
    });
    const unresolved = {
      ...lid,
      data: { ...lid.data, key: { ...lid.data.key, participantAlt: undefined } },
    };
    expect(normalizeWebhook(unresolved, 'tt-test', now)[0].senderJid).toBe('123456@lid');
    const conflicting = {
      ...lid,
      data: { ...lid.data, key: { ...lid.data.key, participant: '491708888888@s.whatsapp.net' } },
    };
    expect(normalizeWebhook(conflicting, 'tt-test', now)).toEqual([]);
  });
  it('normalizes only correctly scoped connection and membership events', () => {
    expect(
      normalizeControlWebhook(
        { instance: 'tt-test', event: 'connection.update', data: { state: 'open' } },
        'tt-test',
      ),
    ).toEqual([{ kind: 'connection', state: 'open' }]);
    expect(
      normalizeControlWebhook(
        {
          instance: 'tt-test',
          event: 'group-participants.update',
          data: {
            id: '120363123456@g.us',
            action: 'remove',
            participants: ['491701234567@s.whatsapp.net'],
          },
        },
        'tt-test',
      ),
    ).toEqual([
      {
        kind: 'membership',
        chatJid: '120363123456@g.us',
        action: 'remove',
        participants: ['491701234567@s.whatsapp.net'],
      },
    ]);
    expect(
      normalizeControlWebhook(
        { instance: 'foreign', event: 'connection.update', data: { state: 'open' } },
        'tt-test',
      ),
    ).toEqual([]);
  });
});

describe('Evolution transport', () => {
  const client = (fetcher: typeof fetch, timeoutMs = 1000) =>
    new EvolutionClient({
      url: 'https://evolution.example',
      instance: 'tt-test',
      apiKey: 'hidden-api-key',
      fetch: fetcher,
      timeoutMs,
    });
  it('binds the native Worker fetch receiver when no custom fetch is injected', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response(JSON.stringify({ key: { id: 'bound-fetch-id' } })));
    };
    try {
      await expect(
        new EvolutionClient({
          url: 'https://evolution.example',
          instance: 'tt-test',
          apiKey: 'hidden-api-key',
        }).sendText('491701234567@s.whatsapp.net', 'Hallo'),
      ).resolves.toEqual({ id: 'bound-fetch-id' });
    } finally {
      globalThis.fetch = original;
    }
  });
  it('sends the verified text/contact contracts and returns only the message ID', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ key: { id: 'sent-1' }, apikey: 'secret' }), { status: 201 }),
      );
    await expect(client(fetcher).sendText('120363123456@g.us', 'Hallo')).resolves.toEqual({
      id: 'sent-1',
    });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://evolution.example/message/sendText/tt-test');
    expect(request?.redirect).toBe('manual');
    expect(JSON.parse(String(request?.body))).toEqual({
      number: '120363123456@g.us',
      text: 'Hallo',
      linkPreview: false,
    });
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ key: { id: 'reaction-1' } }), { status: 201 }),
    );
    await client(fetcher).sendReaction('120363123456@g.us', 'sent-1', '⏰');
    expect(fetcher.mock.calls[1][0]).toBe('https://evolution.example/message/sendReaction/tt-test');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      key: { remoteJid: '120363123456@g.us', id: 'sent-1', fromMe: true },
      reaction: '⏰',
    });
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ key: { id: 'contact-1' } }), { status: 201 }),
    );
    await client(fetcher).sendContact('491701234567@s.whatsapp.net', 'TT', '+491709999999');
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body)).contact[0]).toEqual({
      fullName: 'TT',
      wuid: '491709999999',
      phoneNumber: '+491709999999',
    });
  });
  it.each([
    [429, 'retryable'],
    [400, 'permanent'],
    [401, 'permanent'],
    [500, 'ambiguous'],
    [503, 'ambiguous'],
    [408, 'ambiguous'],
  ])('classifies HTTP %d send as %s', async (status, kind) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('secret server body', { status, headers: { 'Retry-After': '2' } }),
      );
    try {
      await client(fetcher).sendText('491701234567@s.whatsapp.net', 'Hallo');
      expect.fail('must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(TransportError);
      expect(error).toMatchObject({ kind, status, retryAfterMs: 2000 });
      expect(String(error)).not.toMatch(/hidden-api-key|secret server body|491701234567/);
    }
  });
  it('marks network failure and missing send IDs as ambiguous and never retries inside adapter', async () => {
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret upstream error'));
    await expect(
      client(network).sendText('491701234567@s.whatsapp.net', 'Hallo'),
    ).rejects.toMatchObject({ kind: 'ambiguous' });
    expect(network).toHaveBeenCalledTimes(1);
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(
      client(malformed).sendText('491701234567@s.whatsapp.net', 'Hallo'),
    ).rejects.toMatchObject({ kind: 'ambiguous' });
  });
  it('aborts hung sends within the configured bounded timeout', async () => {
    const fetcher: typeof fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    await expect(
      client(fetcher, 100).sendText('491701234567@s.whatsapp.net', 'Hallo'),
    ).rejects.toMatchObject({ kind: 'ambiguous' });
  });
  it('fetches read-only state and groups through the expected paths', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ instance: { state: 'open' } })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: '120363123456@g.us',
              subject: 'TT',
              participants: [{ id: '491701234567@s.whatsapp.net', admin: 'admin' }],
            },
          ]),
        ),
      );
    const adapter = client(fetcher);
    await expect(adapter.connectionState()).resolves.toEqual({ state: 'open' });
    await expect(adapter.fetchGroups()).resolves.toMatchObject([
      { id: '120363123456@g.us', subject: 'TT' },
    ]);
    expect(fetcher.mock.calls[1][0]).toBe(
      'https://evolution.example/group/fetchAllGroups/tt-test?getParticipants=true',
    );
  });
  it('accepts explicit PN aliases from group metadata without interpreting LID digits as phone numbers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: '120363123456@g.us',
            subject: 'TT',
            participants: [
              { id: '100000001@lid', phoneNumber: '491701234567@s.whatsapp.net' },
              { id: '100000002@lid', phoneNumber: '100000002@lid' },
              { id: '100000003@lid', phoneNumber: '491701234568' },
            ],
          },
        ]),
      ),
    );
    const groups = await client(fetcher).fetchGroups();
    expect(groups[0].participants).toEqual([
      { id: '100000001@lid', aliases: ['491701234567@s.whatsapp.net'] },
      { id: '100000002@lid' },
      { id: '100000003@lid' },
    ]);
  });
});

describe('editing login messages and creating exercise groups', () => {
  it('edits the original private message using the Evolution update contract', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ key: { id: 'edit-envelope' } })),
    );
    const c = new EvolutionClient({
      url: 'https://provider.invalid',
      instance: 'test',
      apiKey: 'fixture',
      fetch: fetcher,
    });
    expect(await c.editMessage('491701234567@s.whatsapp.net', 'original', 'Dein Zugang')).toEqual({
      id: 'original',
    });
    expect(fetcher.mock.calls[0][0]).toBe('https://provider.invalid/chat/updateMessage/test');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      number: '491701234567@s.whatsapp.net',
      key: { remoteJid: '491701234567@s.whatsapp.net', id: 'original', fromMe: true },
      text: 'Dein Zugang',
    });
    await expect(c.editMessage('1234@g.us', 'original', 'x')).rejects.toMatchObject({
      kind: 'permanent',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('validates group creation response and does not guess on ambiguous outcomes', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: '123456@g.us' })),
    );
    const c = new EvolutionClient({
      url: 'https://provider.invalid',
      instance: 'test',
      apiKey: 'fixture',
      fetch: fetcher,
    });
    expect(await c.createGroup('TT Übung', '491701234567')).toEqual({ id: '123456@g.us' });
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
      subject: 'TT Übung',
      participants: ['491701234567'],
    });
    fetcher.mockResolvedValueOnce(new Response('{}'));
    await expect(c.createGroup('TT Übung', '491701234567')).rejects.toMatchObject({
      kind: 'ambiguous',
    });
  });
});
