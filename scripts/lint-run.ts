// ─────────────────────────────────────────────────────────────────────────────
// lint-run.ts — CLI: score a run's candidate batch with the deterministic linter.
//
//   deno run --allow-env --allow-net scripts/lint-run.ts <run_id> [subsegmentCsv]
//
// Env (same vars the edge functions use):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// It pulls the run's generated_raw candidates + brief straight from Supabase and
// runs lintBatch — no fetch/rerun of the expensive pipeline. Measurement only.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lintBatch } from "./name-linter.ts";
import type { BatchReport, Candidate } from "./name-linter.ts";

const runId = Deno.args[0];
if (!runId) {
  console.error("usage: deno run --allow-env --allow-net scripts/lint-run.ts <run_id> [subsegmentTermsCsv] [productNounsCsv]");
  Deno.exit(1);
}

// Sub-segment terms that split the audience (breeds, for a dog product). Override
// per run via the 2nd CLI arg, e.g. "roast,espresso" for coffee.
const subsegmentTerms = (Deno.args[1] ??
  "poodle,pug,chihuahua,yorkie,corgi,terrier,spaniel,dachshund,maltese,pomeranian")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Literal product/format nouns (dog sling -> sling, carrier, tote...). A bare one
// is a descriptor, not a brand -> hard FAIL. Override per run via the 3rd CLI arg
// (e.g. "coffee,bean,brew,roast" for coffee). Defaults to the dog-sling set.
const productNouns = (Deno.args[2] ?? "sling,carrier,tote,pouch,wrap")
  .split(",").map((s) => s.trim()).filter(Boolean);

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  Deno.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase
  .from("run_candidates")
  .select("data")
  .eq("run_id", runId)
  .eq("stage", "generated_raw")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();

if (error || !data) {
  console.error(`No generated_raw candidates for run ${runId}: ${error?.message ?? "not found"}`);
  Deno.exit(1);
}

const candidates: Candidate[] = data.data?.candidates ?? [];
const brief = data.data?.brief ?? {};
const avoid: string[] = String(brief.avoid ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const report: BatchReport = lintBatch(candidates, { avoid, productNouns, subsegmentTerms });
printReport(runId, report, avoid, subsegmentTerms, productNouns);

function printReport(runId: string, report: BatchReport, avoid: string[], subsegment: string[], productNouns: string[]) {
  const pct = (report.score * 100).toFixed(0);
  console.log("=".repeat(60));
  console.log(`run_id: ${runId}`);
  console.log(`SCORE: ${report.passed}/${report.total} passed  (${pct}%)`);
  console.log(`brand strength (mean phonetic, passing names): ${report.meanBrandStrength.toFixed(1)}/100`);
  console.log(`avoid: [${avoid.join(", ")}]`);
  console.log(`productNouns: [${productNouns.join(", ")}]`);
  console.log(`subsegmentTerms: [${subsegment.join(", ")}]`);

  console.log("\nbyCheck (names each check fired on):");
  for (const [c, n] of Object.entries(report.byCheck).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(16)} ${n}`);
  }

  console.log("\nbyStyle (passed/total):");
  for (const [s, v] of Object.entries(report.byStyle)) {
    console.log(`  ${s.padEnd(18)} ${v.passed}/${v.total}`);
  }

  const cut = report.results.filter((r) => !r.passed);
  console.log(`\nCUT — FAIL-severity (${cut.length}):`);
  for (const r of cut) {
    const reasons = r.issues.filter((i) => i.severity === "fail").map((i) => i.detail).join("; ");
    console.log(`  ✗ ${r.name.padEnd(14)} ${reasons}`);
  }
}
