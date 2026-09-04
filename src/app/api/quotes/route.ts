import { NextRequest, NextResponse } from "next/server";
import { canonicalizeRoute } from "@/lib/location/geocoder";
import {
  incrementComparisonCount,
  runQuoteSession,
  type SourceProgressEvent,
} from "@/lib/quotes/orchestrator";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";
import { compareRequestSchema } from "@/lib/validation/schemas";
import { assertNoSilentMocks } from "@/lib/config";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  try {
    assertNoSilentMocks();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid config" },
      { status: 500 },
    );
  }

  const ip = clientIp(req);
  const rl = rateLimit(rateLimitKey({ ip, action: "compare" }));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = compareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const wantStream = parsed.data.stream === true;
  const refresh = parsed.data.refresh === true;

  let route;
  try {
    route = await canonicalizeRoute({
      pickup: parsed.data.pickup,
      destination: parsed.data.destination,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Location resolution failed",
        message: e instanceof Error ? e.message : "geocode error",
      },
      { status: 422 },
    );
  }

  incrementComparisonCount();

  if (!wantStream) {
    const session = await runQuoteSession({
      pickup: route.pickup,
      destination: route.destination,
      rankingMode: parsed.data.rankingMode,
      categoryFilter: parsed.data.categoryFilter,
      skipCache: refresh,
    });
    return NextResponse.json({ session });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SourceProgressEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      try {
        await runQuoteSession({
          pickup: route.pickup,
          destination: route.destination,
          rankingMode: parsed.data.rankingMode,
          categoryFilter: parsed.data.categoryFilter,
          skipCache: refresh,
          onEvent: send,
        });
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
              message: e instanceof Error ? e.message : "stream failed",
            })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
