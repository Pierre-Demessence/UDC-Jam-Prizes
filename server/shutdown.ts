/**
 * Graceful shutdown.
 *
 * A deploy sends SIGTERM and the Deployment waits 30 s before the pod is killed,
 * so the process should stop taking new connections, let the requests already in
 * flight finish, then close the database and exit — rather than cutting a response
 * in half. `closeIdleConnections` is what keeps an idle keep-alive socket from
 * holding the server open; http2 has no equivalent, hence the optional methods —
 * hono's `serve` may return either kind of server.
 */

/** The parts of a Node server this needs. */
export interface ClosableServer {
  close: (callback: () => void) => void;
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
}

export interface ShutdownOptions {
  /** Runs once, when the wait is over: close the database, then exit. */
  finish: () => void;
  /** How long in-flight requests get before they are cut off. */
  graceMs?: number;
  server: ClosableServer;
}

const DEFAULT_GRACE_MS = 10_000;

/**
 * Returns the signal handler: the first call shuts down gracefully, a second one
 * gives up on whatever is left instead of waiting again. Safe to register for
 * both SIGINT and SIGTERM.
 */
export function gracefulShutdown({ finish, graceMs = DEFAULT_GRACE_MS, server }: ShutdownOptions): () => void {
  let called = false;
  let finished = false;
  let timer: NodeJS.Timeout | undefined;

  function done(): void {
    if (finished)
      return;

    finished = true;
    clearTimeout(timer);
    finish();
  }

  return function shutdown(): void {
    if (called) {
      // A second signal means now: drop the connections still open.
      server.closeAllConnections?.();
      done();
      return;
    }

    called = true;
    // A backstop, not a delay: the server's own callback usually fires first.
    timer = setTimeout(() => {
      server.closeAllConnections?.();
      done();
    }, graceMs);

    server.close(done);
    server.closeIdleConnections?.();
  };
}
