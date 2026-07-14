// ─────────────────────────────────────────────────────────────────────────────
// judge.ts  —  Tier-2 quality judge (measures the CEILING, not the floor)
//
// WHAT THIS IS
//   The linter scores whether a name is BROKEN. This judge scores whether a name
//   is GOOD by the MARKET standard — the thread between name and product, the
//   ownability, and the phonetic craft that make names succeed commercially.
//   It is deliberately NOT tuned to the founder's personal taste, because the
//   product serves customers whose taste differs.
//
// HOW WE VALIDATE
//   We run it over the founder's 164 rated names and produce a DIVERGENCE report:
//   where the market standard and personal taste agree, and where they part. A
//   moderate correlation is EXPECTED and fine — the divergences are the useful
//   product intelligence, not errors to tune away.
//
// DESIGN
//   • Decomposition: the judge classifies each name's linkage type (fresh /
//     bridge / none / saturated / literal) BEFORE scoring — structured reasoning
//     aligns better than gut-scoring (per aesthetics-alignment research).
//   • The tier-1/saturated rule is GENERAL — it penalises whatever the SATURATED
//     list contains — so swapping fixture lists for USPTO data needs no rubric change.
//
// RUN
//   deno run --allow-read --allow-env --allow-net judge.ts ratings.json  → divergence report
// ─────────────────────────────────────────────────────────────────────────────

import { BRIEFS } from "./brief-set.ts";

// ── The judge's rubric — the MARKET standard, not one person's taste ──────────
// Calibrated to how brand names actually succeed in the market: a thread between
// name and product (fresh or bridged, never saturated/literal), ownability, and
// phonetic craft. NOT tuned to the founder's personal taste — the product serves
// customers whose taste differs. The founder's 164 ratings are used only to
// MEASURE the gap between market standard and personal taste, not to force a match.
//
// Uses DECOMPOSITION (per the aesthetics-alignment research): the judge first
// CLASSIFIES each name's linkage type and ownability, THEN scores — structured
// reasoning aligns better than gut-scoring. The tier-1 rule is kept GENERAL
// ("penalise names built on the SATURATED list, whatever it contains") so it
// transfers unchanged when the saturated list later comes from USPTO data.
export const JUDGE_SYSTEM = `You are a brand-naming director scoring candidate names for a client. You score by how names SUCCEED IN THE MARKET. You are discerning: on a raw generated list, most names are a 1 or 2, but a real list DOES contain presentable names — reward them. A 3 is "makes the longlist." A 4 is "I would present this." A 5 is "I would lead the pitch with this." Use the full range: a list with zero 4s or 5s means you are being too harsh — good names exist and must be recognised.

━━━ CALIBRATE TO THESE EXAMPLES (they define the bar; both COINED and real-word names can score high) ━━━
5 (lead the pitch) — real AND coined, all agency-grade:
  Stripe, Notion, Rover, Slack (real-word, fresh/bridge thread) · Spotify, Zappos, Verizon (coined, ownable, brandable) · Pourvana, Aromatlas, Emvara, Terova (coined coffee names with a warmth/aroma/journey thread) · Sidekick (dog: the companion idea) · Northkeep, Gridwell, Pulsar, Warden, Prism (dev: apt to watch/signal/infra AND ownable). A coined name is NOT penalised for being invented — invention done well is excellent.
4 (present it):
  Snugharbor, Meadowmate, Companeer (dog) · Lingermist, Kettlewick, Meridian, Hearthwell (coffee) · Signite, Clarion, Fluxbeam (dev). Strong, distinctive, apt — a hair below a 5.
3 (longlist): ownable but plain or slightly on-the-nose. Fine, not memorable.
2 (weak — common on raw lists):
  • generic-clean real words that could be any brand: Cairn, Beam, Vega, Flint, Kestrel, Ballast, Cadence, Beacon (nice words, none ownable/specific).
  • soft-suffix / vaguely-coined blur: Fluxel, Beacove, Threadle, Steddock.
1 (never present — the LARGEST bucket on a raw list):
  • CLUNKY MASHUPS where two roots clonk audibly: Cradlore, Cradlecrest, Scampfire, Velvetden, Cossetry, Kettlore, Stillhour, Pourtrait, Steepsake, Kettlewright.
  • literal descriptors (Coffee, Sling) and SATURATED-word names.

Two calibration guards, equally important:
  • Do NOT reward a name just for being a clean real word — Cairn/Flint/Beam are 2s (not ownable/specific).
  • Do NOT punish a name just for being coined — Pourvana/Emvara/Spotify are 4-5s when the coinage is graceful and carries a thread. The failure is CLUNKINESS (audible weld), not invention.

━━━ HOW TO SCORE (decompose, then grade against the examples) ━━━
For each name, classify its LINKAGE: fresh / bridge / none / saturated / literal. Then grade against the anchors, weighing OWNABILITY (distinctive & trademark-able) and CRAFT (sayable in one beat; graceless welds/typos -> 1).
HARD RULES (general): SATURATED-list word -> cap 2. Literal product noun -> 1. Clunky audible mashup -> 1.

Aim for a realistic spread on a raw list: mostly 1-2, a fair number of 3s, a real handful of 4s, and the occasional 5. Neither "everything is a 4" nor "nothing clears 2" is correct.

Respond ONLY with valid JSON, no markdown.`;

export function buildJudgeUser(names: string[], briefId: string): string {
  const b = BRIEFS.find((x) => x.id === briefId);
  const saturated = b ? b.brief.avoid : "";
  const briefBlock = b
    ? `BRIEF:
Product: ${b.product_description}
Positioning: ${b.brief.positioning}
SATURATED words for this category (names built on these -> cap 2, unclearable): ${saturated}`
    : "(no brief context)";
  return `${briefBlock}

For each name: classify its linkage (fresh / bridge / none / saturated / literal), then score 1-5 by the market standard. Most names are 1-3; reserve 4-5 for genuinely presentable names.

Names (${names.length}): ${JSON.stringify(names)}

Return ONLY a JSON array, one object per name, in the same order:
[{"name": string, "linkage": "fresh"|"bridge"|"none"|"saturated"|"literal", "score": number, "reason": string}]
"reason" = max 6 words naming the deciding factor.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION HARNESS — compares the judge's scores to your ratings.
// Claude Code fills in `callJudge` with the real Claude call (same path the
// pipeline uses). Everything else — grouping, scoring the judge, the agreement
// report — is done.
// ─────────────────────────────────────────────────────────────────────────────

export type JudgeScore = { name: string; score: number; reason: string; linkage?: string };

// Claude Code implements this: send JUDGE_SYSTEM + buildJudgeUser(names, briefId)
// to Claude, parse the JSON array, return it. Batch per brief.
export type CallJudge = (names: string[], briefId: string) => Promise<JudgeScore[]>;

interface HumanRating { name: string; brief_id: string; score: number; }

export async function calibrate(ratingsPath: string, callJudge: CallJudge) {
  const raw = await readText(ratingsPath);
  const human: HumanRating[] = JSON.parse(raw);

  // group names by brief
  const byBrief = new Map<string, HumanRating[]>();
  for (const r of human) {
    if (!byBrief.has(r.brief_id)) byBrief.set(r.brief_id, []);
    byBrief.get(r.brief_id)!.push(r);
  }

  // score every name with the judge
  const judgeScore = new Map<string, number>(); // key: brief::name
  for (const [briefId, rows] of byBrief) {
    const names = rows.map((r) => r.name);
    // chunk to keep each call reasonable
    for (let i = 0; i < names.length; i += 30) {
      const chunk = names.slice(i, i + 30);
      const scored = await callJudge(chunk, briefId);
      for (const s of scored) judgeScore.set(`${briefId}::${s.name.toLowerCase()}`, s.score);
    }
  }

  // compare
  const pairs: { name: string; brief: string; human: number; judge: number }[] = [];
  for (const r of human) {
    const j = judgeScore.get(`${r.brief_id}::${r.name.toLowerCase()}`);
    if (j != null) pairs.push({ name: r.name, brief: r.brief_id, human: r.score, judge: j });
  }

  report(pairs);
  return pairs;
}

// ── agreement report ─────────────────────────────────────────────────────────
function report(pairs: { name: string; brief: string; human: number; judge: number }[]) {
  const n = pairs.length;
  if (!n) { console.log("No overlapping names to compare."); return; }

  const exact = pairs.filter((p) => p.human === p.judge).length;
  const within1 = pairs.filter((p) => Math.abs(p.human - p.judge) <= 1).length;
  const mae = pairs.reduce((a, p) => a + Math.abs(p.human - p.judge), 0) / n;

  // Pearson correlation
  const hm = pairs.reduce((a, p) => a + p.human, 0) / n;
  const jm = pairs.reduce((a, p) => a + p.judge, 0) / n;
  let cov = 0, hv = 0, jv = 0;
  for (const p of pairs) { cov += (p.human - hm) * (p.judge - jm); hv += (p.human - hm) ** 2; jv += (p.judge - jm) ** 2; }
  const r = hv && jv ? cov / Math.sqrt(hv * jv) : 0;

  // the two buckets that matter most for a harsh judge:
  // does it agree on the GREAT names (human 4-5) and the BAD names (human 1)?
  const great = pairs.filter((p) => p.human >= 4);
  const greatOk = great.filter((p) => p.judge >= 4).length;
  const bad = pairs.filter((p) => p.human === 1);
  const badOk = bad.filter((p) => p.judge <= 2).length;

  const line = "─".repeat(64);
  console.log(`\n${line}\nMARKET JUDGE  vs  YOUR TASTE  ·  ${n} names\n${line}`);
  console.log(`(This is a DIVERGENCE report, not a pass/fail. The judge scores by the`);
  console.log(` MARKET standard; the gap below is where your personal taste differs.)\n`);
  console.log(`exact match:      ${exact}/${n}  (${(100*exact/n).toFixed(0)}%)`);
  console.log(`within 1 point:   ${within1}/${n}  (${(100*within1/n).toFixed(0)}%)`);
  console.log(`mean abs gap:     ${mae.toFixed(2)} points`);
  console.log(`correlation (r):  ${r.toFixed(2)}   ${r >= 0.6 ? "high overlap (your taste ≈ market)" : r >= 0.4 ? "moderate overlap" : "low overlap (your taste diverges from market)"}`);
  console.log(`\nOverlap where it matters:`);
  console.log(`  your 4–5s the market also rates 4–5:  ${greatOk}/${great.length}   (names you love that also sell)`);
  console.log(`  your 1s the market also rates 1–2:    ${badOk}/${bad.length}   (names you hate the market also rejects)`);

  // biggest divergences — the interesting product intelligence
  const diffs = [...pairs].sort((a, b) => Math.abs(b.human - b.judge) - Math.abs(a.human - a.judge)).slice(0, 14);
  console.log(`\nBiggest divergences (where market ≠ your taste):`);
  for (const p of diffs) {
    const dir = p.judge > p.human ? "market likes, you don't" : "you like, market doesn't";
    console.log(`  ${p.name.padEnd(20)} you:${p.human}  market:${p.judge}   ${dir}`);
  }
}

async function readText(path: string): Promise<string> {
  // @ts-ignore Deno
  if (typeof Deno !== "undefined") return await Deno.readTextFile(path);
  const fs = await import("node:fs/promises");
  return await fs.readFile(path, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI RUNNER — wires the real Claude call (same path the pipeline judge uses:
// Sonnet 5, thinking OFF, temp 0.2) and runs the calibration against ratings.json.
// The judge now returns an optional `linkage` field per name — parsed if present,
// ignored if absent (it's optional on JudgeScore; the report doesn't need it).
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const anthropic = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!anthropic) {
    console.error("ANTHROPIC_API_KEY is required — the judge makes live Claude calls.");
    console.error(
      "\nUsage:\n  ANTHROPIC_API_KEY=... deno run --no-check --allow-read --allow-env --allow-net scripts/judge.ts [ratings.json]",
    );
    Deno.exit(1);
  }
  const ratingsPath = Deno.args.find((a) => !a.startsWith("--")) ?? "ratings.json";

  // Import the pipeline module as a LIBRARY (BRANDLY_LIB_IMPORT suppresses its
  // Deno.serve). Set BEFORE the dynamic import so the guard sees it.
  Deno.env.set("BRANDLY_LIB_IMPORT", "1");
  const { generate, ANTHROPIC_JUDGE_MODEL } = await import(
    "../supabase/functions/pipeline-step-2-generate/index.ts"
  );
  const keys = { anthropic, openai: Deno.env.get("OPENAI_API_KEY") ?? "" };

  // Same call path as the pipeline judge: Sonnet 5, effort "" (thinking OFF),
  // temperature 0.2, JUDGE_MAX_TOKENS (16000).
  const callJudge: CallJudge = async (names, briefId) => {
    const user = buildJudgeUser(names, briefId);
    const { content } = await generate(keys, JUDGE_SYSTEM, user, 0.2, 16000, "", ANTHROPIC_JUDGE_MODEL);
    const cleaned = String(content).replace(/```[a-z]*\n?/gi, "").trim();
    const m = cleaned.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(m ? m[0] : cleaned);
    if (!Array.isArray(parsed)) throw new Error("judge did not return a JSON array");
    return parsed.map((x: { name: string; score: number; reason?: string; linkage?: string }) => ({
      name: String(x.name),
      score: Number(x.score),
      reason: String(x.reason ?? ""),
      // optional: present in the market-standard judge, absent in older ones
      ...(x.linkage != null ? { linkage: String(x.linkage) } : {}),
    }));
  };

  await calibrate(ratingsPath, callJudge);
}
