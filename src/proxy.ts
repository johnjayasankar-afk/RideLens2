import { NextResponse, type NextRequest } from "next/server";

/** RideLens has no auth-gated consumer routes; pass through. */
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
