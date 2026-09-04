import type { ProviderId, RideCategory } from "./types";

const RULES: Array<{
  provider?: ProviderId;
  match: RegExp;
  category: RideCategory;
}> = [
  { match: /waymo|autonom/i, category: "AUTONOMOUS" },
  { match: /wav|access|wheelchair/i, category: "ACCESSIBLE" },
  { match: /\bshared\b|\bpool\b|line\b|wait\s*&?\s*save/i, category: "SHARED" },
  { match: /\bev\b|electric|green|comfort\s*electric/i, category: "EV" },
  { match: /black|lux|chauffeur|premier\s*lux/i, category: "LUXURY" },
  { match: /comfort|premier|prefer|exec|business/i, category: "PREMIUM" },
  { match: /xl|suv|plus|van|extra\s*large/i, category: "XL" },
  { match: /taxi|curb|yellow/i, category: "TAXI" },
  { match: /economy|wait\s*and\s*save|uberx?\s*share/i, category: "ECONOMY" },
  {
    provider: "uber",
    match: /uberx|uber\s*x|\bstandard\b|uberone/i,
    category: "STANDARD",
  },
  { provider: "lyft", match: /^lyft$|lyft\s*standard|\bstandard\b/i, category: "STANDARD" },
  { provider: "empower", match: /standard|basic|empower/i, category: "STANDARD" },
  { match: /\bstandard\b|\bx\b|classic/i, category: "STANDARD" },
];

export function mapProductToCategory(
  provider: ProviderId,
  productName: string,
  _productId?: string,
): RideCategory {
  const name = productName.trim();
  for (const rule of RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (rule.match.test(name)) return rule.category;
  }
  return "OTHER";
}

export const STANDARD_COMPARABLE: RideCategory[] = [
  "STANDARD",
  "ECONOMY",
  "TAXI",
];

export function isStandardComparable(category: RideCategory): boolean {
  return STANDARD_COMPARABLE.includes(category);
}

export function categoryLabel(category: RideCategory): string {
  switch (category) {
    case "STANDARD":
      return "Standard";
    case "ECONOMY":
      return "Economy";
    case "TAXI":
      return "Taxi";
    case "XL":
      return "XL";
    case "PREMIUM":
      return "Premium";
    case "LUXURY":
      return "Luxury";
    case "EV":
      return "EV";
    case "SHARED":
      return "Shared";
    case "ACCESSIBLE":
      return "Accessible";
    case "AUTONOMOUS":
      return "Autonomous";
    default:
      return "Other";
  }
}
