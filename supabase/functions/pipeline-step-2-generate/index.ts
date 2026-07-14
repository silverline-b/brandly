import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── LLM providers ────────────────────────────────────────────────────────────
// Naming + judging run on Claude (Sonnet 5) when ANTHROPIC_API_KEY is set, and
// fall back to OpenAI (gpt-4o) so runs never hard-fail if the key is missing.

// Quality is created during generation, so the brief + name generation run on
// the most capable model (Opus 4.8). The judge is a cheaper scoring pass, so it
// runs on Sonnet 5 to control cost. Both are Claude-5-family and share the same
// adaptive-thinking API (output_config.effort; no `temperature`).
const ANTHROPIC_GEN_MODEL = "claude-opus-4-8";
const ANTHROPIC_JUDGE_MODEL = "claude-sonnet-5";
const OPENAI_MODEL = "gpt-4o";

// Extended-thinking + token budgets for Claude. Thinking counts against
// max_tokens, so max_tokens is set well above (budget + expected JSON output).
// Style calls run in parallel (6 at once), so their latency overlaps; the judge
// runs once. Budgets are kept modest to stay under the edge-function time limit.
// Effort is tuned against the edge-function 150s WALL-CLOCK limit. A high-effort
// judge on ~150 names took >90s and, on top of ~60s generation, blew the limit —
// step-2 was killed mid-judge and runs froze at "classified". Generation keeps
// adaptive thinking (quality) at LOW effort (faster); the judge is a scoring pass
// that needs no thinking, so it runs thinking-OFF (fast). This keeps step-2 well
// under the limit with margin to spare, even under duplicate/loop load.
// Per Anthropic-call ceiling (ms). Set BELOW the slowest Opus calls on purpose:
// when an Opus chunk exceeds this it is retried on the faster Sonnet 5 (see
// generateForStyle) rather than dropped — this is what stopped the slow `compound`
// style from vanishing. 60s leaves room for the Sonnet retry (~40s) to still finish
// before the 125s hard deadline. Fast Opus chunks (<60s) keep Opus quality; slow
// ones fall to Sonnet. Well under the 150s wall, so no freeze risk.
// Overridable via CLAUDE_TIMEOUT_MS ONLY for off-platform runs (e.g. the harness on
// a dev machine, which has no 150s wall and can afford ~240000 to keep Opus). The
// default stays 60000 so production — where the env var is never set — is unchanged.
const CLAUDE_TIMEOUT_MS = Number(Deno.env.get("CLAUDE_TIMEOUT_MS") ?? "60000");
// True ONLY when imported as a library by the off-platform harness, which sets
// BRANDLY_LIB_IMPORT before importing this module (same flag that suppresses
// Deno.serve). Production never sets it. Used to disable the silent Opus→Sonnet
// fallback so a measurement run can never be quietly model-contaminated.
const HARNESS_MODE = Boolean(Deno.env.get("BRANDLY_LIB_IMPORT"));
// Per-call output-token ceiling. With adaptive thinking ON, this budget covers
// BOTH the thinking tokens AND the emitted names — so a slow style (compound) can
// spend the whole 12000 thinking and hit stop_reason=max_tokens with EMPTY content
// before writing a single name. Overridable via GEN_MAX_TOKENS ONLY for off-platform
// harness runs (e.g. set 32000 so Opus can think AND still write the batch). The
// default stays 12000 so production — where the env var is never set — is unchanged.
const GEN_MAX_TOKENS = Number(Deno.env.get("GEN_MAX_TOKENS") ?? "12000");
// Generation effort. The judge now runs in its OWN function (pipeline-step-2b),
// so step-2 spends the whole 150s on generation. Still: individual HIGH-effort
// Opus calls ran ~100s even alone, so high can't cover 150 names in one function.
// "medium" is the ceiling here — a real step up from the old "low" (which produced
// zero high-quality names) and, together with the concurrency limiter below, it
// finishes with every name coming from Opus (no gpt-4o fallback garbage).
const GEN_EFFORT = "medium";
// Max names per Opus call. Small so each call is independent and many overlap.
// With concurrency 8 the first wave (~8 chunks) covers the whole 150-name target
// from the highest-priority styles and lands well before the hard deadline.
const GEN_CHUNK_SIZE = 16;
// Hard wall-clock deadline for the whole generation phase (ms from step-2 start).
// When reached, step-2 stops waiting for straggler chunks and proceeds to write
// whatever finished + hand off — so it can NEVER be killed at the 150s function
// wall before writing (which froze runs at "classified"). Leaves ~25s for the
// dedup + insert + status update.
const GEN_HARD_DEADLINE_MS = 125000;
const JUDGE_MAX_TOKENS = 16000;
const JUDGE_EFFORT = "";   // "" = thinking disabled for the judge (scoring needs no reasoning; keeps step-2 fast)

export interface LLMKeys {
  anthropic: string;
  openai: string;
}

interface LLMResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
}

async function callClaude(
  anthropicKey: string,
  system: string,
  user: string,
  maxTokens: number,
  effort: string,
  model: string
): Promise<LLMResult> {
  // Sonnet 5 API constraints (both return 400 otherwise):
  //   1. `temperature` is rejected — never send it (only the OpenAI fallback takes it).
  //   2. The old manual `thinking:{type:"enabled",budget_tokens}` is rejected. Sonnet 5
  //      uses ADAPTIVE thinking controlled by output_config.effort:
  //      "low" | "medium" | "high" | "max". Thinking (which we DO want — it improves
  //      name quality) counts against max_tokens, so keep max_tokens generous.
  // Pass effort="" to turn thinking OFF (thinking:{type:"disabled"}) for tiny calls
  // like the brief where reasoning only adds latency.
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (effort) {
    body.thinking = { type: "adaptive" };
    body.output_config = { effort };
  } else {
    body.thinking = { type: "disabled" };
  }
  // Hard per-call timeout. Without this, a single hung Anthropic request blocks
  // the whole function until the 150s edge-function wall — which froze runs. On
  // timeout we abort and throw, so generate() falls back to OpenAI for this one
  // call and the run still completes fast. Healthy calls return in ~3-15s, so
  // CLAUDE_TIMEOUT_MS gives generous headroom while capping the worst case.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  let data: any;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message ?? JSON.stringify(data).slice(0, 400);
      console.error(`[step-2] Anthropic API error ${res.status}: ${msg}`);
      throw new Error(`Anthropic ${res.status}: ${msg}`);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.error(`[step-2] Anthropic call timed out after ${CLAUDE_TIMEOUT_MS}ms (model=${model})`);
      throw new Error(`Anthropic timeout after ${CLAUDE_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  // Only `text` blocks carry output; ignore any thinking/other block types.
  const content = Array.isArray(data.content)
    ? data.content
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b?.text ?? "")
        .join("")
    : "";
  if (!content) {
    console.error(
      `[step-2] Anthropic returned empty content (stop_reason=${data?.stop_reason}):`,
      JSON.stringify(data).slice(0, 400)
    );
    throw new Error(`Anthropic returned empty content (stop_reason=${data?.stop_reason})`);
  }
  return {
    content,
    tokensIn: data.usage?.input_tokens ?? 0,
    tokensOut: data.usage?.output_tokens ?? 0,
  };
}

async function callOpenAI(
  openaiKey: string,
  system: string,
  user: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  };
}

// Provider selection: prefer Claude, fall back to OpenAI. `temperature` applies
// only to the OpenAI fallback — Sonnet 5 rejects it (see callClaude). `effort`
// applies only to Claude (adaptive thinking); the OpenAI fallback ignores it.
// `fallbackToOpenAI` is TRUE for small utility calls (brief/seed/cleanup) so they
// never hard-fail — but FALSE for the actual NAME generation. gpt-4o ignores our
// category brief and coins off-brief, category-blind garbage ("random" names);
// a name chunk is better DROPPED (we over-generate) than written by the weak
// fallback, so naming stays Opus-only.
async function generate(
  keys: LLMKeys,
  system: string,
  user: string,
  temperature: number,
  maxTokens = 4000,
  effort = "",
  model = ANTHROPIC_GEN_MODEL,
  fallbackToOpenAI = true
): Promise<LLMResult> {
  if (keys.anthropic) {
    try {
      return await callClaude(keys.anthropic, system, user, maxTokens, effort, model);
    } catch (err) {
      // Claude failed (bad key, no credits, model access, rate limit, timeout…).
      if (fallbackToOpenAI && keys.openai) {
        console.warn("[step-2] Claude failed, falling back to OpenAI:", err.message);
        return await callOpenAI(keys.openai, system, user, temperature, maxTokens);
      }
      throw err;
    }
  }
  return await callOpenAI(keys.openai, system, user, temperature, maxTokens);
}

function providerName(keys: LLMKeys): "anthropic" | "openai" {
  return keys.anthropic ? "anthropic" : "openai";
}

// Rough per-million-token pricing for cost logging only (not billing-accurate).
function estimateCost(keys: LLMKeys, tokensIn: number, tokensOut: number): number {
  // Rough: generation (the bulk of tokens) is Opus; the judge is Sonnet. Use an
  // Opus-weighted blend for the Anthropic path — this is diagnostic only.
  if (keys.anthropic) return (tokensIn * 12 + tokensOut * 60) / 1_000_000; // Opus-weighted blend
  return (tokensIn * 5 + tokensOut * 15) / 1_000_000; // gpt-4o
}

// ─── Style definitions ────────────────────────────────────────────────────────
// Product-agnostic: every style teaches a universal naming *principle* and uses
// real brand examples drawn from many industries. All product-specific context
// (what to lean into, what to avoid) comes from the per-run brand brief — never
// from these constants. Do NOT reintroduce vertical-specific wording here.

const STYLE_PROMPTS: Record<string, { instruction: string; examples: string }> = {
  brandable: {
    instruction:
      "Generate invented words with NO recognisable roots — fully coined, like Kodak or Zappos. The name becomes meaningful only through branding. Focus on phonetic quality: a good invented name has a memorable sound pattern (consonant symmetry, strong opening, clean rhythm), can be pronounced unambiguously, and feels like it COULD carry the brand's meaning even though it doesn't yet. It is NOT a random string of syllables.",
    examples:
      'Good: "Kodak" (K-D-K symmetry), "Zappos" (z-punch + open vowel flow), "Twilio" (clean 3-syllable rhythm), "Zynga" (Z-energy + -inga rhythm), "Hulu" (soft, repeatable). Bad: "Gavory", "Lefora", "Remega", "Xalivo" — random consonant-vowel shuffles with no phonetic hook; a stranger would forget them instantly.',
  },
  evocative: {
    instruction:
      "Generate real English words used as brand names that evoke the product's core BENEFIT or the feeling of using it — a meaningful, on-brief association the customer can intuit — WITHOUT being a literal or generic description of the product or its category. The name should hint at the brand's world while still reading as a brand, not a label. Aim for a subtle semantic thread (intrigue + meaning), not an explanation.",
    examples:
      'Good: "Stripe" (payments — evokes clean precision, not money), "Loom" (video — evokes weaving/craft, not recording), "Mint" (finance — freshness, not money), "Halo" (protection without naming it). Bad: any word that literally describes the product or its category — these are taglines, not brand names. A name that explains what the product is before purchase destroys the intrigue that makes a brand name powerful.',
  },
  compound: {
    instruction:
      "Generate portmanteau words that fuse two roots so naturally the seam disappears — the result sounds like a single real word, not two words glued together. One root should be grounded in the brand's world; the other should come from an unexpected, contrasting domain. The creative leap between the two roots is what makes the name memorable.",
    examples:
      'Good: "Pinterest" (pin+interest — seam invisible), "Snapchat" (snap+chat — feels natural), "Mailchimp" (mail+chimp — unexpected second root), "Netflix" (net+flicks), "Groupon" (group+coupon). Bad: "Hugaloft" (you hear the join), "Hopnest" (two generic words, no leap), "Cryptail" (mismatched roots) — the seam is audible or both halves are on-the-nose.',
  },
  alternate_spelling: {
    instruction:
      "Two steps: (1) Choose a base word with genuine emotional resonance relevant to the brand's positioning. (2) Apply exactly ONE transformation: drop internal vowels (tumbler→Tumblr), double a consonant (fiver→Fiverr), swap a vowel sound (lift→Lyft), or phonetically respell a syllable (flicker→Flickr). The original word must remain unmistakably recognisable through the transformation.",
    examples:
      'Good: "Lyft" (lift — one vowel swap), "Tumblr" (tumbler — drop vowel), "Fiverr" (fiver — double consonant), "Flickr" (flicker — drop vowel), "Grindr" (grinder). Bad: "Placidk", "Sootheq", "Wormlte" — these apply so many changes the base word is unrecognisable, or bolt on tech suffixes (-q, -ix) that create the wrong register entirely.',
  },
  non_english: {
    instruction:
      "Generate words from non-English languages (Latin, Greek, French, Italian, Spanish, Japanese, Scandinavian, Sanskrit, Portuguese, etc.) that express an ABSTRACT BRAND QUALITY — not a translation of anything in the product's description. Think: swift, trust, light, grace, joy, together, calm, pure, bright, bold. The meaning should add aspiration and dimension to the brand. It should NOT simply be the product described in another language.",
    examples:
      'Good: "Volvo" (Latin: I roll — action, not car), "Audi" (Latin: I hear — sensation, not audio), "Lego" (Danish: play well — quality, not toy), "Fika" (Swedish: the joy of a shared moment), "Kairos" (Greek: the perfect moment), "Amara" (grace/eternal), "Velox" (Latin: swift), "Luce" (Italian: light). Bad: any foreign word that simply translates the product noun or the customer — any speaker of that language sees through it immediately.',
  },
  real_words: {
    instruction:
      "Generate real dictionary English words used as brand names that are unexpected and non-literal, but still RESONATE with the product's world — its subject, that subject's behaviour or character, the owner's bond with it, or the activity of using it. The word should make a stranger sense the world the brand lives in, without describing the product. Surprising but ON-THEME — not arbitrary words (random materials, unrelated objects, textures) that give no hint of the category and could belong to any brand. ABSOLUTE REQUIREMENT: every name MUST be a single, real word that appears in a standard English dictionary, spelled correctly. Do NOT invent words, do NOT bolt a suffix (-ly, -ine, -ary, -esque, -en) onto a word to fabricate a new one (suffix-fabricated names like \"Havenly\", \"Velvetine\", \"Emberly\" are rejects), and do NOT misspell a real word. If a stranger could not find it in a dictionary, it does NOT belong in this style — that is coining or alternate-spelling, which are different styles the user did not pick.",
    examples:
      'Good (unexpected but you still sense the world): "Slack" (workplace — ease/informality), "Buffer" (social scheduling — a buffer of posts), "Rover" (dog care — a dog\'s name), "Bumble" (dating — buzz/first approach), "Hinge" (dating — the pivotal connection), "Discord" (gaming chat — lively chatter). Bad: "Valor", "Apex", "Clarity", "Nexus" (generic corporate register); AND arbitrary words that give NO hint of the category — "Mohair", "Suede", "Merino", "Zephora" for a pet product could sell anything and so miss the brief. Also bad: any word that literally describes the product.',
  },
};

const STYLE_MAP: Record<string, string> = {
  brandable: STYLE_PROMPTS.brandable.instruction,
  evocative: STYLE_PROMPTS.evocative.instruction,
  compound: STYLE_PROMPTS.compound.instruction,
  alternate_spelling: STYLE_PROMPTS.alternate_spelling.instruction,
  non_english: STYLE_PROMPTS.non_english.instruction,
  real_words: STYLE_PROMPTS.real_words.instruction,
  auto: "Generate a diverse mix of all naming styles: invented words, evocative names, compound words, real words used arbitrarily, and alternate spellings.",
};

const LENGTH_MAP: Record<string, string> = {
  short: "Names should be 1–2 syllables, 3–7 characters where possible (e.g. Lyft, Zoom, Slack)",
  medium: "Names should be 2–3 syllables, 6–10 characters where possible (e.g. Spotify, Notion, Stripe)",
  long: "Names should be 3–4 syllables, 8–14 characters where possible (e.g. Salesforce, Mailchimp)",
  any: "",
};

// ─── Candidate parsing ───────────────────────────────────────────────────────

export interface Candidate {
  name: string;
  components: string[];
  style?: string;        // which naming style produced it (for per-style quotas downstream)
  quality_score?: number;
  quality_reason?: string;
}

function parseCandidates(content: string): Candidate[] {
  const stripped = content.replace(/```[a-z]*\n?/gi, "").trim();
  const match = stripped.match(/\[[\s\S]*\]/);
  const parsed = JSON.parse(match ? match[0] : stripped);
  if (!Array.isArray(parsed)) throw new Error("Not an array");

  return parsed
    .map((x: any): Candidate | null => {
      // Support both plain strings (fallback) and objects {name, components}
      if (typeof x === "string" && x.trim().length > 0 && x.trim().length <= 40) {
        return { name: x.trim(), components: [] };
      }
      if (
        x &&
        typeof x === "object" &&
        typeof x.name === "string" &&
        x.name.trim().length > 0 &&
        x.name.trim().length <= 40
      ) {
        const components = Array.isArray(x.components)
          ? x.components.filter((c: any) => typeof c === "string" && c.length >= 4)
          : [];
        return { name: x.name.trim(), components };
      }
      return null;
    })
    .filter((x): x is Candidate => x !== null);
}

// ─── Brand strategy brief ─────────────────────────────────────────────────────
// Generated once per run before the style calls. Gives every style call a
// strategic anchor derived from THIS product — so all product-specific context
// lives here, not in the (vertical-neutral) style constants.

export interface BrandBrief {
  avoid: string;        // product-literal words AND category clichés AND famous brands — all excluded
  territories: string;  // 5 DISTINCT, contrasting brand territories (different angles, not synonyms)
  references: string;   // 3 real brands from unrelated categories with similar positioning
  positioning: string;  // one-sentence brand positioning to anchor the naming
}

async function generateBrandBrief(
  keys: LLMKeys,
  productDescription: string,
  keywords: string[],
  vibe: string[]
): Promise<{ brief: BrandBrief; tokensIn: number; tokensOut: number }> {
  // Used only if the (per-run, product-derived) brief generation fails. It must
  // stay industry- AND aesthetic-neutral — no baked-in vertical, tone, or house
  // style — so a failed brief never nudges names toward any particular niche.
  // We derive what we can from the run's own inputs; the rest is generic.
  const fallback: BrandBrief = {
    avoid: "words that literally describe or are synonymous with the product's function or its customer, the category's overused cliché words, and any well-known existing brand names",
    territories: vibe.length
      ? vibe.join(" | ")
      : "the core functional benefit | an aspirational identity or status | a sensory or aesthetic quality | an emotional relationship | an unexpected, lateral angle",
    references: "",
    positioning: productDescription
      ? `a distinctive, memorable brand for: ${productDescription}`
      : "a distinctive, memorable brand with a clear identity",
  };

  try {
    const system =
      "You are a brand strategist which specializes in branding and brand name generation.";
    const user = `A client is launching this product: "${productDescription}"
Keywords: ${keywords.join(", ")}${vibe.length ? `\nDesired vibe: ${vibe.join(", ")}` : ""}

First, silently identify the CONCRETE SUBJECT this product centres on — the actual thing, person, or activity it is for or about (e.g. a dog, a runner, a toddler, a cup of coffee, a garden). Name it concretely in your head; do NOT abstract it into a vague word like "companion", "user", or "item". The whole brief must keep that concrete subject visible, because a name only signals its category when it carries a thread back to that subject's real world.

Write a concise brand naming brief. Return a JSON object with exactly these four fields:
- "avoid": a VERY SHORT comma-separated list of ONLY the 1-3 MOST SATURATED words in this category — the handful so overused across existing brands that they can no longer clear trademark (for a pet brand: paw, fur, tail; for a coffee brand: bean, brew, roast) — PLUS any well-known existing brand names to steer clear of. HARD CAP: at most 3 saturated words (brand names do NOT count toward the 3). Do NOT blacklist the broader category vocabulary: the fresh, less-obvious words from this subject's world (what the subject DOES, how it behaves, its characteristic traits and roles, the objects/places/actions associated with it — e.g. snout, wag, den for pets) are ENCOURAGED raw material and must NOT appear here. This list removes only those few tired words, never the theme.
- "territories": exactly 5 brand territories that are CONCEPTUALLY ORTHOGONAL — genuinely DIFFERENT ideas, NOT five variations of the same feeling. Two hard requirements: (1) AT LEAST 2 of the 5 must be anchored in the CONCRETE SUBJECT's own world — what the subject IS, does, or how it behaves; its character, energy, or role; the specific bond the customer has with THAT subject (not a generic product feeling). These are what let names actually signal the category. (2) AT MOST ONE territory may be about the product's most obvious benefit/feeling (e.g. comfort, convenience, luxury) — do NOT let the set collapse into product-experience angles that could describe an unrelated category. The remaining territories can explore identity, lifestyle, activity/place, status, or one fresh unexpected angle. Every territory must still clearly belong to THIS subject's world yet evoke a DIFFERENT idea, so names drawn from them will not all sound alike. Separate with " | "
- "references": exactly 3 real brand names from UNRELATED industries whose positioning or feeling this product should echo, separated by " | "
- "positioning": one sentence describing the specific feeling or aspiration this brand should own — and it must name the CONCRETE subject explicitly (say "small dogs", not "small companions"), so the subject is never abstracted away

You respond only in valid JSON with no markdown, no explanation

Return ONLY the JSON object.`;

    const { content, tokensIn, tokensOut } = await generate(keys, system, user, 0.7, 1200);
    // Extract the JSON object rather than parsing the whole reply — the model
    // sometimes wraps it in prose, which broke parsing and forced the generic
    // fallback brief (losing the product-specific territories).
    const cleaned = content.replace(/```[a-z]*\n?/gi, "").trim();
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(objMatch ? objMatch[0] : cleaned);

    // The model is asked for delimited strings, but sometimes returns arrays (or
    // odd types). Coerce EVERY field to a string so downstream string operations
    // — especially territories.split("|") — can never crash and freeze the run.
    const toStr = (v: unknown, join: string, fb: string): string => {
      if (Array.isArray(v)) {
        const s = v.map((x) => String(x).trim()).filter(Boolean).join(join);
        return s || fb;
      }
      if (typeof v === "string" && v.trim()) return v.trim();
      return fb;
    };

    return {
      brief: {
        avoid: toStr(parsed.avoid, ", ", fallback.avoid),
        territories: toStr(parsed.territories, " | ", fallback.territories),
        references: toStr(parsed.references, " | ", fallback.references),
        positioning: toStr(parsed.positioning, " ", fallback.positioning),
      },
      tokensIn,
      tokensOut,
    };
  } catch (err) {
    console.warn("[step-2] brand brief generation failed, using fallback:", err.message);
    return { brief: fallback, tokensIn: 0, tokensOut: 0 };
  }
}

// ─── Subject lexicon (the fix for weak category signal) ──────────────────────
// Names kept failing to signal their category because the model, told to avoid
// the clichés, defaulted to PRODUCT words (sling/pouch) or generic feelings
// (snug/luxe) instead of the SUBJECT's own vocabulary. This pre-pass builds a
// rich bank of FRESH, non-cliché words tied to the concrete subject (a dog's
// gaits/breeds/roles, a runner's strides, coffee's rituals…) and feeds it into
// every style prompt as raw material, so generation reaches for on-category
// vocabulary from the start — quality at the source, not a downstream filter.
// Industry-agnostic: the subject is derived from the product description.
async function generateSubjectLexicon(
  keys: LLMKeys,
  productDescription: string,
  keywords: string[]
): Promise<{ lexicon: string; tokensIn: number; tokensOut: number }> {
  try {
    const system =
      "You are a brand-naming researcher. You build a bank of fresh, evocative, NON-cliché vocabulary rooted in a product's SUBJECT — the concrete thing, person, animal, or activity the product is FOR or ABOUT — as raw material for brand-name generation. You respond only in valid JSON, no markdown.";
    const user = `Product: "${productDescription}"
Keywords: ${keywords.join(", ")}

Identify the CONCRETE SUBJECT this product centres on (e.g. for a dog sling → the DOG; for a running shoe → the RUNNER; for a coffee bag → COFFEE). Then produce a rich, WIDE bank of FRESH, specific, LESS-OBVIOUS words a stranger would associate with THAT subject's world — the raw material for names that instantly signal this category.

RIGHT ALTITUDE (critical): every word must sit at the level of the WHOLE category, resonating across the ENTIRE target market — never a sub-segment. A word that only part of the audience identifies with is TOO NARROW and alienates the rest: for a dog product, use what is true of ALL dogs (pup, hound, lapdog, the walk, loyalty), NEVER specific breeds (corgi, yorkie, papillon) — a breed name only appeals to that breed's owners. Likewise avoid specific models, niche sub-hobbies, or insider terms. But do NOT drift so high that the word leaves the category (comfort, cozy, premium could be anything). Aim for the middle: unmistakably THIS category, inclusive of everyone in it.

CONCEPTUAL BREADTH IS ALSO THE GOAL: the name-builder needs base words of MANY different flavours, not five shades of one idea. Deliberately span the subject's full world — its energy AND its calm, indoors AND outdoors, everyday AND cultural. Within EACH list, vary widely and avoid near-synonyms (do not fill a list with eight words that all mean "cozy" or "small").

Return a JSON object with these arrays (aim for 8-12 words each, single real words, lowercase):
- "actions": the full RANGE of what the subject does — movement, play, rest, interaction (dog → trot, prance, scamper, romp, bound, fetch, dig, guard, wander, doze). Don't let this collapse into only "cute" verbs.
- "kinds": only GENERAL, category-wide types the whole audience shares — NEVER specific breeds/sub-varieties that split the audience (dog → pup, hound, lapdog, mutt; NOT corgi/yorkie/poodle)
- "roles": characterful roles/personas of the subject (dog → sidekick, rascal, scout, guardian, companion, explorer)
- "traits": sensory or character traits — mix physical, temperament, and spirit (dog → perky, plucky, loyal, keen, spry, bold, gentle)
- "world": places, objects, activities, and moments across the subject's WHOLE life — indoors and out, everyday and special (dog → den, meadow, trail, park, hearth, campfire, hillside, hydrant)
- "bond": the relationship and feeling between the subject and its person (dog → loyalty, devotion, kinship, trust, faithful, unconditional, sidekick)
- "lore": broad cultural, mythic, or historical associations with the subject — category-wide, not breed-specific (dog → sirius, argos, wolf, moon, hearth, folklore)

RULES:
- FRESH and specific — reach PAST the obvious. NO tired clichés (for pets: paw, fur, tail, woof, snout, pooch).
- AUDIENCE-WIDE altitude (see above): absolutely NO specific breeds/models/sub-types anywhere in the bank — they narrow the appeal to a sub-segment.
- Do NOT include the PRODUCT noun or how it is carried/used (for a dog sling: NOT sling, pouch, carrier, tote, wrap) — those describe the product, not the subject.
- Real words only (a few broad proper nouns allowed in "lore"); no invented words.

Return ONLY the JSON object.`;

    const { content, tokensIn, tokensOut } = await generate(keys, system, user, 0.7, 1300);
    const cleaned = content.replace(/```[a-z]*\n?/gi, "").trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : cleaned);

    const cats = ["actions", "kinds", "roles", "traits", "world", "bond", "lore"];
    const lines: string[] = [];
    for (const c of cats) {
      const arr = Array.isArray(parsed[c])
        ? parsed[c].map((x: any) => String(x).trim().toLowerCase()).filter(Boolean)
        : [];
      if (arr.length) lines.push(`${c}: ${arr.join(", ")}`);
    }
    return { lexicon: lines.join("\n"), tokensIn, tokensOut };
  } catch (err) {
    console.warn("[step-2] subject lexicon generation failed:", err.message);
    return { lexicon: "", tokensIn: 0, tokensOut: 0 };
  }
}

// ─── Category word bank via Datamuse (reliable, human-derived) ───────────────
// The LLM-improvised lexicon (above) proved unreliable: it either drifted to
// product/feeling words OR the brief's AVOID list blacklisted the very words we
// wanted (snout, pup), starving generation of category vocabulary. Instead we
// source the raw category words from Datamuse — a free word-association API whose
// rankings come from REAL human corpora — so every word we hand the name-builder
// is one people GENUINELY associate with the category. The LLM is used only for
// what it is reliable at over a GIVEN list: naming the seed and a light editorial
// cull. Industry-agnostic: the seed is derived from the product description.

const DATAMUSE_TIMEOUT_MS = 5000;

async function fetchDatamuse(
  rel: string,
  word: string,
  max: number
): Promise<Array<{ word: string; score?: number; tags?: string[] }>> {
  const url = `https://api.datamuse.com/words?${rel}=${encodeURIComponent(word)}&max=${max}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATAMUSE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (_err) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Keep the STRONGEST association score seen for each word across the endpoints.
function accScore(
  map: Map<string, number>,
  r: { word?: string; score?: number }
): void {
  const w = (r.word ?? "").toLowerCase().trim();
  if (!w) return;
  const s = typeof r.score === "number" ? r.score : 1;
  map.set(w, Math.max(map.get(w) ?? 0, s));
}

// Ask the model ONLY to name the concrete category seed(s) — the single most
// reliable thing to feed Datamuse. Falls back to keywords if it fails.
async function extractCategorySeeds(
  keys: LLMKeys,
  productDescription: string,
  keywords: string[]
): Promise<{ seeds: string[]; productWords: string[]; tokensIn: number; tokensOut: number }> {
  const fallbackSeeds = keywords
    .map((k) => String(k).trim().toLowerCase())
    .filter((k) => /^[a-z]{2,}$/.test(k))
    .slice(0, 2);
  try {
    const system =
      "You identify the core category noun(s) of a product for a word-association lookup. Respond only in valid JSON, no markdown.";
    const user = `Product: "${productDescription}"
Keywords: ${keywords.join(", ")}

Return JSON: {"seeds": [...], "product_words": [...]}
- "seeds": 1-3 SINGLE common nouns naming the CONCRETE SUBJECT a shopper associates with this product, at the WHOLE-category level (for a dog sling carrier → ["dog","pet"]; for a running shoe → ["runner","running"]; for a coffee bag → ["coffee"]). General form only — NEVER a breed, model, or sub-type (never "chihuahua").
- "product_words": the nouns naming the PRODUCT/format itself, to EXCLUDE from association (for a dog sling → ["sling","carrier"]).
Return ONLY the JSON object.`;
    // Tiny JSON extraction → run on Sonnet, thinking off (fast, cheap).
    const { content, tokensIn, tokensOut } = await generate(keys, system, user, 0.2, 400, "", ANTHROPIC_JUDGE_MODEL);
    const m = content.replace(/```[a-z]*\n?/gi, "").match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    const norm = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.map((x) => String(x).trim().toLowerCase()).filter((s) => /^[a-z]{2,}$/.test(s))
        : [];
    const seeds = norm(parsed.seeds).slice(0, 3);
    return {
      seeds: seeds.length ? seeds : fallbackSeeds,
      productWords: norm(parsed.product_words).slice(0, 6),
      tokensIn,
      tokensOut,
    };
  } catch (err) {
    console.warn("[step-2] seed extraction failed, using keyword fallback:", err.message);
    return { seeds: fallbackSeeds, productWords: [], tokensIn: 0, tokensOut: 0 };
  }
}

// Light editorial cleanup of the Datamuse bank — the ONE judgment LLMs are
// reliable at over a GIVEN list: flag the overused branding clichés and drop
// off-category / proper-noun noise. Returns the kept words + the clichés to avoid.
async function cleanupCategoryWords(
  keys: LLMKeys,
  productDescription: string,
  seeds: string[],
  words: string[]
): Promise<{ kept: string[]; overused: string[]; tokensIn: number; tokensOut: number }> {
  if (words.length === 0) return { kept: [], overused: [], tokensIn: 0, tokensOut: 0 };
  try {
    const system =
      "You are a brand-naming researcher pruning a word list. Respond only in valid JSON, no markdown.";
    const user = `Product: "${productDescription}" (category: ${seeds.join(", ")})

Below is a list of words people associate with this category, from a word-association database. Curate it into raw material for brand-name generation.

WORDS: ${words.join(", ")}

Return JSON: {"overused": [...], "keep": [...]}
- "overused": the 2 words here that are the most OVERUSED, on-the-nose clichés in EXISTING brand names in this category (e.g. for pets: paw, woof; for coffee: bean, brew). These get excluded.
- "keep": 20-28 of the REMAINING words that would make a stranger sense THIS category — favour concrete, evocative, slightly-less-obvious words (e.g. snout, pup, hound, fetch, kibble, muzzle, wag, canine over flat generic ones). REMOVE: the 2 overused words; proper nouns and existing brand names; words for a DIFFERENT/adjacent category (e.g. "cat" for a dog product); breeds/models/sub-types; and bland generic words that give no category feel. Single lowercase words only, ordered strongest-first.
Return ONLY the JSON object.`;
    // Editorial cull of a given list → run on Sonnet, thinking off (fast, cheap).
    const { content, tokensIn, tokensOut } = await generate(keys, system, user, 0.3, 900, "", ANTHROPIC_JUDGE_MODEL);
    const m = content.replace(/```[a-z]*\n?/gi, "").match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    const norm = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.map((x) => String(x).trim().toLowerCase()).filter((s) => /^[a-z]{2,}$/.test(s))
        : [];
    const overused = norm(parsed.overused).slice(0, 3);
    const over = new Set(overused);
    const kept = norm(parsed.keep).filter((w) => !over.has(w)); // never keep an overused word
    return { kept, overused, tokensIn, tokensOut };
  } catch (err) {
    console.warn("[step-2] category-word cleanup failed, using raw bank:", err.message);
    return { kept: words.slice(0, 24), overused: [], tokensIn: 0, tokensOut: 0 };
  }
}

// Orchestrator: seed → Datamuse association fetch → altitude filter → cleanup.
// Returns a buildStylePrompt-compatible lexicon string plus the overused clichés
// (merged into the brief's AVOID list) and diagnostics. Falls back to the
// LLM-improvised lexicon only if Datamuse yields nothing (network/edge issue).
async function buildCategoryBank(
  keys: LLMKeys,
  productDescription: string,
  keywords: string[]
): Promise<{
  lexicon: string;
  words: string[];
  overused: string[];
  seeds: string[];
  tokensIn: number;
  tokensOut: number;
  source: string;
}> {
  let tokensIn = 0;
  let tokensOut = 0;

  const seedRes = await extractCategorySeeds(keys, productDescription, keywords);
  tokensIn += seedRes.tokensIn;
  tokensOut += seedRes.tokensOut;
  const seeds = seedRes.seeds;
  if (seeds.length === 0) {
    return { lexicon: "", words: [], overused: [], seeds: [], tokensIn, tokensOut, source: "no-seed" };
  }

  // Per seed: rel_trg (associated words — the main signal), rel_jja (adjectives
  // describing it), rel_gen (general synonyms / hypernyms — clean whole-category
  // words like hound/pooch), ml (near-meanings). rel_spc (MORE SPECIFIC —
  // breeds/models/sub-types) is fetched only to SUBTRACT, holding the bank at
  // whole-category altitude. Polysemy noise (dog→pawl, pet→darling) is removed by
  // the cleanup pass — this stage maximises recall.
  const assocScore = new Map<string, number>();
  const tooSpecific = new Set<string>();
  await Promise.all(
    seeds.flatMap((seed) => [
      fetchDatamuse("rel_trg", seed, 60).then((rows) => rows.forEach((r) => accScore(assocScore, r))),
      fetchDatamuse("rel_jja", seed, 25).then((rows) => rows.forEach((r) => accScore(assocScore, r))),
      fetchDatamuse("rel_gen", seed, 20).then((rows) => rows.forEach((r) => accScore(assocScore, r))),
      fetchDatamuse("ml", seed, 20).then((rows) => rows.forEach((r) => accScore(assocScore, r))),
      fetchDatamuse("rel_spc", seed, 80).then((rows) =>
        rows.forEach((r) => r.word && tooSpecific.add(r.word.toLowerCase()))
      ),
    ])
  );

  const exclude = new Set<string>([...seeds, ...seedRes.productWords]);

  // Rank by association strength, then apply the deterministic altitude + noise
  // filters (single sane word; not the seed/product noun; not a sub-type).
  const ranked = [...assocScore.entries()]
    .filter(([w]) => /^[a-z]{3,14}$/.test(w))
    .filter(([w]) => !exclude.has(w))
    .filter(([w]) => !tooSpecific.has(w))
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, 60);

  if (ranked.length === 0) {
    console.warn("[step-2] Datamuse returned no usable words, falling back to LLM lexicon");
    const lex = await generateSubjectLexicon(keys, productDescription, keywords);
    return {
      lexicon: lex.lexicon,
      words: [],
      overused: [],
      seeds,
      tokensIn: tokensIn + lex.tokensIn,
      tokensOut: tokensOut + lex.tokensOut,
      source: "llm-fallback",
    };
  }

  const clean = await cleanupCategoryWords(keys, productDescription, seeds, ranked);
  tokensIn += clean.tokensIn;
  tokensOut += clean.tokensOut;

  const words = clean.kept.length ? clean.kept : ranked.slice(0, 24);
  const lexicon = `category words (people associate these with "${seeds.join('", "')}"): ${words.join(", ")}`;
  return { lexicon, words, overused: clean.overused, seeds, tokensIn, tokensOut, source: "datamuse" };
}

// The brief author's AVOID words are authoritative: reconcile only ADDS the
// overused-cliché words on top — it NEVER subtracts from what the brief flagged.
// (Previously it stripped any avoid-word that also appeared in the category bank,
// which dropped hound/pooch/pup off the avoid list.) `_bankWords` is retained for
// call-site compatibility but intentionally unused now.
function reconcileAvoid(briefAvoid: string, _bankWords: string[], overused: string[]): string {
  const kept = briefAvoid
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of [...overused, ...kept]) {
    const k = w.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(w);
    }
  }
  return out.join(", ");
}

// ─── Build prompt for a specific style ───────────────────────────────────────

function buildStylePrompt(
  style: string,
  count: number,
  record: any,
  brief: BrandBrief,
  lexicon = ""
): { system: string; user: string } {
  const styleDef = STYLE_PROMPTS[style];
  const lengthInstruction = LENGTH_MAP[record.name_length ?? "any"] ?? "";
  const vibes: string[] = record.vibe ?? [];
  const vibeInstruction = vibes.length ? `Tone/vibe: ${vibes.join(", ")}.` : "";
  const keywords: string[] = record.keywords ?? [];
  const targetAudience =
    typeof record.target_audience === "string" && record.target_audience.trim()
      ? record.target_audience.trim()
      : "General";

  const system = `You are a senior naming consultant at a boutique brand agency. Your names will be presented to a client investing heavily in brand identity. Your job is not to fill a list — it is to generate names you would personally be proud to present in a client deck. The best names are:
- MEMORABLE and EASY TO SAY & SPELL after hearing them once (no tongue-twisters, no ambiguous spellings, no pile-ups of soft suffixes like -elle/-etta/-ette);
- MEANINGFUL — they carry a subtle thread to the brand's world, benefit, or feeling, so the name means something to the customer (without being a literal, generic description of the product);
- BRANDABLE — distinctive and ownable, not generic words that could belong to any industry (Gavory, Lefora, Valor, Apex, Clarity are rejected).
Random/forgettable names and names disconnected from the brand's world are cut in the first review.`;

  const user = `Generate exactly ${count} brand name candidates in the "${style}" style for this product:

Product/service: ${record.product_description}
Keywords: ${keywords.join(", ")}
${lengthInstruction ? `Length: ${lengthInstruction}` : ""}
${vibeInstruction}
Target audience: ${targetAudience}

━━━ BRAND STRATEGY BRIEF ━━━
Use this brief to anchor your naming within this brand's world.

The feeling/aspiration this brand should own: ${brief.positioning}
Distinct territories this brand can draw from: ${brief.territories}
>>> SPREAD this batch WIDE — draw each successive name from a DIFFERENT territory (and, when you use the category words below, a DIFFERENT word each time), cycling through them so the batch never collapses onto one angle or several variations of a single root. HARD LIMIT — at most 2 names in this ENTIRE batch may share the same root, prefix, suffix, or core concept (e.g. at most two "-pup" names, at most two "nest…" names, at most two "pouch…" names). Once you have used a root twice, you may not use it again — switch to a different territory and a genuinely different root.
${brief.references ? `Tonal reference brands (unrelated industries, same feeling): ${brief.references}\n` : ""}Words to AVOID entirely — the category's saturated clichés AND famous brand names (drawn from this list): ${brief.avoid}
ALSO NEVER coin a name that literally states the product or its physical format/container — those are descriptors, not brands. Read the Product/service line above, identify its literal product nouns (e.g. for a sling carrier: sling, carrier, tote, pouch, wrap; for coffee: coffee, bean, brew), and use NONE of them as the name or as a readable root.

${lexicon ? `━━━ CATEGORY WORDS (your PRIMARY raw material) ━━━
These are words REAL PEOPLE associate with this product's category (sourced from a
word-association database) — the exact vocabulary that makes a stranger sense the
niche. This is your main source of material:
${lexicon}
>>> ROUGHLY TWO-THIRDS of the names MUST be built from, blended from, or clearly
inspired by these words (or close kin) — so a stranger seeing ONLY the name (no logo,
no context) would guess the RIGHT category. Do NOT copy a word verbatim as the bare
name, do NOT fall back on the AVOID-list clichés, and do NOT flee so far into
abstraction that the name signals nothing — or a DIFFERENT category. The remaining
~third may range wider (abstract / premium / coined) for variety.
>>> RIGHT ALTITUDE: keep every name at the level of the WHOLE category, so ANY
customer in the target market feels it is for them. Do NOT pitch a name at a narrow
SUB-SEGMENT — e.g. never build on a specific dog breed (a "Corgi" name only appeals
to Corgi owners), a specific model, or an insider sub-hobby. Signal the category
broadly and inclusively, without drifting so high it leaves the category entirely.
` : ""}

━━━ STYLE INSTRUCTION ━━━
${styleDef.instruction}

━━━ STYLE EXAMPLES ━━━
${styleDef.examples}

━━━ RULES ━━━
- CRAFT, don't mangle. The lexicon words are INSPIRATION, not names. TWO things are BANNED: (1) submitting a bare lexicon/dictionary word as the name (e.g. "Prance", "Trot", "Dainty", "Rascal") — that is not a brand, it is just a word; and (2) bolting a filler suffix onto a lexicon word to fake a brand (e.g. "Frolico", "Nuzzada", "Prancely", "Perkora", "Boundera", "-o/-a/-ly/-ade/-ora/-elle"). Both read as lazy. Every name must be a genuinely CRAFTED brand name you would present to a paying client — transform the inspiration with real skill per the STYLE INSTRUCTION.
- No duplicates within this batch — and no NEAR-duplicates either: each name must use a DISTINCTLY different root or idea. Do NOT submit minor variations of the same word (e.g. Snug / Snugly / Snugg / Snuggle together). Vary the vocabulary widely across the whole batch.
- No existing well-known brand names (e.g. Nestle, Tiffany), and no bland, over-common dictionary words (e.g. Precious, Cherish, Devote, Adore, Cosy) — they are not ownable and read as generic
- Avoid every word on the AVOID list above, including the category clichés
- No purely descriptive marks (rejected by USPTO)
- No numbers, hyphens, or special characters
- Return ONLY a valid JSON array of exactly ${count} objects — no explanation, no markdown

Each object: { "name": string, "components": string[] }
"components" = English word roots used. Use [] for fully invented names.`;

  return { system, user };
}

// ─── Concurrency limiter ─────────────────────────────────────────────────────
// Cap how many Opus generation calls run at once. Firing every chunk at once
// rate-limit-queues them (slower, more timeouts). 8 keeps the first wave running
// unqueued so it covers the whole target from the top-priority styles (real_words,
// compound come first) and lands before the hard deadline; any later-wave tail is
// abandoned by the deadline rather than freezing the run.
const GEN_CONCURRENCY = 8;
function makeLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      const resume = queue.shift();
      if (resume) resume();
    }
  };
}
const genLimit = makeLimiter(GEN_CONCURRENCY);

// Set true when a generation call fails specifically because the Anthropic
// account is out of credits (a 400 "credit balance is too low"). When this
// happens, whole styles get dropped and the name pool collapses to the cheap
// leftovers — so we surface it LOUDLY instead of letting it look like a naming
// bug. Reset per request (module state persists across warm invocations).
let creditExhausted = false;
function isBillingError(msg: string): boolean {
  return /credit balance|billing|insufficient|purchase credits|payment required|quota/i.test(msg);
}

// ─── Chunked generation for one style ────────────────────────────────────────
// Splits a style's target into small parallel calls (≤ GEN_CHUNK_SIZE each) so
// every Opus call — now at HIGH effort — stays fast and under the per-call
// timeout. Used by BOTH AUTO (per style bucket) and single-style mode, so the
// whole run is really a wide fan of small parallel high-effort calls whose
// latency overlaps. Each chunk parses with a one-shot retry on malformed JSON.
export async function generateForStyle(
  keys: LLMKeys,
  style: string,
  totalCount: number,
  record: any,
  brief: BrandBrief,
  lexicon: string,
  deadlineAt: number
): Promise<{ candidates: Candidate[]; tokensIn: number; tokensOut: number; calls: number }> {
  const numChunks = Math.max(1, Math.ceil(totalCount / GEN_CHUNK_SIZE));

  // Each chunk pushes its result here AS IT RESOLVES. We then wait for either all
  // chunks to finish OR a hard deadline — whichever comes first — and use whatever
  // has landed. This GUARANTEES generation never blows the 150s function wall: a
  // pathologically slow straggler is simply abandoned, not waited on. Losing one
  // ~16-name chunk is harmless (we over-generate 150 for a 130 keep / 50 final).
  const done: Array<{ candidates: Candidate[]; tokensIn: number; tokensOut: number; calls: number }> = [];

  const chunkPromises = Array.from({ length: numChunks }, async (_unused, i) => {
    const count = Math.min(GEN_CHUNK_SIZE, totalCount - i * GEN_CHUNK_SIZE);
    const { system, user } = buildStylePrompt(style, count, record, brief, lexicon);
    let candidates: Candidate[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let calls = 0;

    // NAME generation is Opus-ONLY (fallbackToOpenAI=false). If Opus fails/times
    // out we DROP this chunk rather than let gpt-4o write off-brief coinages —
    // we over-generate 150 for a 50-name final list, so a lost chunk is harmless,
    // whereas gpt-4o garbage was the main source of "random, unrelated" names.
    try {
      const d1 = await genLimit(() =>
        generate(keys, system, user, 0.9, GEN_MAX_TOKENS, GEN_EFFORT, ANTHROPIC_GEN_MODEL, false)
      );
      tokensIn += d1.tokensIn;
      tokensOut += d1.tokensOut;
      calls++;
      try {
        candidates = parseCandidates(d1.content);
      } catch (parseErr) {
        // The call succeeded but returned malformed JSON — one Opus retry.
        console.warn(`[step-2] style "${style}" chunk ${i} parse failed, retrying:`, parseErr.message);
        const d2 = await genLimit(() =>
          generate(keys, system, user, 0.7, GEN_MAX_TOKENS, GEN_EFFORT, ANTHROPIC_GEN_MODEL, false)
        );
        tokensIn += d2.tokensIn;
        tokensOut += d2.tokensOut;
        calls++;
        try {
          candidates = parseCandidates(d2.content);
        } catch (parseErr2) {
          console.error(`[step-2] style "${style}" chunk ${i} parse failed twice:`, parseErr2.message);
          candidates = [];
        }
      }
    } catch (genErr) {
      const msg = genErr?.message ?? String(genErr);
      if (isBillingError(msg)) {
        creditExhausted = true;
        console.error(`[step-2] ⚠️ ANTHROPIC CREDITS EXHAUSTED — style "${style}" chunk ${i}: ${msg}`);
        candidates = [];
      } else if (HARNESS_MODE) {
        // MEASUREMENT RUN: never silently swap Opus→Sonnet — a mixed-model batch
        // corrupts the measurement. Drop this chunk loudly instead so the batch stays
        // pure Opus. If this fires, raise CLAUDE_TIMEOUT_MS and re-run (Opus just
        // needed more time than the ceiling allowed).
        console.warn("");
        console.warn("⚠️ ════════════════════════════════════════════════════════════════");
        console.warn(`⚠️  HARNESS: Opus FAILED on style "${style}" chunk ${i} — ${msg}`);
        console.warn("⚠️  Sonnet fallback DISABLED in measurement mode → chunk DROPPED.");
        console.warn(`⚠️  Batch is INCOMPLETE but pure-Opus. Raise CLAUDE_TIMEOUT_MS (now`);
        console.warn(`⚠️  ${CLAUDE_TIMEOUT_MS}ms) and re-run to recover it.`);
        console.warn("⚠️ ════════════════════════════════════════════════════════════════");
        console.warn("");
        candidates = [];
      } else {
        // Opus failed/timed out (the slow `compound` style was being lost this way).
        // Retry on the FASTER Sonnet 5 — high quality, still Claude, NOT gpt-4o — so
        // we recover the chunk/style instead of dropping it. Drop only if Sonnet fails too.
        try {
          console.warn(`[step-2] style "${style}" chunk ${i} Opus failed (${msg}) — retrying on Sonnet 5`);
          const s1 = await genLimit(() =>
            generate(keys, system, user, 0.9, GEN_MAX_TOKENS, GEN_EFFORT, ANTHROPIC_JUDGE_MODEL, false)
          );
          tokensIn += s1.tokensIn;
          tokensOut += s1.tokensOut;
          calls++;
          candidates = parseCandidates(s1.content);
        } catch (sonErr) {
          const smsg = sonErr?.message ?? String(sonErr);
          if (isBillingError(smsg)) creditExhausted = true;
          console.warn(`[step-2] style "${style}" chunk ${i} DROPPED (Opus + Sonnet both failed): ${smsg}`);
          candidates = [];
        }
      }
    }
    done.push({ candidates, tokensIn, tokensOut, calls });
  });

  const msLeft = Math.max(1000, deadlineAt - Date.now());
  const hitDeadline = await Promise.race([
    Promise.allSettled(chunkPromises).then(() => false),
    new Promise<boolean>((res) => setTimeout(() => res(true), msLeft)),
  ]);
  if (hitDeadline) {
    console.warn(`[step-2] style "${style}" hit generation deadline — proceeding with ${done.length}/${numChunks} chunks`);
  }

  const all: Candidate[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let calls = 0;
  for (const r of done) {
    all.push(...r.candidates);
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    calls += r.calls;
  }
  return { candidates: all, tokensIn, tokensOut, calls };
}

// ─── Quality judge / shortlist ────────────────────────────────────────────────
// A single decisive Claude pass that scores every candidate 0–100 as a brand
// name for THIS product. Scores drive both an early prune (junk removed before
// the expensive USPTO/domain/web checks) and the final ranking in step 6.

async function judgeCandidates(
  keys: LLMKeys,
  candidates: Candidate[],
  record: any,
  brief: BrandBrief
): Promise<{ scores: Map<string, { score: number; reason: string }>; tokensIn: number; tokensOut: number; ok: boolean }> {
  const scores = new Map<string, { score: number; reason: string }>();
  if (candidates.length === 0) return { scores, tokensIn: 0, tokensOut: 0, ok: false };

  const names = candidates.map((c) => c.name);
  const keywords: string[] = record.keywords ?? [];

  const system =
    "You are the naming director at a top branding agency doing a decisive first-round cull of a long candidate list for one client. You are critical: most names on any raw list are mediocre and belong below 50. Only genuinely strong, brandable names earn 75+. You respond only in valid JSON — no markdown, no prose.";

  const user = `Product/service: ${record.product_description}
Keywords: ${keywords.join(", ")}
Brand positioning: ${brief.positioning}
Emotional territories: ${brief.territories}
Literal words to avoid (too descriptive): ${brief.avoid}

Score each candidate name from 0 to 100 as a brand name for THIS product, judging:
- Category resonance & ALTITUDE (MOST IMPORTANT) — apply the STRANGER TEST: shown ONLY this name (no logo, no context), would a stranger guess the RIGHT category for "${record.product_description}"? A great name evokes the product's world — its concrete subject, that subject's behaviour and traits, the customer's bond with it, the activity — through fresh words, AT THE RIGHT ALTITUDE (resonating with the WHOLE target market). THREE ways to fail, all weak: (a) NO category signal at all (could belong to anything); (b) signals a DIFFERENT, adjacent category (a nursery/baby word on a PET product, a workout word on a software app); or (c) pitched at a narrow SUB-SEGMENT that only part of the audience relates to — above all a specific dog BREED (e.g. Corgi/Yorkie/Papillon-derived names only appeal to that breed's owners), or a specific model/insider sub-hobby. Elegance does not rescue any of these.
- Memorability & distinctiveness — would it stand out and stick?
- Pronounceability & spelling — can a stranger say AND spell it correctly after hearing it once?
- Freshness — on-theme WITHOUT the tired literal clichés and WITHOUT literally describing the product.
- Overall: "would I put this in front of the client?"

Penalise harshly (score < 40): random unpronounceable letter-strings; generic corporate words that could belong to any industry (Apex, Valor, Nexus, Clarity); names that literally/generically describe the product or its customer; hard-to-spell or awkward-to-say coinages; interchangeable mush built from soft romance suffixes (-elle, -etta, -ette, -essa, -ella, -olo) that all blur together; well-known EXISTING brand names (e.g. Nestle, Tiffany, Dove); bland over-common dictionary words no one could own (e.g. Precious, Cherish, Adore); names so abstract or generic-premium that they give NO sense of the product's category (they could equally sell luggage, fabric, skincare, or software); names that FAIL the stranger test by signalling the WRONG/adjacent category (e.g. for a pet carrier, baby/nursery words like Swaddle, Lullaby, Cradle read as an infant product, not a pet one); AND names pitched at a narrow SUB-SEGMENT — above all specific dog breeds (Corgi/Yorkie/Papillon/Dachshund-derived) — which only appeal to that sub-group and alienate the rest of the market.
Reward (score 75+): distinctive, easy-to-say, easy-to-spell names that pass the STRANGER TEST — a stranger would sense THIS product's specific category — while still feeling fresh and ownable; original but unmistakably on-theme, never abstract-luxury filler and never a name that fits a neighbouring category better than this one.

Candidates (${names.length}): ${JSON.stringify(names)}

Return ONLY a JSON array, exactly one object per candidate, no markdown:
[{"name": string, "score": number, "reason": string}]
"reason" = max 6 words. Every candidate name above MUST appear exactly once.`;

  try {
    const { content, tokensIn, tokensOut } = await generate(keys, system, user, 0.2, JUDGE_MAX_TOKENS, JUDGE_EFFORT, ANTHROPIC_JUDGE_MODEL);
    const stripped = content.replace(/```[a-z]*\n?/gi, "").trim();
    const match = stripped.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : stripped);
    if (!Array.isArray(parsed)) throw new Error("Judge output not an array");

    for (const item of parsed) {
      if (item && typeof item.name === "string" && typeof item.score === "number") {
        const score = Math.max(0, Math.min(100, Math.round(item.score)));
        scores.set(item.name.trim().toLowerCase(), {
          score,
          reason: typeof item.reason === "string" ? item.reason : "",
        });
      }
    }
    return { scores, tokensIn, tokensOut, ok: scores.size > 0 };
  } catch (err) {
    console.warn("[step-2] judge failed, keeping all candidates unscored:", err.message);
    return { scores, tokensIn: 0, tokensOut: 0, ok: false };
  }
}

// Attach quality scores and prune obvious junk. When the judge failed we keep
// everything (neutral score) so the pipeline still produces results.
function applyJudgeAndPrune(
  candidates: Candidate[],
  scores: Map<string, { score: number; reason: string }>,
  ok: boolean
): Candidate[] {
  const scored = candidates.map((c) => {
    const s = scores.get(c.name.toLowerCase());
    return {
      ...c,
      quality_score: s ? s.score : 50, // neutral default for anything the judge skipped
      quality_reason: s?.reason ?? "",
    };
  });

  if (!ok) return scored;

  scored.sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0));

  // Keep the BULK of candidates for the downstream checks. The confirmed-domain
  // gate (non-negotiable) drops ~half — real evocative words rarely have a free
  // domain — so if we prune hard here, too few survive to reach 50 and the run
  // has to loop. Checking ~130 in ONE batch is cheaper than regenerating for a
  // 2nd batch, and step-6 still ranks by quality and picks only the best 50 that
  // actually have a confirmed domain. quality_score is preserved for that ranking.
  const MIN_KEEP = 130;
  const MAX_KEEP = 150;
  const QUALITY_BAR = 40;

  let kept = scored.filter((c) => (c.quality_score ?? 0) >= QUALITY_BAR);
  if (kept.length < MIN_KEEP) kept = scored.slice(0, Math.min(MIN_KEEP, scored.length));
  if (kept.length > MAX_KEEP) kept = kept.slice(0, MAX_KEEP);
  return kept;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

// Serve only when running as the deployed edge function. The frozen-brief harness
// (scripts/harness.ts) imports this module to reuse generateForStyle; it sets
// BRANDLY_LIB_IMPORT so the server does not start (and hang the CLI). Production
// never sets this env, so the server always starts there — behavior is unchanged.
if (!Deno.env.get("BRANDLY_LIB_IMPORT")) Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  creditExhausted = false; // reset module state (persists across warm invocations)
  try {
    const body = await req.json();
    const payload = body.record ?? body;
    const runId = payload.id;
    console.log("[step-2] started", { runId });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: record, error: fetchErr } = await supabase
      .from("runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (fetchErr || !record) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "run not found" }),
        { headers: corsHeaders }
      );
    }

    if (record.status !== "classified") {
      return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
    }

    const keys: LLMKeys = {
      anthropic: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      openai: Deno.env.get("OPENAI_API_KEY") ?? "",
    };
    if (!keys.anthropic && !keys.openai) {
      await supabase
        .from("runs")
        .update({ status: "error", current_step: "No naming API key configured (ANTHROPIC_API_KEY or OPENAI_API_KEY)" })
        .eq("id", runId);
      return new Response(JSON.stringify({ error: "No LLM key" }), {
        status: 500,
        headers: corsHeaders,
      });
    }
    const provider = providerName(keys);
    console.log("[step-2] naming provider:", provider);

    const candidateTarget: number = record.candidate_target ?? 150;
    const nameStyle: string = record.name_style ?? "auto";
    const styleBuckets: Record<string, number> | null = record.style_buckets ?? null;

    console.log("[step-2] candidate target:", candidateTarget, "style:", nameStyle);

    let allCandidates: Candidate[] = [];
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let totalApiCalls = 0;
    let retried = false;

    // Brief is generated once and reused by both the style calls and the judge.
    let brief: BrandBrief = {
      avoid: "words that literally describe the product or its customer",
      territories: (record.vibe ?? []).join(" | ") || "",
      references: "",
      positioning: record.product_description ?? "",
    };

    // ── AUTO mode: parallel calls per style bucket ──────────────────────────
    if (nameStyle === "auto" && styleBuckets) {
      console.log("[step-2] AUTO mode — running parallel style calls:", styleBuckets);

      // Brief + category bank both derive only from the product, so run them in
      // PARALLEL (no added latency). The category bank (Datamuse-sourced) is the
      // raw category vocabulary the style calls build from — the fix for weak niche
      // signal. We then reconcile the AVOID list so it can never ban a bank word.
      const [briefResult, bankResult] = await Promise.all([
        generateBrandBrief(keys, record.product_description ?? "", record.keywords ?? [], record.vibe ?? []),
        buildCategoryBank(keys, record.product_description ?? "", record.keywords ?? []),
      ]);
      brief = briefResult.brief;
      brief.avoid = reconcileAvoid(brief.avoid, bankResult.words, bankResult.overused);
      const lexicon = bankResult.lexicon;
      totalTokensInput += briefResult.tokensIn + bankResult.tokensIn;
      totalTokensOutput += briefResult.tokensOut + bankResult.tokensOut;
      totalApiCalls += 3;
      console.log("[step-2] brand brief", {
        positioning: brief.positioning,
        territories: brief.territories,
        references: brief.references,
        avoid: brief.avoid,
      });
      console.log("[step-2] category bank", {
        source: bankResult.source,
        seeds: bankResult.seeds,
        overused: bankResult.overused,
        words: bankResult.words,
      });

      const styleEntries = Object.entries(styleBuckets);

      const styleResults = await Promise.all(
        styleEntries.map(async ([style, count]) => {
          const r = await generateForStyle(keys, style, count, record, brief, lexicon, startTime + GEN_HARD_DEADLINE_MS);
          console.log(`[step-2] style "${style}": ${r.candidates.length}/${count} parsed`);
          return { style, ...r };
        })
      );

      for (const r of styleResults) {
        // Tag each candidate with the style that produced it so step-6 can build
        // a style-balanced final list.
        allCandidates.push(...r.candidates.map((c) => ({ ...c, style: r.style })));
        totalTokensInput += r.tokensIn;
        totalTokensOutput += r.tokensOut;
        totalApiCalls += r.calls;
      }

      console.log("[step-2] AUTO combined:", allCandidates.length, "candidates across", styleEntries.length, "styles");

    // ── Single-style mode ────────────────────────────────────────────────────
    } else {
      // Brief + category bank derive only from the product — run in PARALLEL.
      const [briefResult, bankResult] = await Promise.all([
        generateBrandBrief(keys, record.product_description ?? "", record.keywords ?? [], record.vibe ?? []),
        buildCategoryBank(keys, record.product_description ?? "", record.keywords ?? []),
      ]);
      brief = briefResult.brief;
      brief.avoid = reconcileAvoid(brief.avoid, bankResult.words, bankResult.overused);
      const lexicon = bankResult.lexicon;
      totalTokensInput += briefResult.tokensIn + bankResult.tokensIn;
      totalTokensOutput += briefResult.tokensOut + bankResult.tokensOut;
      totalApiCalls += 3;

      console.log("[step-2] brand brief", {
        positioning: brief.positioning,
        territories: brief.territories,
        references: brief.references,
        avoid: brief.avoid,
      });
      console.log("[step-2] category bank", {
        source: bankResult.source,
        seeds: bankResult.seeds,
        overused: bankResult.overused,
        words: bankResult.words,
      });

      const styleKey = nameStyle in STYLE_PROMPTS ? nameStyle : "brandable";

      // Same chunked, high-effort, parallel generation AUTO uses — just one style.
      const r = await generateForStyle(keys, styleKey, candidateTarget, record, brief, lexicon, startTime + GEN_HARD_DEADLINE_MS);
      allCandidates.push(...r.candidates.map((c) => ({ ...c, style: styleKey })));
      totalTokensInput += r.tokensIn;
      totalTokensOutput += r.tokensOut;
      totalApiCalls += r.calls;
      console.log("[step-2] single-style combined:", allCandidates.length, "candidates");

      // Only hard-fail if EVERY chunk came back empty (total generation failure).
      if (allCandidates.length === 0) {
        console.error("[step-2] all single-style chunks failed to produce candidates");
        await supabase
          .from("runs")
          .update({
            status: "error",
            current_step: "Failed to generate candidate names — please try again",
          })
          .eq("id", runId)
          .eq("status", "classified");
        return new Response(
          JSON.stringify({ error: "Failed to parse candidates after retry" }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Deduplicate by name (case-insensitive)
    const seen = new Set<string>();
    const deduped = allCandidates.filter((c) => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ── Hand off to the judge (its OWN function) ─────────────────────────────
    // The judge now runs as a separate pipeline step (pipeline-step-2b-judge) so
    // step-2 spends its entire 150s budget on generation. We persist the raw
    // candidates AND the brief the judge needs (positioning/territories/avoid),
    // then move the run to the "judging" phase, which fires the judge's trigger.
    // NOTE: the runs.status CHECK constraint only permits a fixed set of values,
    // so we reuse the (otherwise-unused) allowed status "running" as the
    // generation-done / judging-in-progress phase rather than adding a new value
    // (which would need a production schema migration). step-2b guards on "running".
    console.log("[step-2] generated", { generated: deduped.length, retried, creditExhausted });
    if (creditExhausted) {
      console.error(
        `[step-2] ⚠️ RUN DEGRADED BY LOW ANTHROPIC CREDITS — only ${deduped.length} names generated; the best styles (compound/evocative) were likely dropped. TOP UP ANTHROPIC CREDITS.`
      );
    }

    await supabase.from("run_candidates").insert({
      run_id: runId,
      stage: "generated_raw",
      data: { candidates: deduped, brief },
    });

    const degradedNote = creditExhausted
      ? " ⚠️ Anthropic credits low — fewer/weaker names this run"
      : "";
    const batchesRun = (record.batches_run ?? 0) + 1;
    const { error: updateErr } = await supabase
      .from("runs")
      .update({
        status: "running",
        current_step: `Generated ${deduped.length} names — shortlisting the best...${degradedNote}`,
        batches_run: batchesRun,
      })
      .eq("id", runId)
      .eq("status", "classified");

    if (updateErr) console.error("Step 2 update failed:", updateErr);

    const estimatedCost = estimateCost(keys, totalTokensInput, totalTokensOutput);
    await supabase.from("api_usage_log").insert({
      run_id: runId,
      user_id: record.user_id,
      service: provider,
      operation: "generate-candidates",
      tokens_input: totalTokensInput,
      tokens_output: totalTokensOutput,
      api_calls: totalApiCalls,
      estimated_cost_usd: estimatedCost,
    });

    console.log("[step-2] completed", {
      runId,
      candidateCount: deduped.length,
      apiCalls: totalApiCalls,
      retried,
      duration: `${Date.now() - startTime}ms`,
    });

    return new Response(JSON.stringify({ count: deduped.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[step-2] error", {
      error: err.message,
      duration: `${Date.now() - startTime}ms`,
    });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
