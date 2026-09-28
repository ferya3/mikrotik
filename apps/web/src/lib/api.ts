/**
 * Thin fetch wrapper for the NestJS API. The session lives in an httpOnly cookie, so no token
 * is ever handled by JavaScript; state-changing requests carry the CSRF header the API requires.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

const CSRF_HEADER = { 'X-Requested-With': 'mikrotik-nms' };

function messageOf(body: unknown, status: number): string {
  const m = (body as { message?: unknown } | undefined)?.message;
  if (Array.isArray(m)) return m.join('; ');
  if (typeof m === 'string') return m;
  return `Request failed (${status})`;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(method !== 'GET' ? CSRF_HEADER : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/login?next=${next}`;
  }
  if (!res.ok) throw new ApiError(res.status, messageOf(body, res.status), body);
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
