/**
 * The deck's panels, as data.
 *
 * Four things need to agree about what the panels are called: the deck that
 * draws the tabs, the command palette that offers them, the assistant's tool
 * schema that validates a request to open one, and the URL that carries which
 * is open. A list in the component would have been copied into the other
 * three, and the copies would have drifted — most likely the schema's, which
 * is the one that decides whether a model's request is honoured.
 *
 * No React here on purpose: the palette lives in the form and has no business
 * importing a deck full of charts to learn a label.
 */

export const PANEL_IDS = [
  "spread",
  "breakdown",
  "whatif",
  "tradeoffs",
  "timing",
  "split",
  "return",
  "transit",
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

export interface PanelDefinition {
  id: PanelId;
  /** One word where possible: these sit in a single row, eight wide. */
  label: string;
  /** The question the panel answers, in the reader's words. */
  question: string;
  /** Words somebody might type looking for it, for the palette's matcher. */
  keywords: string;
  /**
   * One clause for the assistant's tool description.
   *
   * Written for the model rather than borrowed from `question`, which is copy
   * for a reader. Borrowing it put "What does paying more buy?" into the tool
   * surface, and the test that greps that surface for the words this assistant
   * must never offer — book, pay, send — duly failed on the "pay" inside
   * "paying". The guard was right to be blunt; the description should not have
   * been UI copy in the first place.
   */
  brief: string;
}

/**
 * Ordered as a reader would ask them: what it costs, what it is made of, how
 * much of that to believe, what the alternatives buy, and then the questions
 * that are not about this trip as priced — when, who with, coming back, and
 * whether to take a car at all.
 */
export const PANELS: readonly PanelDefinition[] = [
  {
    id: "spread",
    label: "Spread",
    question: "Is the cheapest actually cheaper?",
    keywords: "spread overlap ruler bands compare side by side",
    brief: "every option's band on one ruler, showing which of them overlap",
  },
  {
    id: "breakdown",
    label: "Breakdown",
    question: "Where does the money go?",
    keywords: "breakdown fees taxes tolls surcharges composition where money goes",
    brief: "what each fare is made of: the ride, the statutory stack, and the corridor adjustment",
  },
  {
    id: "whatif",
    label: "What if",
    question: "How much rests on the model being right?",
    keywords: "what if sensitivity scenarios traffic weather uncertainty robust",
    brief:
      "how far the estimate moves if the model is wrong about traffic, the route, the weather or the hour, and whether the ordering survives",
  },
  {
    id: "tradeoffs",
    label: "Trade-offs",
    question: "What does paying more buy?",
    keywords: "trade-offs worth it faster time value per hour",
    brief: "what the extra on a dearer option buys in time, as dollars per hour",
  },
  {
    id: "timing",
    label: "Timing",
    question: "Does waiting help?",
    keywords: "timing wait later forecast next hour departure",
    brief: "the next hour, as bands, and whether waiting helps",
  },
  {
    id: "split",
    label: "Split",
    question: "What is it each, out the door?",
    keywords: "split group per person tip each people",
    brief: "cost per head for a group, with a tip",
  },
  {
    id: "return",
    label: "Return",
    question: "What does coming back cost?",
    keywords: "return back reverse round trip coming home",
    brief: "the reverse leg, priced on its own",
  },
  {
    id: "transit",
    label: "No car",
    question: "Is there a way without one?",
    keywords: "transit subway train bus without a car no car walk",
    brief: "getting there without a car, where a published fare exists",
  },
];

export function panelById(id: string): PanelDefinition | null {
  return PANELS.find((p) => p.id === id) ?? null;
}
