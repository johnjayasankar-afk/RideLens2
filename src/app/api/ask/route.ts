/**
 * The assistant, answering about a comparison the rider is looking at.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Three things keep a language model from undoing the rest of this         │
 * │ product. It is given a brief rather than a topic, and told it may not    │
 * │ state a figure outside it. It can only act through intents the client    │
 * │ re-validates and runs through the same path as the command palette. And  │
 * │ the key lives here, on the server, where the browser cannot reach it.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The trip log arrives in the request body rather than from storage, because
 * the server has never held it and this route does not start. Nothing is
 * written anywhere: no transcript, no history, no log of what was asked.
 */

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getEnv } from "@/lib/config";
import { ASSISTANT_SYSTEM_PROMPT, buildBrief, renderBrief } from "@/lib/assistant/context";
import { answerLocally } from "@/lib/assistant/local";
import { ASSISTANT_TOOLS, describeAction, toAction } from "@/lib/assistant/actions";
import { getSession } from "@/lib/quotes/orchestrator";
import { measuredJourneyFor } from "@/lib/transit/journey-time";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";
import { MODEL_VERSION } from "@/lib/sources/ratecard/model-params";
import type { TripRecord } from "@/lib/history/trip-log";

export const dynamic = "force-dynamic";

/**
 * Named by the operator rather than chosen here. Haiku 4.5 takes a thinking
 * budget rather than adaptive thinking and rejects `effort` — neither is used:
 * the answers are short and the reasoning is in the brief, not the model.
 */
const MODEL = "claude-haiku-4-5";

/** Short answers by design. A long one is a sign it has started inventing. */
const MAX_TOKENS = 700;

/** Enough turns to follow up, few enough that a runaway costs little. */
const MAX_TURNS = 12;

const bodySchema = z.object({
  sessionId: z.string().min(1).max(64),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(MAX_TURNS),
  /* The rider's own log, sent by the client. Never stored. */
  trips: z.array(z.unknown()).max(200).optional(),
});

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Which assistant is answering — and it is never "none".
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This returned `available: false` with no key, and the client rendered    │
 * │ nothing at all: no chat, no button, no explanation. On a fresh clone, in │
 * │ CI, and on the owner's own build, the assistant was simply missing, and  │
 * │ missing in a way that looked like it had never been built.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `mode` is reported rather than hidden because the two answerers are not the
 * same thing and the rider is owed the difference. `local` recognises a
 * question and quotes the brief; it cannot compose, and it cannot invent.
 * `model` is Claude, working under the same brief and eight hard rules.
 * Calling the first one AI would be the kind of small lie this product spends
 * the rest of its surface area refusing to tell.
 */
export async function GET() {
  return NextResponse.json({
    available: true,
    mode: getEnv().ANTHROPIC_API_KEY ? "model" : "local",
  });
}

export async function POST(req: NextRequest) {
  const apiKey = getEnv().ANTHROPIC_API_KEY;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  /*
   * Tighter than the other routes when a call costs real money, ordinary when
   * it does not. The local answerer reaches nothing and spends nothing, so
   * rate-limiting it at twenty per five minutes would be throttling a pure
   * function.
   */
  const limit = apiKey
    ? rateLimit(rateLimitKey({ ip, action: "ask" }), 20, 300)
    : rateLimit(rateLimitKey({ ip, action: "ask-local" }), 120, 300);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many questions just now.", retryAfter: limit.retryAfterSeconds },
      { status: 429 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const session = await getSession(parsed.sessionId);
  if (!session) {
    return NextResponse.json(
      { error: "That comparison has expired. Run it again and I can answer about the new one." },
      { status: 404 },
    );
  }

  /*
   * Shares a cache key with /api/alternatives, so the panel has almost always
   * paid for this already. Null when no source is configured, when the source
   * declined, or when there is no transit row at all — and then the brief says
   * the journey time is not modeled, exactly as the panel does.
   */
  const journey = await measuredJourneyFor(
    { lat: session.pickup.lat, lng: session.pickup.lng },
    { lat: session.destination.lat, lng: session.destination.lng },
  );
  const briefData = buildBrief(
    session,
    (parsed.trips ?? []) as TripRecord[],
    MODEL_VERSION,
    journey,
  );
  const encoder = new TextEncoder();

  /*
   * No key: answer from the brief directly.
   *
   * The same SSE shape as the model path, so the client is identical either
   * way — it has never needed to know which one replied, only the surface
   * that labels the assistant does. Sent in word groups rather than one blob
   * because the client renders a stream; there is no artificial delay, so it
   * arrives as fast as it can rather than pretending to think.
   */
  if (!apiKey) {
    const last = [...parsed.messages].reverse().find((m) => m.role === "user");
    const reply = answerLocally(last?.content ?? "", briefData);
    const local = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(sse(event, data)));
        const words = reply.text.split(" ");
        for (let i = 0; i < words.length; i += 6) {
          send("text", { text: (i === 0 ? "" : " ") + words.slice(i, i + 6).join(" ") });
        }
        if (reply.action) {
          send("action", { action: reply.action, said: describeAction(reply.action) });
        }
        send("done", { stopReason: reply.refused ? "no_match" : "end_turn" });
        controller.close();
      },
    });
    return new Response(local, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const brief = renderBrief(briefData);
  const client = new Anthropic({ apiKey });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      try {
        const result = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: [
            {
              type: "text",
              text: ASSISTANT_SYSTEM_PROMPT,
              /* Frozen and first, so it caches across every question. */
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: `BRIEF — the only figures you may state:\n\n${brief}` },
          ],
          tools: ASSISTANT_TOOLS,
          messages: parsed.messages.map((m) => ({ role: m.role, content: m.content })),
        });

        result.on("text", (chunk) => send("text", { text: chunk }));

        const final = await result.finalMessage();

        /*
         * A refusal is a real outcome, not an error. Say so plainly rather
         * than letting the stream end on silence.
         */
        if (final.stop_reason === "refusal") {
          send("text", { text: "I can't help with that one." });
        }

        for (const block of final.content) {
          if (block.type !== "tool_use") continue;
          const action = toAction(block.name, block.input);
          /*
           * An intent the schema rejects is dropped silently. The client
           * validates again anyway; this is the first of two gates.
           */
          if (action) send("action", { action, said: describeAction(action) });
        }

        send("done", { stopReason: final.stop_reason });
      } catch (err) {
        /* Typed, most specific first — a rate limit is not a bad request. */
        const message =
          err instanceof Anthropic.RateLimitError
            ? "The assistant is busy. Try again in a moment."
            : err instanceof Anthropic.AuthenticationError
              ? "The assistant is not configured correctly."
              : err instanceof Anthropic.APIError
                ? "The assistant could not answer that."
                : "Something went wrong reaching the assistant.";
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
