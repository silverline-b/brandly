// ─────────────────────────────────────────────────────────────────────────────
// brief-set.ts  —  Frozen briefs for the generation harness
//
// WHY THIS EXISTS
//   In production your brief is GENERATED per run (generateBrandBrief +
//   buildCategoryBank), so two things vary every run: the brief itself, and the
//   names coined from it. That double variance is why "did my change help?" was
//   unanswerable — you could never tell a real improvement from a lucky batch.
//
//   A frozen brief is a COMPLETE, hand-authored brief object fed straight into
//   buildStylePrompt, bypassing brief+bank generation. Now the input is
//   byte-identical every run, so when you edit the generation prompt the ONLY
//   thing that moves is the prompt. That is the whole point of the harness.
//
// SCOPE NOTE (important)
//   Because a frozen brief bypasses buildCategoryBank/reconcileAvoid, this
//   harness tests the GENERATION PROMPT, not the brief-assembly layer. The
//   reconcileAvoid fix is validated separately, at the pipeline level, via
//   lint-run.ts on a real run. Different layers, different tests — don't
//   conflate their scores.
//
// EACH BRIEF'S avoid LIST is TIER-1 ONLY — the 1-3 most saturated words that can't
// clear trademark (pet: paw, fur, tail), NOT the broad category vocabulary. The
// fresh, less-obvious subject words (snout, wag, den…) are ENCOURAGED raw material
// and deliberately kept OUT of avoid. So an avoid_word failure here means the
// generator reached for one of the handful of truly saturated clichés — a true
// generation-quality signal, not a brief bug.
// ─────────────────────────────────────────────────────────────────────────────

import type { Candidate } from "./name-linter.ts";

export interface FrozenBrief {
  id: string;
  // ── inputs buildStylePrompt reads directly ──
  product_description: string;
  keywords: string[];
  vibe: string[];
  target_audience: string;
  name_length: "short" | "medium" | "long" | "any";
  name_style: "auto";
  style_buckets: Record<string, number>;
  // ── the strategy brief (what generateBrandBrief would have produced) ──
  brief: {
    avoid: string; // comma-separated, TIER-1 ONLY (1-3 most-saturated words, not broad vocab)
    territories: string; // " | "-separated, conceptually orthogonal
    references: string;
    positioning: string;
  };
  // ── category lexicon (what buildCategoryBank would have produced) ──
  lexicon: string;
  // ── passed to the linter, not the generator ──
  productNouns: string[]; // literal product/format nouns → hard-fail descriptors
  subsegmentTerms: string[];
}

// The linter takes avoid as string[]; the generator takes brief.avoid as a
// string. Helper so both read the same source of truth.
export const avoidList = (b: FrozenBrief): string[] =>
  b.brief.avoid.split(",").map((s) => s.trim()).filter(Boolean);

// A sane default bucket split, deliberately NOT the production run's split
// (which over-weighted the two weakest styles). Tunable — buckets are part of
// the frozen input, so changing them is itself a measurable change.
const DEFAULT_BUCKETS = {
  compound: 55,
  evocative: 45,
  real_words: 10,
  brandable: 20,
  non_english: 15,
  alternate_spelling: 5,
};

export const BRIEFS: FrozenBrief[] = [
  {
    id: "dog_sling",
    product_description: "A dog sling carrier for small and weak dogs. Premium feel",
    keywords: ["pet", "dog", "premium", "playful"],
    vibe: ["premium", "playful", "tender"],
    target_audience: "Owners of small, fragile dogs who treat them as family",
    name_length: "any",
    name_style: "auto",
    style_buckets: DEFAULT_BUCKETS,
    brief: {
      avoid: "paw, fur, tail",
      territories:
        "the little dog carried close against the heart | the bouncy affectionate spirit of small dogs | being cradled safe while out in the world | elevated craftsmanship worthy of a pampered pet | the tiny dog as a small aristocrat with a big personality",
      references: "BabyBjörn | Aesop | Herschel Supply Co.",
      positioning:
        "let owners of small, fragile dogs carry their companion close with premium, playful elegance",
    },
    lexicon:
      'category words: trot, prance, scamper, nuzzle, cradle, snug, companion, loyal, devoted, den, meadow, trail, hearth, sidekick, perky, plucky, gentle, spry, cosset, dote',
    productNouns: ["sling", "carrier", "tote", "pouch", "wrap"],
    subsegmentTerms: ["poodle", "pug", "chihuahua", "yorkie", "corgi", "terrier", "spaniel", "sled"],
  },
  {
    id: "coffee_craft",
    product_description: "A specialty single-origin coffee subscription for home brewers",
    keywords: ["coffee", "craft", "ritual", "morning"],
    vibe: ["warm", "crafted", "considered"],
    target_audience: "Home coffee enthusiasts who care about origin and method",
    name_length: "any",
    name_style: "auto",
    style_buckets: DEFAULT_BUCKETS,
    brief: {
      avoid: "bean, brew, roast",
      territories:
        "the slow morning ritual and first pour | craft and the hand of the roaster | origin, terroir and distant places | warmth and quiet daily comfort | the lift and clarity of the first sip",
      references: "Aesop | Muji | Field Notes",
      positioning:
        "make the daily coffee ritual feel considered, warm and quietly premium for home brewers",
    },
    lexicon:
      'category words: pour, steep, bloom, aroma, ember, kettle, ritual, dawn, harvest, altitude, terroir, warmth, hearth, linger, drift, still, craft, origin, valley, mist',
    productNouns: ["coffee", "bean", "brew", "roast", "blend", "cup"],
    subsegmentTerms: ["arabica", "robusta", "geisha", "chemex", "aeropress"],
  },
  {
    id: "dev_observability",
    product_description: "A B2B SaaS tool that monitors and traces errors in production APIs",
    keywords: ["developer", "monitoring", "reliability", "infrastructure"],
    vibe: ["precise", "trustworthy", "fast"],
    target_audience: "Backend engineers and platform teams at software companies",
    name_length: "short",
    name_style: "auto",
    style_buckets: DEFAULT_BUCKETS,
    brief: {
      avoid: "log, monitor, trace",
      territories:
        "clarity and seeing in the dark | speed and instant signal | steadiness and reliability under load | the watchful guardian that never sleeps | precision and clean instrumentation",
      references: "Stripe | Linear | Vercel",
      positioning:
        "give engineers instant, trustworthy clarity into what their production systems are doing",
    },
    lexicon:
      'category words: signal, pulse, beacon, lantern, compass, tempo, current, thread, keen, vigil, steady, swift, clear, ledger, north, watch, sentry, relay, grid, flux',
    productNouns: ["monitor", "tracer", "logger", "dashboard", "tool"],
    subsegmentTerms: ["kubernetes", "grafana", "datadog", "opentelemetry"],
  },
  {
    id: "clean_skincare",
    product_description: "A minimalist clean-beauty facial serum for sensitive skin",
    keywords: ["skincare", "clean", "gentle", "minimal"],
    vibe: ["calm", "pure", "understated"],
    target_audience: "People with sensitive skin who want simple, honest formulations",
    name_length: "any",
    name_style: "auto",
    style_buckets: DEFAULT_BUCKETS,
    brief: {
      avoid: "glow, derma, serum",
      territories:
        "calm and quiet restoration | bareness and honest simplicity | soft light at the edge of morning | the ritual of caring for oneself | water, air and elemental purity",
      references: "Aesop | Byredo | Le Labo",
      positioning:
        "a calm, honest, minimal serum that treats sensitive skin with quiet care",
    },
    lexicon:
      'category words: calm, still, veil, dawn, linen, water, breath, bare, soften, tender, quiet, balm, rest, gentle, clear, hush, dew, petal, silk, poise',
    productNouns: ["serum", "cream", "lotion", "moisturizer", "cleanser"],
    subsegmentTerms: ["retinol", "niacinamide", "hyaluronic", "vitamin-c"],
  },
  {
    id: "teen_fintech",
    product_description: "A savings and first-investing app for teenagers, with parental oversight",
    keywords: ["finance", "teens", "savings", "growth"],
    vibe: ["approachable", "empowering", "modern"],
    target_audience: "Teenagers learning money habits, and the parents who set them up",
    name_length: "short",
    name_style: "auto",
    style_buckets: DEFAULT_BUCKETS,
    brief: {
      avoid: "coin, cash, bank",
      territories:
        "small habits that compound over time | first steps and learning to grow | confidence and coming of age | seeds, sprouts and natural growth | momentum and forward motion",
      references: "Duolingo | Robinhood | Notion",
      positioning:
        "make a teenager's first money habits feel approachable, empowering and quietly grown-up",
    },
    lexicon:
      'category words: sprout, acorn, sapling, nest, ladder, spark, momentum, compass, stride, ripple, tide, grow, root, ascend, north, orbit, seed, climb, current, dawn',
    productNouns: ["bank", "wallet", "account", "app", "card"],
    subsegmentTerms: ["roth", "etf", "crypto", "401k"],
  },
  {
    id: "wooden_toys",
    product_description: "Heirloom-quality wooden toys for young children",
    keywords: ["toys", "children", "wood", "heritage"],
    vibe: ["warm", "timeless", "playful"],
    target_audience: "Parents and gift-givers wanting durable, natural, keepsake toys",
    name_length: "any",
    name_style: "auto",
    style_buckets: DEFAULT_BUCKETS,
    brief: {
      avoid: "block, play, tot",
      territories:
        "heirlooms passed from hand to hand | wonder and small discoveries | the workshop and honest making | woodland, meadow and natural materials | timeless warmth and nostalgia",
      references: "Muji | Hario | Flensted",
      positioning:
        "warm, timeless wooden toys made to be kept, handed down, and loved for years",
    },
    lexicon:
      'category words: whittle, grain, timber, meadow, acorn, thicket, lantern, spindle, nook, workshop, heirloom, wonder, hollow, birch, maple, tumble, tinker, sprout, hearth, dawn',
    productNouns: ["toy", "block", "puzzle", "game", "playset"],
    subsegmentTerms: ["montessori", "waldorf", "lego", "duplo"],
  },
  {
    id: "beginner_strength",
    product_description: "A strength-training app that coaches total beginners with simple plans",
    keywords: ["fitness", "strength", "beginner", "coaching"],
    vibe: ["motivating", "grounded", "encouraging"],
    target_audience: "People new to the gym who feel intimidated by fitness apps",
    name_length: "short",
    name_style: "auto",
    style_buckets: DEFAULT_BUCKETS,
    brief: {
      avoid: "gym, muscle, rep",
      territories:
        "the first step and starting from zero | steady progress and small wins | grounded strength and solid foundations | momentum and building a habit | a patient coach in your corner",
      references: "Duolingo | Strava | Headspace",
      positioning:
        "make starting strength training feel achievable and encouraging for total beginners",
    },
    lexicon:
      'category words: stride, footing, anchor, root, ascend, tempo, base, forge, steady, rise, ground, sturdy, climb, momentum, keel, spark, north, ready, build, dawn',
    productNouns: ["gym", "workout", "trainer", "program", "app"],
    subsegmentTerms: ["crossfit", "powerlifting", "deadlift", "peloton"],
  },
];

// Convenience: a single brief by id (handy for focused debugging).
export const briefById = (id: string): FrozenBrief | undefined =>
  BRIEFS.find((b) => b.id === id);

// Re-export for the generator's benefit.
export type { Candidate };
