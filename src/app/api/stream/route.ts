import { demoObservations } from "@/lib/demo";
import { gameMatches, normalizeObservation, type FoldState } from "@/lib/normalizer";
import { createConsumer, createRegistry, hasRedpandaConfig, MLB_TOPICS } from "@/lib/redpanda";
import type { Game, StreamMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby deployments cap functions at 300s. EventSource reconnects each segment
// while the browser preserves the game-long comparison history.
export const maxDuration = 300;

const encoder = new TextEncoder();
const event = (message: StreamMessage) => encoder.encode(`data: ${JSON.stringify(message)}\n\n`);

const parseGame = (url: URL): Game | null => {
  const gamePk = url.searchParams.get("gamePk");
  if (!gamePk) return null;
  return {
    gamePk,
    gameDate: url.searchParams.get("gameDate") ?? "",
    awayName: url.searchParams.get("awayName") ?? "Away",
    awayAbbr: url.searchParams.get("awayAbbr") ?? "AWY",
    homeName: url.searchParams.get("homeName") ?? "Home",
    homeAbbr: url.searchParams.get("homeAbbr") ?? "HME",
    venue: url.searchParams.get("venue") ?? "",
    status: url.searchParams.get("status") ?? "",
  };
};

const aliasesFor = (gamePk: string): Record<string, string> => {
  try {
    const all = JSON.parse(process.env.GAME_SOURCE_IDS || "{}") as Record<string, Record<string, string>>;
    return all[gamePk] ?? {};
  } catch {
    return {};
  }
};

export async function GET(request: Request) {
  const game = parseGame(new URL(request.url));
  if (!game) return new Response("gamePk is required", { status: 400 });
  const demo = process.env.DEMO_MODE === "true" || !hasRedpandaConfig();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (message: StreamMessage) => {
        if (!closed) controller.enqueue(event(message));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      if (demo) {
        let step = 0;
        safeEnqueue({ type: "ready", at: Date.now(), topics: MLB_TOPICS, demo: true });
        const timer = setInterval(() => {
          const baseline = Date.now();
          for (const observation of demoObservations(step, baseline)) {
            setTimeout(() => safeEnqueue({ type: "observation", observation }), Math.max(0, observation.observedAt - baseline));
          }
          step += 1;
        }, 1_250);
        const heartbeat = setInterval(() => safeEnqueue({ type: "heartbeat", at: Date.now() }), 15_000);
        cleanup = () => { clearInterval(timer); clearInterval(heartbeat); close(); };
        request.signal.addEventListener("abort", cleanup, { once: true });
        return;
      }

      const consumer = createConsumer();
      const registry = createRegistry();
      const foldState: FoldState = { espnDocuments: new Map() };
      const aliases = aliasesFor(game.gamePk);
      const heartbeat = setInterval(() => safeEnqueue({ type: "heartbeat", at: Date.now() }), 15_000);

      const run = async () => {
        try {
          await consumer.connect();
          await consumer.subscribe({ topics: MLB_TOPICS, fromBeginning: false });
          safeEnqueue({ type: "ready", at: Date.now(), topics: MLB_TOPICS, demo: false });
          await consumer.run({
            eachMessage: async ({ topic, message }) => {
              if (!message.value) return;
              const observedAt = Date.now();
              try {
                const decoded = await registry.decode(message.value);
                const record = decoded as Record<string, unknown>;
                const key = message.key?.toString("utf8") ?? "";
                if (!gameMatches(topic, key, record, game, aliases)) return;
                const observation = normalizeObservation(topic, key, record, observedAt, foldState);
                if (observation) safeEnqueue({ type: "observation", observation });
              } catch (error) {
                safeEnqueue({ type: "warning", topic, message: error instanceof Error ? error.message : "Decode failed" });
              }
            },
          });
        } catch (error) {
          safeEnqueue({ type: "warning", message: error instanceof Error ? error.message : "Redpanda connection failed" });
          close();
        }
      };

      void run();
      cleanup = () => {
        clearInterval(heartbeat);
        void consumer.disconnect().finally(close);
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
