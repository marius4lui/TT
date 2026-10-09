import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { testDb } from './helpers/db';
import { resolveUser } from '../apps/worker/src/auth';
import { hashToken } from '../apps/worker/src/security';
import {
  inviteCode,
  requestGroupLink,
  approveGroupRequest,
  observeBotGroup,
  registerGroupRequestRoutes,
} from '../apps/worker/src/group-requests';
import type { Env, AppBindings, User } from '../apps/worker/src/types';
import type { EvolutionClient } from '@tt/whatsapp';

let db: ReturnType<typeof testDb>, env: Env, owner: User, member: User, now: number;
const bot = '491701111111@s.whatsapp.net',
  group = '120363123456@g.us',
  code = 'AbCdEfGhIjKlMnOpQrStUv';
const origin = 'https://tt.bz3.eu',
  link = `https://chat.whatsapp.com/${code}`;
function provider() {
  return {
    inviteInfo: vi.fn(async () => ({ id: group, subject: 'TT Test' })),
    acceptInvite: vi.fn(async () => group),
    fetchGroups: vi.fn(async () => [
      { id: group, subject: 'TT Test', participants: [{ id: bot }, { id: member.jid }] },
    ]),
  };
}
type FakeProvider = ReturnType<typeof provider>;
const client = (p: FakeProvider) => p as unknown as EvolutionClient;
const trainer = () => ({ user: owner, role: 'owner' as const, authenticatedAt: now });
beforeEach(async () => {
  db = testDb();
  now = Date.now();
  env = {
    DB: db,
    ASSETS: {} as Fetcher,
    EVOLUTION_URL: 'https://fixture.invalid',
    EVOLUTION_INSTANCE: 'fixture',
    EVOLUTION_API_KEY: 'fixture',
  };
  owner = (await resolveUser(env, '491701234567@s.whatsapp.net', [], 'Trainer', now))!;
  member = (await resolveUser(env, '491701234568@s.whatsapp.net', [], 'Member', now))!;
  await db
    .prepare("INSERT INTO roles(user_id,role,created_at) VALUES(?,'admin',?)")
    .bind(owner.id, now)
    .run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('bot_jid',?)").bind(bot).run();
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
describe('explicit web group approval', () => {
  it.each([
    'http://chat.whatsapp.com/' + code,
    'https://chat.whatsapp.com.evil.test/' + code,
    'https://evil.test/' + code,
    'https://user@chat.whatsapp.com/' + code,
    'https://chat.whatsapp.com/' + code + '/suffix',
    'https://chat.whatsapp.com/' + code + '#fragment',
    'https://chat.whatsapp.com/short',
  ])('rejects noncanonical invitation %s', (url) => expect(inviteCode(url)).toBeNull());
  it('records metadata without joining, deduplicates and never returns invitation secrets in listing', async () => {
    const p = provider();
    const id = await requestGroupLink(env, member.id, link, now, client(p));
    expect(await requestGroupLink(env, member.id, link, now + 1, client(p))).toBe(id);
    expect(p.acceptInvite).not.toHaveBeenCalled();
    expect(p.inviteInfo).toHaveBeenCalledTimes(1);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM groups').first('n')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM outbox_jobs').first('n')).toBe(1);
    const app = new Hono<AppBindings>();
    registerGroupRequestRoutes(app);
    const token = 'a'.repeat(64);
    await db
      .prepare(
        'INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,last_seen_at,expires_at) VALUES(?,?,?,?,?)',
      )
      .bind(await hashToken(token), owner.id, now, now, now + 60000)
      .run();
    const res = await app.request(
      origin + '/api/v1/trainer/group-requests',
      { headers: { Cookie: `__Host-tt-session=${token}` } },
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('TT Test');
    expect(text).not.toContain(code);
  });
  it('requires explicit confirmation and current trainer role, rejecting cross-site writes', async () => {
    const p = provider(),
      id = await requestGroupLink(env, member.id, link, now, client(p));
    const app = new Hono<AppBindings>();
    registerGroupRequestRoutes(app);
    const path = origin + `/api/v1/trainer/group-requests/${id}/approve`,
      token = 'a'.repeat(64);
    expect(
      (
        await app.request(
          path,
          { method: 'POST', headers: { Origin: origin }, body: '{"confirm":true}' },
          env,
        )
      ).status,
    ).toBe(401);
    await db
      .prepare(
        'INSERT INTO auth_sessions(token_hash,user_id,authenticated_at,last_seen_at,expires_at) VALUES(?,?,?,?,?)',
      )
      .bind(await hashToken(token), owner.id, now, now, now + 60000)
      .run();
    const headers = {
      Origin: origin,
      Cookie: `__Host-tt-session=${token}`,
      'Content-Type': 'application/json',
    };
    expect((await app.request(path, { method: 'POST', headers, body: '{}' }, env)).status).toBe(
      400,
    );
    expect(
      (
        await app.request(
          path,
          {
            method: 'POST',
            headers: { ...headers, Origin: 'https://attacker.invalid' },
            body: '{"confirm":true}',
          },
          env,
        )
      ).status,
    ).toBe(403);
    await db.prepare('UPDATE users SET registered_at=? WHERE id=?').bind(now, owner.id).run();
    await db.prepare('DELETE FROM roles WHERE user_id=?').bind(owner.id).run();
    expect(
      (await app.request(path, { method: 'POST', headers, body: '{"confirm":true}' }, env)).status,
    ).toBe(403);
    expect(p.acceptInvite).not.toHaveBeenCalled();
  });
  it('approves once, verifies bot membership and synchronizes authenticated PN/LID aliases', async () => {
    const p = provider(),
      id = await requestGroupLink(env, member.id, link, now, client(p));
    await approveGroupRequest(env, id, trainer(), false, now + 1, client(p));
    await approveGroupRequest(env, id, trainer(), false, now + 2, client(p));
    expect(p.acceptInvite).toHaveBeenCalledTimes(1);
    expect(
      await db.prepare('SELECT active FROM groups WHERE jid=?').bind(group).first('active'),
    ).toBe(1);
    expect(
      await db
        .prepare('SELECT active FROM memberships WHERE group_jid=? AND user_id=?')
        .bind(group, member.id)
        .first('active'),
    ).toBe(1);
    expect(
      await db.prepare('SELECT invite_code,status FROM group_requests WHERE id=?').bind(id).first(),
    ).toEqual({ invite_code: null, status: 'approved' });
  });
  it('does not retry an uncertain provider join; reconciliation only checks membership', async () => {
    const p = provider(),
      id = await requestGroupLink(env, member.id, link, now, client(p));
    p.acceptInvite.mockRejectedValueOnce(new Error('ambiguous'));
    await expect(
      approveGroupRequest(env, id, trainer(), false, now + 1, client(p)),
    ).rejects.toThrow('approval_unconfirmed');
    await expect(
      approveGroupRequest(env, id, trainer(), false, now + 2, client(p)),
    ).rejects.toThrow('request_changed');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM groups').first('n')).toBe(0);
    await approveGroupRequest(env, id, trainer(), true, now + 3, client(p));
    expect(p.acceptInvite).toHaveBeenCalledTimes(1);
    expect(
      await db.prepare('SELECT status FROM group_requests WHERE id=?').bind(id).first('status'),
    ).toBe('approved');
  });
  it('fails closed if role is revoked while provider accepts the invite', async () => {
    const p = provider(),
      id = await requestGroupLink(env, member.id, link, now, client(p));
    p.acceptInvite.mockImplementationOnce(async () => {
      await db.prepare('DELETE FROM roles WHERE user_id=?').bind(owner.id).run();
      return group;
    });
    await expect(
      approveGroupRequest(env, id, trainer(), false, now + 1, client(p)),
    ).rejects.toThrow();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM groups').first('n')).toBe(0);
  });
  it('rejects a changed invite target before joining', async () => {
    const p = provider(),
      id = await requestGroupLink(env, member.id, link, now, client(p));
    p.inviteInfo.mockResolvedValueOnce({ id: '120363999999@g.us', subject: 'Changed' });
    await expect(
      approveGroupRequest(env, id, trainer(), false, now + 1, client(p)),
    ).rejects.toThrow('invite_changed');
    expect(p.acceptInvite).not.toHaveBeenCalled();
  });
  it('new group membership only creates a pending request until explicitly approved', async () => {
    const p = provider();
    await observeBotGroup(env, group, now, client(p));
    await observeBotGroup(env, group, now + 1, client(p));
    expect(await db.prepare('SELECT COUNT(*) AS n FROM groups').first('n')).toBe(0);
    const row = await db
      .prepare('SELECT id,status,source FROM group_requests')
      .first<{ id: string; status: string; source: string }>();
    expect(row).toMatchObject({ status: 'pending', source: 'membership' });
    await approveGroupRequest(env, row!.id, trainer(), false, now + 2, client(p));
    expect(p.acceptInvite).not.toHaveBeenCalled();
    expect(await db.prepare('SELECT active FROM groups').first('active')).toBe(1);
  });
  it('does not discover arbitrary groups without authoritative bot membership', async () => {
    const p = provider();
    p.fetchGroups.mockResolvedValueOnce([
      { id: group, subject: 'Other', participants: [{ id: member.jid }] },
    ]);
    await observeBotGroup(env, group, now, client(p));
    expect(await db.prepare('SELECT COUNT(*) AS n FROM group_requests').first('n')).toBe(0);
  });
});
