import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Composite scoring ─────────────────────────────────────────────────────────
// Name quality is now judged by an LLM in step 2 (quality_score, 0–100). That
// score is re-joined here by name from the "generated" stage — it is the single
// biggest factor, because a name that is safe and available but forgettable is
// still a bad name. The old substring-based product-fit heuristic was removed:
// it rewarded exactly the descriptive words step 2 is told to avoid, and did
// nothing at all for business types outside a few hardcoded word banks.

// Ranking score. Domain availability and web presence are now PASS/FAIL GATES
// (applied below), NOT ranking inputs — that's the Phase-2 fix: previously the
// 20% domain + 15% web weighting meant only coined words (the only ones with a
// free .com) could top the list, burying every other style. Ranking is now
// brand quality (dominant) + trademark clearance, so a strong evocative or
// real-word name that PASSES the gates competes on merit.
function computeCompositeScore(candidate: any, qualityScore: number): number {
  const usptoStars: number = candidate.uspto_stars ?? 3;
  const usptoScore = (usptoStars / 5) * 100;

  // Weights: name quality 80%, trademark clearance 20%.
  const raw = Math.round((qualityScore * 0.80 + usptoScore * 0.20) * 100) / 100;
  return raw;
}

// Deterministic near-duplicate filter. The LLM keeps producing clusters that share
// a root despite explicit instructions not to (e.g. one run yielded pup×6, nest×8,
// pouch×3, sky×6). We break them up mechanically here: signature each name by its
// 3- and 4-char prefix AND suffix, walk the best-first list, and keep a name only
// if none of its signatures has already hit `cap`. This guarantees a visibly
// diverse final page no matter how clustered the raw generation was.
function rootKeys(name: string): string[] {
  const n = String(name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const keys: string[] = [];
  if (n.length >= 3) { keys.push("p3:" + n.slice(0, 3)); keys.push("s3:" + n.slice(-3)); }
  if (n.length >= 4) { keys.push("p4:" + n.slice(0, 4)); keys.push("s4:" + n.slice(-4)); }
  return keys;
}

function diversifyByRoots(items: any[], cap: number): { kept: any[]; dropped: any[] } {
  const counts: Record<string, number> = {};
  const kept: any[] = [];
  const dropped: any[] = [];
  for (const it of items) {
    const keys = rootKeys(it.name);
    if (keys.some((k) => (counts[k] ?? 0) >= cap)) { dropped.push(it); continue; }
    for (const k of keys) counts[k] = (counts[k] ?? 0) + 1;
    kept.push(it);
  }
  return { kept, dropped };
}

// Per-style quota: round-robin the best remaining name from each style until we
// hit the target, so the final list SHOWS the mix instead of 50 look-alikes.
// `pool` must already be gated and sorted best-first.
function pickStyleBalanced(pool: any[], target: number): any[] {
  const byStyle = new Map<string, any[]>();
  for (const c of pool) {
    const s = (typeof c.style === "string" && c.style) ? c.style : "other";
    if (!byStyle.has(s)) byStyle.set(s, []);
    byStyle.get(s)!.push(c);
  }
  const styles = [...byStyle.keys()];
  const picked: any[] = [];
  let anyLeft = true;
  while (picked.length < target && anyLeft) {
    anyLeft = false;
    for (const s of styles) {
      const arr = byStyle.get(s)!;
      if (arr.length > 0) {
        picked.push(arr.shift());
        anyLeft = true;
        if (picked.length >= target) break;
      }
    }
  }
  return picked;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  try {
    const body = await req.json();
    const payload = body.record ?? body;
    const runId = payload.id;
    console.log("[step-6] started", { runId });

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

    if (record.status !== "web_done") {
      return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
    }

    const { data: prevData } = await supabase
      .from("run_candidates")
      .select("data")
      .eq("run_id", runId)
      .eq("stage", "web")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const candidates: any[] = prevData?.data ?? [];
    const filterMinStars: number = record.filter_min_stars ?? 3;

    // Re-join the LLM quality score from the "generated" stage by name.
    // (Steps 3–5 don't carry it through, so we look it up here.)
    const { data: genData } = await supabase
      .from("run_candidates")
      .select("data")
      .eq("run_id", runId)
      .eq("stage", "generated")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Re-join both quality_score AND style from the generated stage by name
    // (steps 3–5 don't carry them through). Style drives the per-style quota.
    const qualityMap = new Map<string, number>();
    const styleMap = new Map<string, string>();
    for (const c of (genData?.data ?? [])) {
      if (c?.name) {
        const key = String(c.name).toLowerCase();
        qualityMap.set(key, c.quality_score ?? 50);
        if (typeof c.style === "string" && c.style) styleMap.set(key, c.style);
      }
    }

    const scored = candidates.map((c: any) => {
      const key = String(c.name ?? "").toLowerCase();
      const quality = qualityMap.get(key) ?? 50;
      return {
        ...c,
        quality_score: quality,
        style: c.style ?? styleMap.get(key) ?? "other",
        composite_score: computeCompositeScore(c, quality),
      };
    });

    // ── GATES (pass/fail) ──────────────────────────────────────────────────
    // A name qualifies only if it clears the trademark bar AND has at least one
    // available domain — where "available" is broad: exact .com, an allowed
    // alternative TLD, or a recommended get-/try- prefix / -hq suffix (whatever
    // the user permits, on by default). best_domain is non-null iff step-4 found
    // one of those, so this gate honours the full domain strategy, not just .com.
    // NON-NEGOTIABLE: every result must have a CONFIRMED available domain —
    // best_domain is non-null iff step-4 confirmed one of: exact .com, an allowed
    // alternative TLD the user chose, or a get-/try- prefix / -hq suffix variant.
    // Fastly "unknown"/timeout results do NOT set best_domain, so they never pass
    // here (step-4 retries unknowns to minimise those false negatives).
    const eligible = scored.filter(
      (c: any) => (c.uspto_stars ?? 0) >= filterMinStars && !!c.best_domain
    );

    // ── RANK on quality, break up near-duplicate clusters, then fill 50 ──────
    eligible.sort((a: any, b: any) => b.composite_score - a.composite_score);
    // Cap at 2 names per shared root so the page can't be dominated by clusters
    // (pup×6, nest×8, …). Backfill from the dropped clones only if the cap left us
    // short of a full page, so we never return fewer than we otherwise could.
    const { kept: diverse, dropped } = diversifyByRoots(eligible, 2);
    const pool = diverse.length >= 50 ? diverse : diverse.concat(dropped);
    const top50 = pickStyleBalanced(pool, 50);
    console.log("[step-6] root-diversity", { eligible: eligible.length, afterCap: diverse.length, droppedClones: dropped.length });

    // Log quality + style distributions for diagnostics
    const qualityDist = { high: 0, mid: 0, low: 0 };
    scored.forEach((c: any) => {
      if (c.quality_score >= 70) qualityDist.high++;
      else if (c.quality_score >= 45) qualityDist.mid++;
      else qualityDist.low++;
    });
    const styleDist: Record<string, number> = {};
    for (const c of top50) styleDist[c.style] = (styleDist[c.style] ?? 0) + 1;
    console.log("[step-6] quality distribution", qualityDist);
    console.log("[step-6] gate", { evaluated: scored.length, eligible: eligible.length, selected: top50.length });
    console.log("[step-6] final style distribution", styleDist);

    await supabase
      .from("run_candidates")
      .insert({ run_id: runId, stage: "scored", data: top50 });

    const { error: updateErr } = await supabase
      .from("runs")
      .update({
        status: "scored",
        current_step: `Scoring complete — saving ${top50.length} results...`,
      })
      .eq("id", runId)
      .eq("status", "web_done");

    if (updateErr) console.error("Step 6 update failed:", updateErr);

    console.log("[step-6] completed", {
      runId,
      scored: top50.length,
      totalEvaluated: candidates.length,
      duration: `${Date.now() - startTime}ms`,
    });

    return new Response(
      JSON.stringify({ scored: top50.length, total_evaluated: candidates.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[step-6] error", {
      error: err.message,
      duration: `${Date.now() - startTime}ms`,
    });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
