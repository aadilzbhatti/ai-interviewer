/**
 * Guarded access to a ReadableStream controller.
 *
 * Once the browser disconnects, the runtime cancels the stream and the
 * controller is dead: `enqueue` and `close` both throw
 * `TypeError: Invalid state: Controller is already closed`. Confirmed
 * directly — a cancelled stream throws on both.
 *
 * That mattered because every route wrote the shape:
 *
 *     } catch (e) {
 *       controller.enqueue(errorNote);   // throws again
 *     } finally {
 *       controller.close();              // throws again
 *       await logDebug(...);             // never runs
 *     }
 *
 * so an interrupted request lost its debug log entry — exactly the evidence
 * you need to work out why it was interrupted. The disconnect itself is normal
 * and expected; losing the record of it is not.
 *
 * `gone` also lets a route stop doing expensive work for a client that left.
 */
export interface GuardedStream {
  /** Enqueues unless the client has gone. Returns false once it has. */
  send: (chunk: Uint8Array) => boolean;
  /** Closes at most once, never throws. */
  close: () => void;
  /** True once the client has disconnected or the stream has been closed. */
  readonly gone: boolean;
}

export function guardStream(
  controller: Pick<ReadableStreamDefaultController<Uint8Array>, "enqueue" | "close">,
): GuardedStream {
  let gone = false;
  return {
    send(chunk: Uint8Array) {
      if (gone) return false;
      try {
        controller.enqueue(chunk);
        return true;
      } catch {
        // The only reason enqueue throws here is that the consumer went away.
        gone = true;
        return false;
      }
    },
    close() {
      if (gone) return;
      gone = true;
      try {
        controller.close();
      } catch {
        /* already torn down by the runtime */
      }
    },
    get gone() {
      return gone;
    },
  };
}

/** Encodes and sends one NDJSON event. Returns false once the client has gone. */
export function ndjsonSender(stream: GuardedStream) {
  const encoder = new TextEncoder();
  return (event: Record<string, unknown>): boolean =>
    stream.send(encoder.encode(`${JSON.stringify(event)}\n`));
}
