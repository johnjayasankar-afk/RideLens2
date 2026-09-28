/**
 * What the assistant is allowed to do, as opposed to say.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ An assistant that can act is an assistant that can act wrongly, so the   │
 * │ surface is drawn deliberately small: every action here is something the  │
 * │ rider can already do with one tap, and the assistant performs none of    │
 * │ them itself. It returns an intent; the client runs it through the same   │
 * │ path the command palette uses.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * That bounding is the whole design. The model cannot reach the network, the
 * trip log, or the provider handoff. The worst it can do is change the sort
 * order or re-run a comparison the rider was already looking at — and the
 * client validates every intent before running it, because a tool input is
 * model output and model output is untrusted.
 *
 * Nothing here books a ride, spends money, or sends anything anywhere. That
 * is not a limitation to be lifted later; it is the reason this is safe.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { PANELS, PANEL_IDS, panelById } from "@/lib/domain/panels";

/** Ranking modes the rider can already choose. */
export const RANKING_MODES = ["cheapest", "fastest", "best_value"] as const;

/** Category filters the rider can already choose. */
export const FILTERS = ["standard", "TAXI", "XL", "PREMIUM", "ALL"] as const;

/**
 * The intents, validated on arrival.
 *
 * A discriminated union rather than a bag of optional fields, so an intent
 * that does not fully specify itself fails to parse rather than running with
 * half its arguments missing.
 */
export const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("refresh"),
  }),
  z.object({
    action: z.literal("swap"),
  }),
  z.object({
    action: z.literal("rank"),
    mode: z.enum(RANKING_MODES),
  }),
  z.object({
    action: z.literal("filter"),
    category: z.enum(FILTERS),
  }),
  z.object({
    action: z.literal("watch"),
    /** Dollars, as the rider would type them. Converted to minor units here. */
    threshold: z.number().positive().max(1000),
  }),
  z.object({
    action: z.literal("panel"),
    panel: z.enum(PANEL_IDS),
  }),
]);

export type AssistantAction = z.infer<typeof actionSchema>;

/**
 * The tool definitions handed to the model.
 *
 * `strict: true` with `additionalProperties: false` so the arguments validate
 * exactly — the client still re-validates with the schema above, because a
 * guarantee from the far side of a network call is not a guarantee.
 */
export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "refresh_comparison",
    description:
      "Re-run the current comparison to get fresh prices. Use when the rider asks for an update, or asks whether prices have moved.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "swap_trip",
    description:
      "Swap the pickup and destination, then compare the return journey. Use when the rider asks about going back, or the trip the other way round.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "set_ranking",
    description:
      "Change how the options are ordered. 'cheapest' by price, 'fastest' by pickup wait, 'best_value' balances the two.",
    input_schema: {
      type: "object",
      properties: { mode: { type: "string", enum: [...RANKING_MODES] } },
      required: ["mode"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "set_filter",
    description:
      "Show only one class of ride. 'standard' for the usual cars, 'TAXI', 'XL' for larger vehicles, 'PREMIUM', or 'ALL'.",
    input_schema: {
      type: "object",
      properties: { category: { type: "string", enum: [...FILTERS] } },
      required: ["category"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    /*
     * The one action that answers rather than changes. Asked "why is Lyft
     * dearer", the honest reply names the ride and the fees — and the panel
     * that draws them is one tap away and behind a tab most riders never
     * open. Opening it is worth more than another paragraph.
     */
    name: "open_panel",
    description:
      "Open one of the panels under the comparison, so the rider can see what you are describing. " +
      PANELS.map((p) => `'${p.id}' — ${p.brief}.`).join(" ") +
      " Use it alongside an answer, not instead of one.",
    input_schema: {
      type: "object",
      properties: { panel: { type: "string", enum: [...PANEL_IDS] } },
      required: ["panel"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "watch_price",
    description:
      "Set a price watch on this route, checked the next time the rider opens RideLens. It does not notify them — nothing runs in the background. threshold is in dollars.",
    input_schema: {
      type: "object",
      properties: { threshold: { type: "number" } },
      required: ["threshold"],
      additionalProperties: false,
    },
    strict: true,
  },
];

/** Map a tool call to a validated intent, or null if it does not parse. */
export function toAction(name: string, input: unknown): AssistantAction | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  const candidate =
    name === "refresh_comparison"
      ? { action: "refresh" }
      : name === "swap_trip"
        ? { action: "swap" }
        : name === "set_ranking"
          ? { action: "rank", mode: raw.mode }
          : name === "set_filter"
            ? { action: "filter", category: raw.category }
            : name === "watch_price"
              ? { action: "watch", threshold: raw.threshold }
              : name === "open_panel"
                ? { action: "panel", panel: raw.panel }
                : null;
  if (!candidate) return null;
  const parsed = actionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** One short sentence describing what an intent did, for the transcript. */
export function describeAction(action: AssistantAction): string {
  switch (action.action) {
    case "refresh":
      return "Re-ran the comparison.";
    case "swap":
      return "Swapped the trip and compared the way back.";
    case "rank":
      return action.mode === "cheapest"
        ? "Sorted by price."
        : action.mode === "fastest"
          ? "Sorted by pickup wait."
          : "Sorted by value.";
    case "filter":
      return action.category === "ALL"
        ? "Showing every class of ride."
        : `Showing ${action.category === "standard" ? "standard" : action.category} rides only.`;
    case "watch":
      return `Watching this trip for $${action.threshold.toFixed(2)} or less — checked when you next open RideLens.`;
    case "panel": {
      const panel = panelById(action.panel);
      return `Opened ${panel?.label ?? action.panel} below — ${panel?.question ?? ""}`.trim();
    }
  }
}
