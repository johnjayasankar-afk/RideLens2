import { NextResponse } from "next/server";
import { getEnv, isProductionLiveCapable } from "@/lib/config";
import { sourceStatusSummary } from "@/lib/sources/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  return NextResponse.json({
    ok: true,
    app: "ridelens",
    environment: env.NODE_ENV,
    liveCapable: isProductionLiveCapable(env),
    sources: sourceStatusSummary(env),
  });
}
