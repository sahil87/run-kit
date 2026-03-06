import { fetchSessions } from "@/lib/sessions";
import { SSE_POLL_INTERVAL } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Max connection lifetime before forcing reconnect (30 minutes). */
const MAX_LIFETIME_MS = 30 * 60 * 1000;

// --- Module-level singleton: shared poll loop for all SSE clients ---

type Client = {
  controller: ReadableStreamController<Uint8Array>;
  lifetimeTimer: ReturnType<typeof setTimeout>;
};

const clients = new Set<Client>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let previousJson = "";
const encoder = new TextEncoder();

function startPolling() {
  if (pollTimer) return;

  async function poll() {
    if (clients.size === 0) {
      pollTimer = null;
      return;
    }

    try {
      const sessions = await fetchSessions();
      const json = JSON.stringify(sessions);

      if (json !== previousJson) {
        previousJson = json;
        const event = encoder.encode(`event: sessions\ndata: ${json}\n\n`);

        for (const client of clients) {
          try {
            client.controller.enqueue(event);
          } catch {
            removeClient(client);
          }
        }
      }
    } catch {
      // Polling error — skip this cycle
    }

    if (clients.size > 0) {
      pollTimer = setTimeout(poll, SSE_POLL_INTERVAL);
    } else {
      pollTimer = null;
    }
  }

  poll();
}

function removeClient(client: Client) {
  clearTimeout(client.lifetimeTimer);
  clients.delete(client);

  if (clients.size === 0 && pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
    // Keep previousJson so next connecting client gets an instant cached snapshot
  }
}

// --- Route handler ---

export async function GET() {
  let client: Client | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Send cached snapshot immediately if available
      if (previousJson) {
        try {
          controller.enqueue(
            encoder.encode(`event: sessions\ndata: ${previousJson}\n\n`),
          );
        } catch {
          return;
        }
      }

      const lifetimeTimer = setTimeout(() => {
        if (client) {
          try {
            client.controller.close();
          } catch {
            // Already closed
          }
          removeClient(client);
          client = null;
        }
      }, MAX_LIFETIME_MS);

      client = { controller, lifetimeTimer };
      clients.add(client);
      startPolling();
    },
    cancel() {
      if (client) {
        removeClient(client);
        client = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
