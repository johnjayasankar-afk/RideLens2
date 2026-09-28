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
import { ASSISTANT_TOOLS, describeAction, toAction } from "@/lib/assistant/actions";
import { getSession } from "@/lib/quotes/orchestrator";
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

export async function GET() {
  /* Lets the client decide whether to render the assistant at all. */
  return NextResponse.json({ available: Boolean(getEnv().ANTHROPIC_API_KEY) });
}

export async function POST(req: NextRequest) {
  const apiKey = getEnv().ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "The assistant is not configured." }, { status: 503 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  /* Tighter than the other routes: every call costs real money. */
  const limit = rateLimit(rateLimitKey({ ip, action: "ask" }), 20, 300);
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

  const brief = renderBrief(
    buildBrief(session, (parsed.trips ?? []) as TripRecord[], MODEL_VERSION),
  );

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

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
