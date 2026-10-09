import { describe, expect, it } from 'vitest';
import { normalizeWebhook, normalizeControlWebhook } from '@tt/whatsapp';

const now = Date.parse('2026-10-09T16:00:00Z'),
  instance = 'fixture',
  code = 'AbCdEfGhIjKlMnOpQrStUv';
function native(invite: Record<string, unknown>) {
  return {
    instance,
    event: 'messages.upsert',
    data: {
      key: { id: 'native-invite', fromMe: false, remoteJid: '491701234567@s.whatsapp.net' },
      messageTimestamp: now / 1000,
      message: { groupInviteMessage: invite },
    },
  };
}
describe('WhatsApp invitation discovery envelopes', () => {
  it('turns a private native invite into a review-only link without trusting groupJid/name', () => {
    expect(
      normalizeWebhook(
        native({
          inviteCode: code,
          groupJid: 'forged@g.us',
          groupName: 'untrusted',
          inviteExpiration: now / 1000 + 3600,
        }),
        instance,
        now,
      )[0],
    ).toMatchObject({ isGroup: false, text: `https://chat.whatsapp.com/${code}` });
  });
  it('ignores expired and malformed native invites and never follows native invite metadata', () => {
    expect(
      normalizeWebhook(
        native({ inviteCode: code, inviteExpiration: now / 1000 - 1 }),
        instance,
        now,
      ),
    ).toEqual([]);
    expect(
      normalizeWebhook(native({ inviteCode: 'https://attacker.test' }), instance, now),
    ).toEqual([]);
  });
  it('normalizes group upserts into discovery-only controls with no fabricated membership', () => {
    expect(
      normalizeControlWebhook(
        {
          instance,
          event: 'groups.upsert',
          data: [
            { id: '120363123456@g.us', participants: [{ id: '491701234567@s.whatsapp.net' }] },
            { id: 'invalid' },
          ],
        },
        instance,
      ),
    ).toEqual([
      { kind: 'membership', chatJid: '120363123456@g.us', action: 'add', participants: [] },
    ]);
    expect(
      normalizeControlWebhook(
        { instance: 'wrong', event: 'groups.upsert', data: [{ id: '120363123456@g.us' }] },
        instance,
      ),
    ).toEqual([]);
  });
});
