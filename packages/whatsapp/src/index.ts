type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
const string = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export interface MessageEvent {
  id: string;
  chatJid: string;
  senderJid: string;
  aliases: string[];
  displayName: string;
  timestamp: number;
  isGroup: boolean;
  text?: string;
  reaction?: { targetId: string; emoji: string };
  quotedId?: string;
}

export type ConnectionState = 'open' | 'close' | 'connecting' | 'unknown';
export type ControlEvent =
  | { kind: 'connection'; state: ConnectionState }
  | {
      kind: 'membership';
      chatJid: string;
      action: 'add' | 'remove' | 'promote' | 'demote';
      participants: string[];
    };

function eventName(value: unknown): string | undefined {
  return string(value)?.toUpperCase().replace(/[.-]/g, '_');
}

/** A device suffix is not a separate account. Never derive a phone number from a LID. */
export function normalizeJid(value: unknown): string | undefined {
  const jid = string(value);
  if (!jid || jid.length > 100) return undefined;
  if (/^\d+(?:-\d+)?@g\.us$/.test(jid)) return jid;
  if (/^\d+(?::\d+)?@(?:s\.whatsapp\.net|lid)$/.test(jid)) return jid.replace(/:\d+@/, '@');
  return undefined;
}

function senderIdentity(
  primary: unknown,
  alternate: unknown,
): { senderJid: string; aliases: string[] } | undefined {
  const main = normalizeJid(primary);
  if (!main || main.endsWith('@g.us')) return undefined;
  const alt = normalizeJid(alternate);
  if (alt && !alt.endsWith('@g.us') && alt !== main) {
    // Only the explicit phone/LID pair supplied on the outer sender key can be joined.
    // Conflicting phone/phone or LID/LID pairs are rejected, not guessed.
    if (main.endsWith('@lid') === alt.endsWith('@lid')) return undefined;
    return { senderJid: main.endsWith('@lid') ? alt : main, aliases: [main, alt] };
  }
  return { senderJid: main, aliases: [main] };
}

function unwrap(message: unknown): JsonObject | undefined {
  let current = object(message);
  for (let depth = 0; depth < 5 && current; depth++) {
    const wrapper =
      object(current.ephemeralMessage) ??
      object(current.viewOnceMessage) ??
      object(current.viewOnceMessageV2) ??
      object(current.viewOnceMessageV2Extension) ??
      object(current.documentWithCaptionMessage);
    if (!wrapper) return current;
    current = object(wrapper.message);
  }
  return undefined;
}

function timestampMs(value: unknown): number | undefined {
  const scalar = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  let number = typeof scalar === 'number' ? scalar : undefined;
  const long = object(value);
  if (
    number === undefined &&
    long &&
    typeof long.low === 'number' &&
    typeof long.high === 'number'
  ) {
    number = (long.high >>> 0) * 4294967296 + (long.low >>> 0);
  }
  if (number === undefined || !Number.isFinite(number) || number <= 0) return undefined;
  const ms = number < 100_000_000_000 ? number * 1000 : number;
  return Number.isSafeInteger(ms) ? ms : undefined;
}

/** Accept current inbound upserts only. Authentication and active-group checks belong to the Worker. */
export function normalizeWebhook(
  payload: unknown,
  instance: string,
  now = Date.now(),
): MessageEvent[] {
  const envelope = object(payload);
  if (
    !envelope ||
    envelope.instance !== instance ||
    eventName(envelope.event) !== 'MESSAGES_UPSERT'
  )
    return [];
  const data = object(envelope.data);
  if (
    envelope.type === 'append' ||
    data?.type === 'append' ||
    envelope.isHistory === true ||
    data?.isHistory === true
  )
    return [];
  const items = Array.isArray(envelope.data)
    ? envelope.data
    : Array.isArray(data?.messages)
      ? data.messages
      : [envelope.data];
  const events: MessageEvent[] = [];
  for (const item of items.slice(0, 100)) {
    const raw = object(item);
    const key = object(raw?.key);
    if (!raw || !key || key.fromMe !== false || raw.type === 'append' || raw.isHistory === true)
      continue;
    const id = string(key.id);
    const chatJid = normalizeJid(key.remoteJid);
    if (!id || id.length > 200 || !chatJid) continue;
    const isGroup = chatJid.endsWith('@g.us');
    const identity = senderIdentity(
      isGroup ? key.participant : key.remoteJid,
      isGroup ? key.participantAlt : key.remoteJidAlt,
    );
    if (!identity) continue;
    const timestamp = timestampMs(raw.messageTimestamp);
    // Historic batches can lack the original append marker; refuse stale or future action replays.
    if (
      timestamp === undefined ||
      timestamp < now - 24 * 60 * 60_000 ||
      timestamp > now + 5 * 60_000
    )
      continue;
    const message = unwrap(raw.message);
    if (!message || message.protocolMessage || message.editedMessage) continue;
    const reaction = object(message.reactionMessage);
    const extended = object(message.extendedTextMessage);
    const nativeInvite = object(message.groupInviteMessage);
    const inviteCode = string(nativeInvite?.inviteCode);
    const inviteExpiry = timestampMs(nativeInvite?.inviteExpiration);
    const text =
      string(message.conversation) ??
      string(extended?.text) ??
      (!isGroup &&
      inviteCode &&
      /^[a-zA-Z0-9_-]{20,64}$/.test(inviteCode) &&
      (!inviteExpiry || inviteExpiry > now)
        ? `https://chat.whatsapp.com/${inviteCode}`
        : undefined);
    const result: MessageEvent = {
      id,
      chatJid: isGroup ? chatJid : identity.senderJid,
      ...identity,
      displayName: (string(raw.pushName) ?? '').slice(0, 100),
      timestamp,
      isGroup,
    };
    if (reaction) {
      const target = object(reaction.key);
      const targetId = string(target?.id);
      const emoji = string(reaction.text);
      // Target key.fromMe can be true: it describes the invitation, not the reacting user.
      const targetChat = normalizeJid(target?.remoteJid);
      if (
        !targetId ||
        targetId.length > 200 ||
        emoji === undefined ||
        emoji.length > 32 ||
        (targetChat && targetChat !== chatJid && targetChat !== identity.senderJid)
      )
        continue;
      result.reaction = { targetId, emoji };
    } else {
      if (text === undefined || text.length > 8_000) continue;
      result.text = text;
      const context =
        object(extended?.contextInfo) ??
        object(raw.contextInfo) ??
        object(message.messageContextInfo);
      const quotedId = string(context?.stanzaId);
      if (quotedId && quotedId.length <= 200) result.quotedId = quotedId;
    }
    events.push(result);
  }
  return events;
}

const connection = (value: unknown): ConnectionState =>
  value === 'open' || value === 'close' || value === 'connecting' ? value : 'unknown';

export function normalizeControlWebhook(payload: unknown, instance: string): ControlEvent[] {
  const envelope = object(payload);
  if (!envelope || envelope.instance !== instance) return [];
  if (eventName(envelope.event) === 'GROUPS_UPSERT' && Array.isArray(envelope.data)) {
    // Discovery only: Worker verifies current bot membership and requires web approval.
    return envelope.data.slice(0, 100).flatMap((raw) => {
      const chatJid = normalizeJid(object(raw)?.id);
      return chatJid?.endsWith('@g.us')
        ? [{ kind: 'membership' as const, chatJid, action: 'add' as const, participants: [] }]
        : [];
    });
  }
  const data = object(envelope.data);
  if (!data) return [];
  if (eventName(envelope.event) === 'CONNECTION_UPDATE')
    return [{ kind: 'connection', state: connection(data.state) }];
  if (eventName(envelope.event) !== 'GROUP_PARTICIPANTS_UPDATE') return [];
  const chatJid = normalizeJid(data.id);
  const action = data.action;
  if (
    !chatJid?.endsWith('@g.us') ||
    !['add', 'remove', 'promote', 'demote'].includes(String(action)) ||
    !Array.isArray(data.participants)
  )
    return [];
  const participants = data.participants
    .map((item) => normalizeJid(typeof item === 'string' ? item : object(item)?.id))
    .filter((item): item is string => !!item && !item.endsWith('@g.us'));
  return [
    {
      kind: 'membership',
      chatJid,
      action: action as 'add' | 'remove' | 'promote' | 'demote',
      participants,
    },
  ];
}

export type TransportErrorKind = 'retryable' | 'ambiguous' | 'permanent';
export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(kind: TransportErrorKind, status?: number, retryAfterMs?: number) {
    // Intentionally exclude upstream body, URL, apiKey, contact details and caught error messages.
    super(`Evolution request ${kind}${status === undefined ? '' : ` (${status})`}`);
    this.name = 'TransportError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface EvolutionGroup {
  id: string;
  subject: string;
  participants: { id: string; aliases?: string[]; admin?: 'admin' | 'superadmin' | null }[];
}
export interface EvolutionConfig {
  url: string;
  instance: string;
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class EvolutionClient {
  private readonly base: string;
  private readonly instance: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;
  constructor(config: EvolutionConfig) {
    const url = new URL(config.url);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid Evolution URL');
    if (!config.instance || !config.apiKey) throw new Error('Missing Evolution configuration');
    this.base = url.toString().replace(/\/$/, '');
    this.instance = encodeURIComponent(config.instance);
    this.apiKey = config.apiKey;
    this.timeoutMs = Math.max(100, Math.min(config.timeoutMs ?? 10_000, 30_000));
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const sending = body !== undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.base}${path}`, {
        method: sending ? 'POST' : 'GET',
        headers: {
          apikey: this.apiKey,
          ...(sending ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(sending ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
        signal: controller.signal,
      });
      if (!response.ok) {
        const rawRetry = response.headers.get('Retry-After');
        const numericRetry =
          rawRetry && /^\d+(?:\.\d+)?$/.test(rawRetry) ? Number(rawRetry) * 1000 : undefined;
        const dateRetry = rawRetry ? Date.parse(rawRetry) - Date.now() : undefined;
        const retry =
          numericRetry ??
          (dateRetry !== undefined && Number.isFinite(dateRetry) ? dateRetry : undefined);
        const retryAfterMs =
          retry === undefined ? undefined : Math.max(1000, Math.min(retry, 60 * 60_000));
        const kind: TransportErrorKind =
          response.status === 429
            ? 'retryable'
            : response.status >= 500 || response.status === 408
              ? sending
                ? 'ambiguous'
                : 'retryable'
              : 'permanent';
        throw new TransportError(kind, response.status, retryAfterMs);
      }
      try {
        return await response.json();
      } catch {
        throw new TransportError(sending ? 'ambiguous' : 'permanent', response.status);
      }
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError(sending ? 'ambiguous' : 'retryable');
    } finally {
      clearTimeout(timer);
    }
  }

  private async send(path: string, body: unknown): Promise<{ id: string }> {
    const result = object(await this.request(path, body));
    const id = string(object(result?.key)?.id);
    if (!id) throw new TransportError('ambiguous');
    return { id };
  }

  async sendText(chatJid: string, text: string): Promise<{ id: string }> {
    if (!normalizeJid(chatJid) || !text || text.length > 8000)
      throw new TransportError('permanent');
    return this.send(`/message/sendText/${this.instance}`, {
      number: chatJid,
      text,
      linkPreview: false,
    });
  }

  async editMessage(chatJid: string, messageId: string, text: string): Promise<{ id: string }> {
    if (
      !normalizeJid(chatJid) ||
      chatJid.endsWith('@g.us') ||
      !messageId ||
      messageId.length > 200 ||
      !text ||
      text.length > 8000
    )
      throw new TransportError('permanent');
    await this.send(`/chat/updateMessage/${this.instance}`, {
      number: chatJid,
      key: { remoteJid: chatJid, id: messageId, fromMe: true },
      text,
    });
    return { id: messageId };
  }

  async sendContact(chatJid: string, name: string, phone: string): Promise<{ id: string }> {
    const digits = phone.replace(/^\+/, '');
    if (!normalizeJid(chatJid) || !name || !/^\d{7,15}$/.test(digits))
      throw new TransportError('permanent');
    return this.send(`/message/sendContact/${this.instance}`, {
      number: chatJid,
      contact: [{ fullName: name, wuid: digits, phoneNumber: `+${digits}` }],
    });
  }

  async sendReaction(chatJid: string, messageId: string, emoji: string): Promise<{ id: string }> {
    if (!normalizeJid(chatJid) || !messageId || messageId.length > 200 || emoji !== '⏰')
      throw new TransportError('permanent');
    return this.send(`/message/sendReaction/${this.instance}`, {
      key: { remoteJid: chatJid, id: messageId, fromMe: true },
      reaction: emoji,
    });
  }

  async connectionState(): Promise<{ state: ConnectionState }> {
    const result = object(await this.request(`/instance/connectionState/${this.instance}`));
    return { state: connection(object(result?.instance)?.state ?? result?.state) };
  }

  async createGroup(subject: string, phone: string): Promise<{ id: string }> {
    if (!subject || subject.length > 100 || !/^\d{7,15}$/.test(phone))
      throw new TransportError('permanent');
    const result = object(
      await this.request(`/group/create/${this.instance}`, {
        subject,
        participants: [phone],
        description:
          'TT-Übungsgruppe. Rückmeldungen werden nur für Übungen verarbeitet und nach spätestens 24 Stunden gelöscht. Keine echten Trainingstermine. Bitte nur informierte Testpersonen hinzufügen.',
      }),
    );
    const id = normalizeJid(result?.id);
    if (!id?.endsWith('@g.us')) throw new TransportError('ambiguous');
    return { id };
  }

  async fetchGroups(): Promise<EvolutionGroup[]> {
    const result = await this.request(
      `/group/fetchAllGroups/${this.instance}?getParticipants=true`,
    );
    if (!Array.isArray(result)) throw new TransportError('permanent');
    return result.flatMap((item) => {
      const group = object(item);
      const id = normalizeJid(group?.id);
      if (!group || !id?.endsWith('@g.us')) return [];
      const participants: EvolutionGroup['participants'] = Array.isArray(group.participants)
        ? group.participants.flatMap((value): EvolutionGroup['participants'] => {
            const participant = object(value);
            const jid = normalizeJid(participant?.id);
            if (!jid || jid.endsWith('@g.us')) return [];
            const admin = participant?.admin;
            const phone = normalizeJid(participant?.phoneNumber);
            return [
              {
                id: jid,
                // Current group metadata explicitly links LID and PN. Never infer a PN from LID digits.
                ...(jid.endsWith('@lid') && phone?.endsWith('@s.whatsapp.net')
                  ? { aliases: [phone] }
                  : {}),
                ...(admin === 'admin' || admin === 'superadmin' || admin === null ? { admin } : {}),
              },
            ];
          })
        : [];
      return [{ id, subject: string(group.subject) ?? '', participants }];
    });
  }

  async webhookConfig(): Promise<JsonObject> {
    return object(await this.request(`/webhook/find/${this.instance}`)) ?? {};
  }

  async inviteInfo(code: string): Promise<{ id: string; subject: string }> {
    if (!/^[a-zA-Z0-9_-]{20,64}$/.test(code)) throw new TransportError('permanent');
    const result = object(
      await this.request(
        `/group/inviteInfo/${this.instance}?inviteCode=${encodeURIComponent(code)}`,
      ),
    );
    const id = normalizeJid(result?.id);
    if (!id?.endsWith('@g.us')) throw new TransportError('permanent');
    return { id, subject: (string(result?.subject) ?? 'WhatsApp-Gruppe').slice(0, 200) };
  }

  async acceptInvite(code: string): Promise<string> {
    if (!/^[a-zA-Z0-9_-]{20,64}$/.test(code)) throw new TransportError('permanent');
    // Evolution exposes this mutation as GET. Never retry after an uncertain result.
    try {
      const result = object(
        await this.request(
          `/group/acceptInviteCode/${this.instance}?inviteCode=${encodeURIComponent(code)}`,
        ),
      );
      const jid = normalizeJid(result?.groupJid);
      if (result?.accepted !== true || !jid?.endsWith('@g.us'))
        throw new TransportError('ambiguous');
      return jid;
    } catch {
      throw new TransportError('ambiguous');
    }
  }

  async settings(): Promise<JsonObject> {
    return object(await this.request(`/settings/find/${this.instance}`)) ?? {};
  }

  async fetchInstances(): Promise<unknown> {
    return this.request(`/instance/fetchInstances?instanceName=${this.instance}`);
  }
}
