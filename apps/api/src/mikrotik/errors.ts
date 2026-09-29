/** Transport-level failures (timeout, refused, TLS). The router is considered offline. */
export class RouterConnectionError extends Error {
  readonly kind = 'connection';
}

/**
 * Human-readable transport error. The most common setup mistake is a TLS/plain mismatch
 * (e.g. "Use TLS" on port 80), which OpenSSL reports as "wrong version number".
 */
export function describeConnectError(host: string, port: number, tls: boolean, e: Error): RouterConnectionError {
  const msg = e.message;
  if (tls && /wrong version number|packet length too long|unknown protocol/i.test(msg)) {
    return new RouterConnectionError(
      `${host}:${port} is not a TLS port. Turn off "Use TLS", or use the TLS port (REST: 443 with www-ssl, API: 8729 with api-ssl).`,
    );
  }
  if (/ECONNREFUSED/.test(msg)) {
    return new RouterConnectionError(`${host}:${port} refused the connection: the service is disabled on the router (IP > Services) or the port is wrong.`);
  }
  return new RouterConnectionError(`${host}:${port} ${msg}`);
}

/** Credentials rejected by the router. */
export class RouterAuthError extends Error {
  readonly kind = 'auth';
}

/** The router understood the request and refused it (e.g. "!trap: input does not match any value of protocol"). */
export class RouterCommandError extends Error {
  readonly kind = 'command';
}

export class RouterNotFoundError extends Error {
  readonly kind = 'not-found';
}

export type RouterError = RouterConnectionError | RouterAuthError | RouterCommandError | RouterNotFoundError;

export function isRouterError(e: unknown): e is RouterError {
  return (
    e instanceof RouterConnectionError ||
    e instanceof RouterAuthError ||
    e instanceof RouterCommandError ||
    e instanceof RouterNotFoundError
  );
}
