import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Searchmarq trademark API ────────────────────────────────────────────────
// The old developer.uspto.gov/trademark/search endpoint was decommissioned — it
// returned nothing, so every name looked "clear" (a silent false-positive). We
// now query Searchmarq (a daily-synced USPTO index) instead.
//
// Base URL: the docs are inconsistent (curl examples say searchmarq.com, the
// summary says searchmarq.ai). Probed live: searchmarq.com has an SSL cert
// mismatch (wrong host); searchmarq.ai is the working API host. Overridable via
// env in case that changes.
const SEARCHMARQ_BASE_URL =
  Deno.env.get("SEARCHMARQ_BASE_URL") ?? "https://searchmarq.ai/api/v1";

// One Searchmarq request per name. Default is effectively UNLIMITED — every
// generated name is trademark-checked (so the full pool can reach the final 50).
// To cap it cheaply during testing, set the env TRADEMARK_CHECK_LIMIT (e.g. 20).
// Only checked names continue down the pipeline, so a cap yields a smaller (but
// honest) result set, never a set padded with unverified names.
const TRADEMARK_CHECK_LIMIT = Number(Deno.env.get("TRADEMARK_CHECK_LIMIT") ?? "100000");

// 40 (down from 50): trims Searchmarq's server-side sort so its "statement
// timeout" 500s (which marked ~25% of names unchecked) happen far less often,
// while still giving the AI plenty of relevance-ranked marks to weigh.
const SEARCH_PER_PAGE = 40;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Discriminated outcome so a FAILED search is never confused with a search that
// ran and found no conflicts (that conflation is exactly what made the dead
// USPTO endpoint mark everything "clear").
type MarkOutcome =
  | { kind: "ok"; marks: any[] }
  | { kind: "rate_limited"; message: string }
  | { kind: "error"; status: number; message: string };

// NOTE: the `class` filter param is NOT used — verified against the live API it
// returns ZERO results for any value (class=018,020 AND class=18,20 both → 0),
// which silently made every name look "clear". We instead pull the top marks by
// relevance and let the AI weigh class/goods relatedness (a DuPont factor) from
// each mark's own internationalClass + goodsServices.
async function searchmarqSearch(query: string, apiKey: string): Promise<MarkOutcome> {
  const url = `${SEARCHMARQ_BASE_URL}/search?q=${encodeURIComponent(query)}&per_page=${SEARCH_PER_PAGE}`;
  // Searchmarq intermittently 500s with a "statement timeout" — retry once before
  // giving up so a transient blip doesn't mark a name unchecked.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      if (res.status === 429) {
        let message = "Daily rate limit exceeded";
        try {
          const b = await res.json();
          message = b?.details ?? b?.error ?? message;
        } catch { /* ignore */ }
        console.warn(`[step-3] Searchmarq rate-limited (429) for "${query}": ${message}`);
        return { kind: "rate_limited", message: String(message) };
      }
      if (res.status >= 500 && attempt === 0) {
        await delay(700);
        continue; // transient server error — one retry
      }
      if (!res.ok) {
        let message = res.statusText;
        try {
          const b = await res.json();
          message = b?.error?.message ?? b?.error ?? JSON.stringify(b).slice(0, 200);
        } catch {
          try { message = (await res.text()).slice(0, 200); } catch { /* ignore */ }
        }
        console.error(`[step-3] Searchmarq API error for "${query}":`, { status: res.status, message });
        return { kind: "error", status: res.status, message: String(message) };
      }
      const data = await res.json();
      const marks: any[] = Array.isArray(data?.data) ? data.data : [];
      return { kind: "ok", marks };
    } catch (err) {
      if (attempt === 0) {
        await delay(700);
        continue;
      }
      console.error(`[step-3] Searchmarq exception for "${query}":`, err.message);
      return { kind: "error", status: 0, message: err.message };
    }
  }
  return { kind: "error", status: 0, message: "unreachable" };
}

// Only LIVE marks (Registered or Pending) can block a new registration;
// Abandoned/Cancelled marks are dead and don't bar it, so we drop them.
function isLiveMark(r: any): boolean {
  const s = String(r?.status ?? "").toLowerCase();
  return s === "registered" || s === "pending";
}

// Slim a Searchmarq record down to what the AI needs (mark, owner, class, status,
// goods/services — the last is important for the DuPont relatedness test). Field
// names verified against the LIVE API (the published docs were wrong: it's
// markName/owner/status/internationalClass, not mark_identification/owner_name…).
function slimRecord(r: any): any {
  return {
    markText: r?.markName ?? "",
    ownerName: r?.owner ?? "",
    niceClass: r?.internationalClass ?? "",
    status: r?.status ?? "",
    goodsServices: String(r?.goodsServices ?? "").slice(0, 160),
  };
}

// ─── Process a single name: 1 Searchmarq search + OpenAI confusion scoring ────
async function processName(
  candidate: { name: string; components: string[] },
  niceClasses: number[],
  productDescription: string,
  openaiKey: string,
  apiKey: string
): Promise<{
  result: any;
  tokensIn: number;
  tokensOut: number;
  searchmarqCalls: number;
  openaiCalls: number;
  apiError: boolean;
}> {
  const { name } = candidate;

  // Honest "we couldn't check this" result — NEVER "clear". null stars means the
  // step-6 gate (>= filter_min_stars) excludes it rather than treating it as safe.
  const unchecked = (reason: string) => ({
    result: {
      name,
      uspto_status: "unchecked",
      uspto_stars: null,
      confusion_risk: "unknown",
      uspto_conflicting_marks: [],
      uspto_reasoning: reason,
    },
    tokensIn: 0,
    tokensOut: 0,
    searchmarqCalls: 1,
    openaiCalls: 0,
    apiError: true,
  });

  const outcome = await searchmarqSearch(name, apiKey);
  if (outcome.kind === "rate_limited") {
    return unchecked(`Trademark check skipped — Searchmarq rate limit (${outcome.message}).`);
  }
  if (outcome.kind === "error") {
    return unchecked(`Trademark search unavailable (HTTP ${outcome.status}: ${outcome.message}).`);
  }

  // Search RAN — safe to reason about conflicts (even zero is a real "clear").
  const liveMarks = outcome.marks.filter(isLiveMark);
  const seen = new Set<string>();
  const deduped = liveMarks.filter((r) => {
    const key = r?.serialNumber ?? r?.markName ?? JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const slimmedForAI = deduped.slice(0, 60).map(slimRecord);

  const defaultResult = {
    name,
    uspto_status: "unknown",
    uspto_stars: 3,
    confusion_risk: "medium",
    uspto_conflicting_marks: [],
    uspto_reasoning: "Analysis unavailable.",
  };

  // Heuristic fallback when no OpenAI key — the SEARCH still ran, so a genuine
  // empty result legitimately scores "clear".
  if (!openaiKey) {
    const hasConflicts = deduped.length > 0;
    return {
      result: {
        ...defaultResult,
        uspto_status: hasConflicts ? "similar_exists" : "clear",
        uspto_stars: hasConflicts ? 3 : 5,
        confusion_risk: hasConflicts ? "medium" : "none",
        uspto_reasoning: hasConflicts
          ? `${deduped.length} live marks with a similar name found.`
          : "No live conflicting marks found.",
      },
      tokensIn: 0,
      tokensOut: 0,
      searchmarqCalls: 1,
      openaiCalls: 0,
      apiError: false,
    };
  }

  // ── OpenAI likelihood-of-confusion analysis (DuPont factors) ───────────────
  let tokensIn = 0, tokensOut = 0, openaiCalls = 0;
  try {
    const systemPrompt = `You are a USPTO trademark examining attorney assessing likelihood of confusion between a proposed mark and existing LIVE marks (registered/pending). Do NOT guess a number — follow this rubric exactly.

STEP 1 — For the SINGLE most threatening live mark, rate MARK SIMILARITY:
- IDENTICAL: same mark, or a trivial spelling/sound difference (Coddle vs CODDLE; Lyte vs LIGHT; Kennoble vs KENNOBBLE)
- SIMILAR: shares the dominant element, or a clear phonetic/semantic near-match (Nuzzle vs NUZZLE BED; foreign/synonym equivalents)
- DISTANT: only loosely resembles — shares a common/generic word or root but the overall commercial impression differs
- NONE: no meaningfully similar live mark

STEP 2 — For that SAME mark, rate GOODS/CLASS RELATEDNESS to the proposed product:
- SAME: same or overlapping goods, or a directly competing use
- RELATED: adjacent goods a consumer could think come from one brand (e.g. dog carrier ↔ dog bed ↔ pet accessories)
- UNRELATED: different goods/industry; a consumer would not connect the sources

STEP 3 — Convert to STARS with this matrix (confusion = similarity × relatedness):
                UNRELATED   RELATED   SAME
  IDENTICAL         4          2        1
  SIMILAR           4          3        2
  DISTANT           5          4        3
  NONE              5          5        5

RULES:
- Rate on the WORST-CASE single mark, not the average of the list.
- A mark whose ONLY overlap is a generic/descriptive dictionary word on unrelated goods is DISTANT at most.
- Do NOT inflate: an identical mark on same/related goods is a genuine refusal risk (1–2★), however elegant the proposed name.
- Do NOT over-penalize: an identical mark in a clearly UNRELATED class is only mild (4★). A fanciful coined mark with no similar live mark is 5★.
- 5★ = clear to register · 4★ = minor/unrelated overlap · 3★ = proceed with care · 2★ = significant risk · 1★ = very likely refused.`;

    const userPrompt = `Proposed mark: '${name}'
Product: ${productDescription}
Product's Nice classes: ${JSON.stringify(niceClasses)}
Existing LIVE marks with a similar name — top ${slimmedForAI.length} by relevance, ACROSS ALL classes (deduped from ${deduped.length}). Each shows its own niceClass + goodsServices:
${JSON.stringify(slimmedForAI)}

Work the rubric: pick the most threatening mark, rate its similarity and goods-relatedness, then read the stars off the matrix.

Return ONLY valid JSON (no markdown, no code fences):
{"closest_mark":string|null,"mark_similarity":"identical"|"similar"|"distant"|"none","goods_relatedness":"same"|"related"|"unrelated"|"n/a","confusion_risk":"none"|"low"|"medium"|"high","conflicting_marks":[{"mark":string,"owner":string,"classes":(number|string)[],"reason":string}],"reasoning":"string","stars":1|2|3|4|5}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 800,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await res.json();
    tokensIn = data.usage?.prompt_tokens ?? 0;
    tokensOut = data.usage?.completion_tokens ?? 0;
    openaiCalls = 1;

    const content = data.choices?.[0]?.message?.content ?? "";
    const stripped = content.replace(/```[a-z]*\n?/gi, "").trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : stripped);

    // Status is driven by the rubric STARS (the single source of truth), not the
    // free-text confusion_risk, so it can't drift from the score.
    const stars = Math.max(1, Math.min(5, Math.round(Number(parsed.stars)) || 3));
    let usptoStatus = "clear";
    if (stars <= 2) usptoStatus = "conflict";
    else if (stars === 3) usptoStatus = "similar_exists";

    // Prepend the rubric path (e.g. "[identical × related → 2★]") so the grounds
    // for the score are auditable at a glance.
    const sim = parsed.mark_similarity;
    const rel = parsed.goods_relatedness;
    const tag = sim ? `[${sim}${rel && rel !== "n/a" ? ` × ${rel}` : ""} → ${stars}★] ` : "";

    return {
      result: {
        name,
        uspto_status: usptoStatus,
        uspto_stars: stars,
        confusion_risk: parsed.confusion_risk ?? "medium",
        uspto_conflicting_marks: parsed.conflicting_marks ?? [],
        uspto_reasoning: tag + (parsed.reasoning ?? ""),
      },
      tokensIn,
      tokensOut,
      searchmarqCalls: 1,
      openaiCalls,
      apiError: false,
    };
  } catch (e) {
    // The SEARCH succeeded; only the AI scoring failed — fall back to a
    // count-based read (not "unchecked", because we DID see the marks).
    console.error(`[step-3] OpenAI analysis failed for "${name}":`, e.message);
    return {
      result: {
        ...defaultResult,
        uspto_status: deduped.length > 0 ? "similar_exists" : "clear",
        uspto_stars: deduped.length > 0 ? 3 : 4,
        confusion_risk: deduped.length > 0 ? "medium" : "none",
        uspto_reasoning: `Searchmarq found ${deduped.length} live marks. AI analysis failed.`,
      },
      tokensIn,
      tokensOut,
      searchmarqCalls: 1,
      openaiCalls,
      apiError: false,
    };
  }
}

/* ─── Main handler ───────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  try {
    const body = await req.json();
    const payload = body.record ?? body;
    const runId = payload.id;
    console.log("[step-3] started", { runId });

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

    if (record.status !== "batch_ready") {
      return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const searchmarqKey = Deno.env.get("SEARCHMARQ_API_KEY") ?? "";

    const { data: prevData } = await supabase
      .from("run_candidates")
      .select("data")
      .eq("run_id", runId)
      .eq("stage", "generated")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const rawCandidates: any[] = prevData?.data ?? [];
    const candidates: Array<{ name: string; components: string[]; quality_score?: number }> =
      rawCandidates.map((c: any) =>
        typeof c === "string"
          ? { name: c, components: [] }
          : { name: c.name ?? c, components: c.components ?? [], quality_score: c.quality_score }
      );

    const niceClasses: number[] = record.nice_classes ?? [35, 42];
    const productDescription: string = record.product_description ?? "";

    if (candidates.length === 0) {
      await supabase
        .from("run_candidates")
        .insert({ run_id: runId, stage: "uspto", data: [] });
      await supabase
        .from("runs")
        .update({ status: "uspto_done", current_step: "No candidates to check." })
        .eq("id", runId)
        .eq("status", "batch_ready");
      return new Response(JSON.stringify({ evaluated: 0 }), { headers: corsHeaders });
    }

    // Check only the highest-quality names, up to the limit (20 in testing, all
    // in production). Only the checked names continue down the pipeline.
    const ranked = [...candidates].sort(
      (a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0)
    );
    const toCheck = ranked.slice(0, TRADEMARK_CHECK_LIMIT);
    console.log(
      `[step-3] checking ${toCheck.length}/${candidates.length} names (limit ${TRADEMARK_CHECK_LIMIT})`,
      { niceClasses, searchmarqKey: !!searchmarqKey, openai: !!openaiKey }
    );

    // Hard-stop if the key is missing: mark everything unchecked (honest) rather
    // than silently producing false "clear" results.
    if (!searchmarqKey) {
      console.error("[step-3] SEARCHMARQ_API_KEY not configured — cannot run trademark check");
      const unchecked = toCheck.map((c) => ({
        name: c.name,
        uspto_status: "unchecked",
        uspto_stars: null,
        confusion_risk: "unknown",
        uspto_conflicting_marks: [],
        uspto_reasoning: "Trademark check not run — SEARCHMARQ_API_KEY not configured.",
      }));
      await supabase.from("run_candidates").insert({ run_id: runId, stage: "uspto", data: unchecked });
      await supabase
        .from("runs")
        .update({
          status: "uspto_done",
          current_step: "Trademark check unavailable (API key not configured) — continuing...",
        })
        .eq("id", runId)
        .eq("status", "batch_ready");
      return new Response(JSON.stringify({ evaluated: 0, reason: "no searchmarq key" }), {
        headers: corsHeaders,
      });
    }

    let totalTokensIn = 0,
      totalTokensOut = 0,
      totalSearchmarqCalls = 0,
      totalOpenaiCalls = 0,
      apiErrorCount = 0;
    const allResults: any[] = [];

    const batchSize = 20;
    for (let i = 0; i < toCheck.length; i += batchSize) {
      const batch = toCheck.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((candidate) =>
          processName(candidate, niceClasses, productDescription, openaiKey, searchmarqKey)
        )
      );
      for (const br of batchResults) {
        allResults.push(br.result);
        totalTokensIn += br.tokensIn;
        totalTokensOut += br.tokensOut;
        totalSearchmarqCalls += br.searchmarqCalls;
        totalOpenaiCalls += br.openaiCalls;
        if (br.apiError) apiErrorCount++;
      }
      console.log(`[step-3] batch complete: ${allResults.length}/${toCheck.length}`);
    }

    await supabase
      .from("run_candidates")
      .insert({ run_id: runId, stage: "uspto", data: allResults });

    // Surface a widespread trademark-check failure instead of pretending success.
    const stepMsg =
      apiErrorCount > toCheck.length / 2
        ? `Trademark check unavailable for ${apiErrorCount}/${toCheck.length} names (check Searchmarq API key/credits) — checking domains...`
        : `Trademark check complete — ${allResults.length} names evaluated. Checking domains...`;
    if (apiErrorCount > toCheck.length / 2) {
      console.error(`[step-3] TRADEMARK CHECK LARGELY FAILED: ${apiErrorCount}/${toCheck.length} errored`);
    }

    const { error: updateErr } = await supabase
      .from("runs")
      .update({ status: "uspto_done", current_step: stepMsg })
      .eq("id", runId)
      .eq("status", "batch_ready");

    if (updateErr) console.error("Step 3 update failed:", updateErr);

    if (totalOpenaiCalls > 0) {
      await supabase.from("api_usage_log").insert({
        run_id: runId,
        user_id: record.user_id,
        service: "openai",
        operation: "uspto-confusion-analysis",
        tokens_input: totalTokensIn,
        tokens_output: totalTokensOut,
        api_calls: totalOpenaiCalls,
        estimated_cost_usd: (totalTokensIn * 5 + totalTokensOut * 15) / 1_000_000,
      });
    }
    if (totalSearchmarqCalls > 0) {
      await supabase.from("api_usage_log").insert({
        run_id: runId,
        user_id: record.user_id,
        service: "searchmarq",
        operation: "trademark-search",
        api_calls: totalSearchmarqCalls,
        estimated_cost_usd: 0,
      });
    }

    console.log("[step-3] completed", {
      runId,
      evaluated: allResults.length,
      checkedOf: candidates.length,
      searchmarqCalls: totalSearchmarqCalls,
      openaiCalls: totalOpenaiCalls,
      apiErrors: apiErrorCount,
      duration: `${Date.now() - startTime}ms`,
    });

    return new Response(
      JSON.stringify({ evaluated: allResults.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[step-3] error", {
      error: err.message,
      duration: `${Date.now() - startTime}ms`,
    });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
