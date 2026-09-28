/**
 * Typed, validated environment. The process refuses to start with a missing or weak secret,
 * so a misconfigured deployment fails loudly instead of running insecurely.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  sessionTtlSec: number;
  cookieSecure: boolean;
  corsOrigins: string[];
  ipAllowlist: string[];
  trustProxy: boolean;
  /** Base64 keys by version: CREDENTIALS_KEY_V1, CREDENTIALS_KEY_V2 ... */
  credentialKeys: Map<number, Buffer>;
  activeKeyVersion: number;
  routerTimeoutMs: number;
  pollIntervalMs: number;
  pollConcurrency: number;
  cpuAlertThreshold: number;
  metricsRetentionHours: number;
  metricsToken?: string;
  backupCron: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function int(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadCredentialKeys(): { keys: Map<number, Buffer>; active: number } {
  const keys = new Map<number, Buffer>();
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^CREDENTIALS_KEY_V(\d+)$/.exec(k);
    if (!m || !v) continue;
    const buf = Buffer.from(v, 'base64');
    if (buf.length !== 32) throw new Error(`${k} must be 32 bytes, base64 encoded (openssl rand -base64 32)`);
    keys.set(Number(m[1]), buf);
  }
  if (keys.size === 0) throw new Error('At least one CREDENTIALS_KEY_V<n> must be set');
  const active = int('CREDENTIALS_ACTIVE_KEY_VERSION', Math.max(...keys.keys()));
  if (!keys.has(active)) throw new Error(`CREDENTIALS_ACTIVE_KEY_VERSION=${active} has no matching key`);
  return { keys, active };
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  const { keys, active } = loadCredentialKeys();
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  cached = {
    nodeEnv,
    port: int('PORT', 4000),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    jwtSecret,
    sessionTtlSec: int('SESSION_TTL_SEC', 8 * 3600),
    cookieSecure: (process.env.COOKIE_SECURE ?? (nodeEnv === 'production' ? 'true' : 'false')) === 'true',
    corsOrigins: list('CORS_ORIGINS'),
    ipAllowlist: list('ADMIN_IP_ALLOWLIST'),
    trustProxy: process.env.TRUST_PROXY === 'true',
    credentialKeys: keys,
    activeKeyVersion: active,
    routerTimeoutMs: int('ROUTER_TIMEOUT_MS', 8000),
    pollIntervalMs: int('POLL_INTERVAL_MS', 10000),
    pollConcurrency: int('POLL_CONCURRENCY', 10),
    cpuAlertThreshold: int('CPU_ALERT_THRESHOLD', 90),
    metricsRetentionHours: int('METRICS_RETENTION_HOURS', 24),
    metricsToken: process.env.METRICS_TOKEN || undefined,
    backupCron: process.env.BACKUP_CRON ?? '0 3 * * *',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: process.env.TELEGRAM_CHAT_ID || undefined,
  };
  return cached;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
