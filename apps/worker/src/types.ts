export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  EVOLUTION_URL: string;
  EVOLUTION_INSTANCE: string;
  EVOLUTION_API_KEY: string;
  SOURCE_URL?: string;
}
export interface User {
  id: string;
  jid: string;
  display_name: string;
  registered_at: number | null;
  reminders: number;
  created_at: number;
}
export interface BotContext {
  env: Env;
  user: User;
  chatJid: string;
  isGroup: boolean;
  text: string;
  eventId: string;
  timestamp: number;
  now: number;
  origin: string;
  credentialHash?: string;
}
export type AppBindings = { Bindings: Env };
