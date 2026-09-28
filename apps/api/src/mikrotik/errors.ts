/** Transport-level failures (timeout, refused, TLS). The router is considered offline. */
export class RouterConnectionError extends Error {
  readonly kind = 'connection';
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
