import { fetchSessions } from "@/lib/sessions";
import { SSE_POLL_INTERVAL } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let previousJson = "";
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const poll = async () => {
        if (closed) return;

        try {
          const sessions = await fetchSessions();
          const json = JSON.stringify(sessions);

          // Only emit when state has changed
          if (json !== previousJson && !closed) {
            previousJson = json;
            const event = `event: sessions\ndata: ${json}\n\n`;
            try {
              controller.enqueue(encoder.encode(event));
            } catch {
              // Controller may be closed between our check and enqueue
              closed = true;
              return;
            }
          }
        } catch {
          // Polling error — skip this cycle, try again next interval
        }

        if (!closed) {
          setTimeout(poll, SSE_POLL_INTERVAL);
        }
      };

      // Send initial snapshot immediately
      await poll();
    },
    cancel() {
      closed = true;
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
