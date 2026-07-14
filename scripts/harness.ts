// ─────────────────────────────────────────────────────────────────────────────
// harness.ts  —  Frozen-brief generation harness
//
// WHAT IT DOES
//   For each frozen brief, it calls YOUR generator `samples` times, lints every
//   batch, and reports per-brief mean score ± standard deviation plus the mean
//   count of each failure type. Averaging over samples washes out the run-to-run
//   coin-flip in what the model coins, so the score reflects the PROMPT, not luck.
//
//   compareRuns() then diffs two harness runs (before vs after a change) and, for
//   each brief, flags whether the shift is bigger than the noise — so you can
//   tell a real improvement from a lucky batch, and catch a change that helps one
//   category while quietly breaking another.
//
// THE ONE THING CLAUDE CODE MUST WIRE
//   A GenerateFn: given a frozen brief, return one batch of Candidates — by
//   running the SAME buildStylePrompt + Claude calls the pipeline uses, but with
//   the frozen brief instead of a generated one. Everything else here is done.
//
//     const realGenerate: GenerateFn = async (brief) => {
//       // for each style in brief.style_buckets: buildStylePrompt(style, count,
//       // brief-as-record, brief.brief, brief.lexicon) → callClaude → parse
//       // return the combined, de-duped Candidate[]
//     };
//     const run = await runHarness(BRIEFS, realGenerate, { samples: 3 });
//     printHarnessRun(run);
//
// BASELINE NOTE
//   A harness score and a lint-run.ts score are DIFFERENT baselines (frozen brief
//   vs live pipeline brief). Compare within a series, never across.
// ─────────────────────────────────────────────────────────────────────────────

import { lintBatch, type Candidate } from "./name-linter.ts";
import { BRIEFS, avoidList, type FrozenBrief } from "./brief-set.ts";
import type { BrandBrief, LLMKeys } from "../supabase/functions/pipeline-step-2-generate/index.ts";

// Claude Code implements this. sampleIndex lets a real generator vary its seed.
export type GenerateFn = (brief: FrozenBrief, sampleIndex: number) => Promise<Candidate[]>;

export interface BriefResult {
  id: string;
  scores: number[]; // one linter score (0..100) per sample
  mean: number;
  sd: number;
  brandStrengths: number[]; // one mean-brand-strength (0..100) per sample
  brandStrength: number; // mean of the above across samples
  byCheckMean: Record<string, number>; // mean count per check across samples
}

export interface HarnessRun {
  samples: number;
  perBrief: BriefResult[];
  aggregate: { mean: number; sd: number; brandStrength: number; byCheckMean: Record<string, number> };
}

// ── stats helpers ────────────────────────────────────────────────────────────

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function meanByCheck(reports: Record<string, number>[]): Record<string, number> {
  const keys = new Set<string>();
  reports.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = mean(reports.map((r) => r[k] ?? 0));
  return out;
}

// ── run ──────────────────────────────────────────────────────────────────────

export async function runHarness(
  briefs: FrozenBrief[],
  generate: GenerateFn,
  opts: { samples?: number } = {}
): Promise<HarnessRun> {
  const samples = opts.samples ?? 3;
  const perBrief: BriefResult[] = [];

  for (const brief of briefs) {
    const scores: number[] = [];
    const brandStrengths: number[] = [];
    const checkReports: Record<string, number>[] = [];

    for (let s = 0; s < samples; s++) {
      const cands = await generate(brief, s);
      const report = lintBatch(cands, {
        avoid: avoidList(brief),
        productNouns: brief.productNouns,
        subsegmentTerms: brief.subsegmentTerms,
      });
      // Score as a 0..100 percentage so it reads like a grade.
      scores.push(report.total ? (report.passed / report.total) * 100 : 0);
      brandStrengths.push(report.meanBrandStrength);
      checkReports.push(report.byCheck);
    }

    perBrief.push({
      id: brief.id,
      scores,
      mean: mean(scores),
      sd: stdev(scores),
      brandStrengths,
      brandStrength: mean(brandStrengths),
      byCheckMean: meanByCheck(checkReports),
    });
  }

  const allScores = perBrief.flatMap((b) => b.scores);
  return {
    samples,
    perBrief,
    aggregate: {
      mean: mean(perBrief.map((b) => b.mean)),
      sd: stdev(allScores),
      brandStrength: mean(perBrief.map((b) => b.brandStrength)),
      byCheckMean: meanByCheck(perBrief.map((b) => b.byCheckMean)),
    },
  };
}

// ── print a single run ─────────────────────────────────────────────────────

export function printHarnessRun(run: HarnessRun): void {
  const line = "─".repeat(60);
  console.log(`\nFROZEN-BRIEF HARNESS  ·  ${run.perBrief.length} briefs × ${run.samples} samples`);
  console.log(line);
  console.log(`${"brief".padEnd(22)}${"mean".padStart(7)}${"±sd".padStart(8)}${"brand".padStart(9)}`);
  console.log(line);
  for (const b of run.perBrief) {
    console.log(`${b.id.padEnd(22)}${b.mean.toFixed(1).padStart(7)}${("±" + b.sd.toFixed(1)).padStart(8)}${b.brandStrength.toFixed(1).padStart(9)}`);
  }
  console.log(line);
  console.log(`${"AGGREGATE".padEnd(22)}${run.aggregate.mean.toFixed(1).padStart(7)}${("±" + run.aggregate.sd.toFixed(1)).padStart(8)}${run.aggregate.brandStrength.toFixed(1).padStart(9)}`);
  console.log(`\nBrand strength (mean phonetic of passing names, 0-100): ${run.aggregate.brandStrength.toFixed(1)}`);
  console.log(`\nMean failures per batch (aggregate):`);
  for (const [k, v] of Object.entries(run.aggregate.byCheckMean).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)}${v.toFixed(1)}`);
  }
}

// ── compare two runs (before → after a change) ─────────────────────────────

// Rough signal heuristic: is the per-brief shift bigger than the batch-to-batch
// noise? Not a significance test — a guardrail against celebrating a lucky batch.
function signal(deltaAbs: number, pooledSd: number): string {
  const floor = Math.max(pooledSd, 1.0); // never call sub-1-point moves "real"
  if (deltaAbs >= floor) return "▲ real";
  if (deltaAbs >= 0.5 * floor) return "~ weak";
  return "· noise";
}

export function compareRuns(before: HarnessRun, after: HarnessRun): void {
  const line = "─".repeat(72);
  const beforeById = new Map(before.perBrief.map((b) => [b.id, b]));
  console.log(`\nCOMPARE  ·  before → after   (${before.samples}→${after.samples} samples)`);
  console.log(line);
  console.log(`${"brief".padEnd(20)}${"before".padStart(9)}${"after".padStart(9)}${"Δ".padStart(9)}   signal`);
  console.log(line);

  for (const a of after.perBrief) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    const delta = a.mean - b.mean;
    const pooled = Math.sqrt((b.sd ** 2 + a.sd ** 2) / 2);
    const dir = delta >= 0 ? "+" : "";
    const sig = delta < 0 && Math.abs(delta) >= Math.max(pooled, 1.0) ? "▼ REGRESSED" : signal(Math.abs(delta), pooled);
    console.log(
      `${a.id.padEnd(20)}${b.mean.toFixed(1).padStart(9)}${a.mean.toFixed(1).padStart(9)}${(dir + delta.toFixed(1)).padStart(9)}   ${sig}`
    );
  }

  const dAgg = after.aggregate.mean - before.aggregate.mean;
  const pooledAgg = Math.sqrt((before.aggregate.sd ** 2 + after.aggregate.sd ** 2) / 2);
  console.log(line);
  console.log(
    `${"AGGREGATE".padEnd(20)}${before.aggregate.mean.toFixed(1).padStart(9)}${after.aggregate.mean.toFixed(1).padStart(9)}${((dAgg >= 0 ? "+" : "") + dAgg.toFixed(1)).padStart(9)}   ${signal(Math.abs(dAgg), pooledAgg)}`
  );

  // The money view: which failure types the change moved.
  console.log(`\nFailure-type deltas (aggregate, mean per batch):`);
  const keys = new Set([
    ...Object.keys(before.aggregate.byCheckMean),
    ...Object.keys(after.aggregate.byCheckMean),
  ]);
  const rows = [...keys]
    .map((k) => ({ k, b: before.aggregate.byCheckMean[k] ?? 0, a: after.aggregate.byCheckMean[k] ?? 0 }))
    .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b));
  for (const { k, b, a } of rows) {
    const d = a - b;
    const arrow = d < -0.05 ? "▼" : d > 0.05 ? "▲" : " ";
    console.log(`  ${k.padEnd(16)}${b.toFixed(1).padStart(6)} → ${a.toFixed(1).padStart(5)}   ${arrow} ${(d >= 0 ? "+" : "") + d.toFixed(1)}`);
  }
}

// ── Real generator ───────────────────────────────────────────────────────────
// GenerateFn wired to the pipeline's OWN generation code. For each style in the
// frozen brief's style_buckets it calls generateForStyle — which internally runs
// buildStylePrompt(style, count, record, brief.brief, brief.lexicon) + the real
// Claude path (chunked, Sonnet-fallback) — then returns the combined, de-duped
// Candidate[]. Nothing is reimplemented; the frozen brief is fed in place of the
// per-run generated brief + lexicon.

const keys: LLMKeys = {
  anthropic: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  openai: Deno.env.get("OPENAI_API_KEY") ?? "",
};

// ── CLI ────────────────────────────────────────────────────────────────────
// Flags (both `--k v` and `--k=v` forms work):
//   --briefs  comma-separated brief ids to run           (default: all)
//   --samples batches per brief                           (default: 3)
//   --target  approx candidates/brief for THIS run only   (default: 50)
//   --dump    write generated candidates to a JSON file   (needs --allow-write)
//             format: { "<brief_id>": ["name1", "name2", ...], ... }
// --target is harness-only: it scales the frozen brief's style_buckets down for
// a cheap smoke test. It never touches the production pipeline's own target.

const USAGE =
  "deno run --no-check --allow-env --allow-net --allow-read [--allow-write] scripts/harness.ts " +
  "[--briefs id1,id2] [--samples N] [--target N] [--dump path.json]";

interface HarnessArgs {
  briefs?: string[];
  samples: number;
  target: number;
  dump?: string;
}

function parseArgs(args: string[]): HarnessArgs {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      opts[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[a.slice(2)] = next;
        i++;
      } else {
        opts[a.slice(2)] = "true";
      }
    }
  }
  const briefs = opts.briefs
    ? opts.briefs.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const samples = opts.samples ? Math.max(1, Number.parseInt(opts.samples, 10)) : 3;
  const target = opts.target ? Math.max(1, Number.parseInt(opts.target, 10)) : 50;
  // opts.dump === "true" means --dump was passed with no path; ignore it.
  const dump = opts.dump && opts.dump !== "true" ? opts.dump : undefined;
  return { briefs, samples, target, dump };
}

// Scale a brief's style_buckets so the total lands near `target`, keeping every
// non-empty style represented (min 1). If target ≥ the brief's full total, the
// buckets are returned unchanged.
function scaleBuckets(buckets: Record<string, number>, target: number): Record<string, number> {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (total === 0 || target >= total) return { ...buckets };
  const factor = target / total;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(buckets)) {
    out[k] = v > 0 ? Math.max(1, Math.round(v * factor)) : 0;
  }
  return out;
}

const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

if (import.meta.main) {
  if (!keys.anthropic) {
    console.error("ANTHROPIC_API_KEY is required — the harness makes live Claude calls.");
    console.error(`\nUsage:\n  ${USAGE}`);
    Deno.exit(1);
  }

  const cfg = parseArgs(Deno.args);

  // Resolve which briefs to run.
  let selected = BRIEFS;
  if (cfg.briefs) {
    const unknown = cfg.briefs.filter((id) => !BRIEFS.some((b) => b.id === id));
    if (unknown.length) {
      console.error(`Unknown brief id(s): ${unknown.join(", ")}`);
      console.error(`Available: ${BRIEFS.map((b) => b.id).join(", ")}`);
      Deno.exit(1);
    }
    const wanted = new Set(cfg.briefs);
    selected = BRIEFS.filter((b) => wanted.has(b.id));
  }

  // Apply the harness-only target cap by scaling each brief's buckets.
  const briefsToRun: FrozenBrief[] = selected.map((b) => ({
    ...b,
    style_buckets: scaleBuckets(b.style_buckets, cfg.target),
  }));

  // Show exactly what this run will spend before it spends it.
  const fullTotal = sum(selected[0]?.style_buckets ?? {});
  const scaledTotal = sum(briefsToRun[0]?.style_buckets ?? {});
  const estGen = briefsToRun.reduce((n, b) => n + sum(b.style_buckets), 0) * cfg.samples;
  console.log("\nHARNESS CONFIG");
  console.log(`  briefs:  ${briefsToRun.map((b) => b.id).join(", ")}  (${briefsToRun.length})`);
  console.log(`  samples: ${cfg.samples}`);
  console.log(
    `  target:  ~${cfg.target}/brief` +
      (cfg.target >= fullTotal
        ? `  (≥ full ${fullTotal}; buckets unchanged)`
        : `  (buckets scaled ${fullTotal} → ~${scaledTotal})`),
  );
  console.log(`  est. generations: ~${estGen}  (${briefsToRun.length} briefs × ${cfg.samples} samples × ~${scaledTotal} names)`);

  // Import the pipeline module as a LIBRARY. BRANDLY_LIB_IMPORT stops its
  // Deno.serve from starting a server (which would hang this CLI). Set BEFORE the
  // dynamic import so the guard sees it.
  Deno.env.set("BRANDLY_LIB_IMPORT", "1");
  const { generateForStyle } = await import(
    "../supabase/functions/pipeline-step-2-generate/index.ts"
  );

  // For --dump: accumulate unique candidate names per brief_id across all samples.
  // A Set preserves first-seen order and de-dupes within a brief.
  const dumped = new Map<string, Set<string>>();

  const realGenerate: GenerateFn = async (brief) => {
    const deadline = Date.now() + 10 * 60 * 1000; // generous; harness isn't wall-clock bound
    const perStyle = await Promise.all(
      Object.entries(brief.style_buckets).map(async ([style, count]) => {
        const r = await generateForStyle(
          keys,
          style,
          count,
          brief, // the FrozenBrief doubles as the `record` buildStylePrompt reads
          brief.brief as BrandBrief,
          brief.lexicon,
          deadline,
        );
        return r.candidates.map((c: { name: string; components?: string[] }) => ({
          name: c.name,
          components: c.components ?? [],
          style,
        }));
      }),
    );
    const all = perStyle.flat();
    const seen = new Set<string>();
    const result = all.filter((c) => {
      const k = c.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (cfg.dump) {
      const set = dumped.get(brief.id) ?? new Set<string>();
      for (const c of result) set.add(c.name);
      dumped.set(brief.id, set);
    }
    return result;
  };

  const run = await runHarness(briefsToRun, realGenerate, { samples: cfg.samples });
  printHarnessRun(run);

  if (cfg.dump) {
    const out: Record<string, string[]> = {};
    for (const [id, set] of dumped) out[id] = [...set];
    await Deno.writeTextFile(cfg.dump, JSON.stringify(out, null, 2));
    const totalNames = Object.values(out).reduce((n, a) => n + a.length, 0);
    console.log(`\nDumped ${totalNames} candidates across ${Object.keys(out).length} briefs → ${cfg.dump}`);
  }
}
