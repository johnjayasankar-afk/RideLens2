import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/quotes/orchestrator";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    /*
     * A miss here used to mean "a different instance ran this comparison".
     * Sessions persist now, so a 404 means the session genuinely does not
     * exist or has aged out — which is worth saying, because the two used to
     * be indistinguishable.
     */
    return NextResponse.json(
      { error: "Session not found", reason: "unknown-or-expired" },
      { status: 404 },
    );
  }
  return NextResponse.json({ session });
}
