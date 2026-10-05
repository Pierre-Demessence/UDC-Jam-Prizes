// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClosableServer } from './shutdown.ts';

import { gracefulShutdown } from './shutdown.ts';

function fakeServer(): {
  calls: string[];
  finishClose: () => void;
  server: ClosableServer;
} {
  const calls: string[] = [];
  let onClose: (() => void) | undefined;

  return {
    calls,
    server: {
      closeAllConnections: () => calls.push('closeAllConnections'),
      closeIdleConnections: () => calls.push('closeIdleConnections'),
      close: (callback) => {
        calls.push('close');
        onClose = callback;
      },
    },
    finishClose: () => onClose?.(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('graceful shutdown', () => {
  it('stops accepting, closes the idle connections, and does not finish yet', () => {
    const { calls, server } = fakeServer();
    const finish = vi.fn();

    gracefulShutdown({ finish, server })();

    expect(calls).toEqual(['close', 'closeIdleConnections']);
    expect(finish).not.toHaveBeenCalled();
  });

  it('finishes when the requests in flight are done', () => {
    const { finishClose, server } = fakeServer();
    const finish = vi.fn();

    gracefulShutdown({ finish, server })();
    finishClose();

    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('cuts the rest off when the grace runs out', () => {
    vi.useFakeTimers();
    const { calls, server } = fakeServer();
    const finish = vi.fn();

    gracefulShutdown({ finish, graceMs: 1_000, server })();
    vi.advanceTimersByTime(1_000);

    expect(calls).toEqual(['close', 'closeIdleConnections', 'closeAllConnections']);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('finishes only once, even when the requests end after the grace fired', () => {
    vi.useFakeTimers();
    const { finishClose, server } = fakeServer();
    const finish = vi.fn();

    const shutdown = gracefulShutdown({ finish, graceMs: 1_000, server });
    shutdown();
    vi.advanceTimersByTime(1_000);
    finishClose();
    shutdown();

    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('takes a second signal as "now"', () => {
    const { calls, server } = fakeServer();
    const finish = vi.fn();

    const shutdown = gracefulShutdown({ finish, server });
    shutdown();
    shutdown();

    expect(calls).toEqual(['close', 'closeIdleConnections', 'closeAllConnections']);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('works on a server without the idle-connection methods', () => {
    const calls: string[] = [];
    const finish = vi.fn();
    const server: ClosableServer = {
      close: (callback) => {
        calls.push('close');
        callback();
      },
    };

    gracefulShutdown({ finish, server })();

    expect(calls).toEqual(['close']);
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
