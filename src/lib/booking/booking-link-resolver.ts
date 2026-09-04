import type {
  CanonicalLocation,
  ProviderId,
  BookingHandoff,
} from "@/lib/domain/types";
import { getEnv } from "@/lib/config";
import { assertAllowlistedUrl } from "@/lib/booking/allowed-hosts";

export { isAllowedBookingUrl, assertAllowlistedUrl } from "@/lib/booking/allowed-hosts";

export interface BookingContext {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  productId?: string;
  productName?: string;
}

function encodeLocJson(loc: CanonicalLocation, line1?: string) {
  return encodeURIComponent(
    JSON.stringify({
      latitude: loc.lat,
      longitude: loc.lng,
      addressLine1: line1 || loc.name || loc.formattedAddress.split(",")[0],
      addressLine2: loc.formattedAddress,
    }),
  );
}

export function resolveUber(ctx: BookingContext): BookingHandoff {
  const env = getEnv();
  const clientId = env.UBER_CLIENT_ID;
  const pickup = encodeLocJson(ctx.pickup);
  const drop = encodeLocJson(ctx.destination);
  let url = `https://m.uber.com/looking?pickup=${pickup}&drop[0]=${drop}`;
  if (clientId) url += `&client_id=${encodeURIComponent(clientId)}`;
  // Uber deep links expect real product UUIDs — skip rate-card slugs like "uberx".
  const uberProductId =
    ctx.productId && /^[0-9a-f-]{20,}$/i.test(ctx.productId)
      ? ctx.productId
      : undefined;
  if (uberProductId) {
    url += `&product_id=${encodeURIComponent(uberProductId)}`;
  }

  assertAllowlistedUrl(url);
  return {
    kind: "deep_link",
    url,
    prefills: {
      pickup: true,
      destination: true,
      product: Boolean(uberProductId),
    },
    label: "Book Uber",
    verified: true,
  };
}

export function resolveLyft(ctx: BookingContext): BookingHandoff {
  const raw = `${ctx.productId || ""} ${ctx.productName || ""}`.toLowerCase();
  let rideType = "lyft";
  if (/\bxl\b|_xl|lyftxl|lyft_xl/.test(raw) || raw.includes("lyft xl")) {
    rideType = "lyft_xl";
  } else if (raw.includes("plus") || raw.includes("lyft_plus")) {
    rideType = "lyft_plus";
  } else if (raw.includes("lux")) {
    rideType = "lyft_lux";
  } else if (ctx.productId) {
    // Prefer explicit product ids from partner APIs when present.
    const id = ctx.productId.toLowerCase();
    if (id.startsWith("lyft")) rideType = id;
  }
  const params = new URLSearchParams({
    id: rideType,
    "pickup[latitude]": String(ctx.pickup.lat),
    "pickup[longitude]": String(ctx.pickup.lng),
    "destination[latitude]": String(ctx.destination.lat),
    "destination[longitude]": String(ctx.destination.lng),
  });
  // Web universal-style handoff (native lyft:// also works on device)
  const url = `https://www.lyft.com/ride?${params.toString()}`;
  assertAllowlistedUrl(url);
  return {
    kind: "deep_link",
    url,
    prefills: { pickup: true, destination: true, product: true },
    label:
      rideType === "lyft"
        ? "Book Lyft"
        : rideType === "lyft_xl"
          ? "Book Lyft XL"
          : rideType === "lyft_plus"
            ? "Book Lyft Plus"
            : "Book Lyft",
    verified: true,
  };
}

export function resolveCurb(_ctx: BookingContext): BookingHandoff {
  void _ctx;
  // Official consumer entry — product/route prefills not publicly documented as stable
  const url = "https://gocurb.com/";
  assertAllowlistedUrl(url);
  return {
    kind: "interstitial",
    url,
    prefills: { pickup: false, destination: false, product: false },
    label: "Continue to Curb",
    verified: false,
  };
}

export function resolveEmpower(_ctx: BookingContext): BookingHandoff {
  void _ctx;
  const url = "https://www.rideempower.com/";
  assertAllowlistedUrl(url);
  return {
    kind: "interstitial",
    url,
    prefills: { pickup: false, destination: false, product: false },
    label: "Continue to Empower",
    verified: false,
  };
}

export function resolveBookingHandoff(
  provider: ProviderId,
  ctx: BookingContext,
): BookingHandoff | null {
  switch (provider) {
    case "uber":
      return resolveUber(ctx);
    case "lyft":
      return resolveLyft(ctx);
    case "curb":
      return resolveCurb(ctx);
    case "empower":
      return resolveEmpower(ctx);
    default:
      return null;
  }
}
