import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── The quality judge, as its OWN pipeline step ─────────────────────────────
// Split out of step-2 so generation gets the full 150s function budget and no
// longer times out into gpt-4o. step-2 writes the raw candidates + brief to
// run_candidates stage "generated_raw" and moves the run to status "running"
// (an allowed CHECK value reused as the judging phase; "judging" is not permitted
// by the runs.status constraint), which fires this function. Here we score every
// candidate, prune the junk, write
// the kept list to stage "generated" (what step-6 reads), and move the run to
// "batch_ready" so step-3 (USPTO) proceeds. Having its own function means the
// judge can afford real thinking (JUDGE_EFFORT) without competing with generation.
const ANTHROPIC_JUDGE_MODEL = "claude-sonnet-5";
const OPENAI_MODEL = "gpt-4o";
const CLAUDE_TIMEOUT_MS = 90000;
const JUDGE_MAX_TOKENS = 16000;
// Thinking OFF, to match the exact config the calibrated rubric was measured under
// (r=0.54 was measured with effort="" / thinking disabled). Thinking-on is a future
// experiment: run its OWN calibration and enable only if the number actually improves.
const JUDGE_EFFORT = "";

// Keep the BULK of candidates for the downstream checks — the confirmed-domain
// gate drops ~half, so pruning hard here would starve the funnel. step-6 still
// ranks by quality and picks only the best 50 that clear every gate.
const MIN_KEEP = 130;
const MAX_KEEP = 150;
const QUALITY_BAR = 40;

interface LLMKeys {
  anthropic: string;
  openai: string;
}
interface LLMResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
}
interface Candidate {
  name: string;
  components?: string[];
  style?: string;
  quality_score?: number;
  quality_reason?: string;
}
interface BrandBrief {
  avoid: string;
  territories: string;
  references: string;
  positioning: string;
}

async function callClaude(
  anthropicKey: string,
  system: string,
  user: string,
  maxTokens: number,
  effort: string,
  model: string
): Promise<LLMResult> {
  const bodyObj: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (effort) {
    bodyObj.thinking = { type: "adaptive" };
    bodyObj.output_config = { effort };
  } else {
    bodyObj.thinking = { type: "disabled" };
  }
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
      body: JSON.stringify(bodyObj),
      signal: controller.signal,
    });
    data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message ?? JSON.stringify(data).slice(0, 400);
      console.error(`[step-2b] Anthropic API error ${res.status}: ${msg}`);
      throw new Error(`Anthropic ${res.status}: ${msg}`);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.error(`[step-2b] Anthropic call timed out after ${CLAUDE_TIMEOUT_MS}ms (model=${model})`);
      throw new Error(`Anthropic timeout after ${CLAUDE_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const content = Array.isArray(data.content)
    ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b?.text ?? "").join("")
    : "";
  if (!content) {
    console.error(`[step-2b] Anthropic returned empty content (stop_reason=${data?.stop_reason})`);
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
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

async function generate(
  keys: LLMKeys,
  system: string,
  user: string,
  temperature: number,
  maxTokens: number,
  effort: string,
  model: string
): Promise<LLMResult> {
  if (keys.anthropic) {
    try {
      return await callClaude(keys.anthropic, system, user, maxTokens, effort, model);
    } catch (err) {
      if (keys.openai) {
        console.warn("[step-2b] Claude failed, falling back to OpenAI:", err.message);
        return await callOpenAI(keys.openai, system, user, temperature, maxTokens);
      }
      throw err;
    }
  }
  return await callOpenAI(keys.openai, system, user, temperature, maxTokens);
}

// ─── Judge ───────────────────────────────────────────────────────────────────
async function judgeCandidates(
  keys: LLMKeys,
  candidates: Candidate[],
  record: any,
  brief: BrandBrief
): Promise<{ scores: Map<string, { score: number; reason: string }>; tokensIn: number; tokensOut: number; ok: boolean }> {
  const scores = new Map<string, { score: number; reason: string }>();
  if (candidates.length === 0) return { scores, tokensIn: 0, tokensOut: 0, ok: false };

  const names = candidates.map((c) => c.name);

  // Calibrated market-standard rubric (r=0.54 vs human ratings), kept verbatim in
  // sync with scripts/judge.ts JUDGE_SYSTEM. Scores 1-5; mapped to 0-100 below so
  // the existing prune/rank plumbing is untouched.
  const system = `You are a brand-naming director scoring candidate names for a client. You score by how names SUCCEED IN THE MARKET. You are discerning: on a raw generated list, most names are a 1 or 2, but a real list DOES contain presentable names — reward them. A 3 is "makes the longlist." A 4 is "I would present this." A 5 is "I would lead the pitch with this." Use the full range: a list with zero 4s or 5s means you are being too harsh — good names exist and must be recognised.

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

  const user = `BRIEF:
Product: ${record.product_description}
Positioning: ${brief.positioning}
SATURATED words for this category (names built on these -> cap 2, unclearable): ${brief.avoid}

For each name: classify its linkage (fresh / bridge / none / saturated / literal), then score 1-5 by the market standard. Most names are 1-3; reserve 4-5 for genuinely presentable names.

Names (${names.length}): ${JSON.stringify(names)}

Return ONLY a JSON array, one object per name, in the same order:
[{"name": string, "linkage": "fresh"|"bridge"|"none"|"saturated"|"literal", "score": number, "reason": string}]
"reason" = max 6 words naming the deciding factor.`;

  try {
    const { content, tokensIn, tokensOut } = await generate(keys, system, user, 0.2, JUDGE_MAX_TOKENS, JUDGE_EFFORT, ANTHROPIC_JUDGE_MODEL);
    const stripped = content.replace(/```[a-z]*\n?/gi, "").trim();
    const match = stripped.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : stripped);
    if (!Array.isArray(parsed)) throw new Error("Judge output not an array");

    for (const item of parsed) {
      if (item && typeof item.name === "string" && typeof item.score === "number") {
        // Calibrated rubric returns a 1-5 score; map to the 0-100 quality_score the
        // downstream plumbing (QUALITY_BAR, prune, step-6 ranking) expects:
        // 1→0, 2→25, 3→50, 4→75, 5→100. Clamp defensively.
        const s5 = Math.max(1, Math.min(5, item.score));
        const score = Math.round((s5 - 1) * 25);
        scores.set(item.name.trim().toLowerCase(), {
          score,
          reason: typeof item.reason === "string" ? item.reason : "",
        });
      }
    }
    return { scores, tokensIn, tokensOut, ok: scores.size > 0 };
  } catch (err) {
    console.warn("[step-2b] judge failed, keeping all candidates unscored:", err.message);
    return { scores, tokensIn: 0, tokensOut: 0, ok: false };
  }
}

function applyJudgeAndPrune(
  candidates: Candidate[],
  scores: Map<string, { score: number; reason: string }>,
  ok: boolean
): Candidate[] {
  const scored = candidates.map((c) => {
    const s = scores.get(c.name.toLowerCase());
    return {
      ...c,
      quality_score: s ? s.score : 50,
      quality_reason: s?.reason ?? "",
    };
  });

  if (!ok) return scored;

  scored.sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0));

  let kept = scored.filter((c) => (c.quality_score ?? 0) >= QUALITY_BAR);
  if (kept.length < MIN_KEEP) kept = scored.slice(0, Math.min(MIN_KEEP, scored.length));
  if (kept.length > MAX_KEEP) kept = kept.slice(0, MAX_KEEP);
  return kept;
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
    console.log("[step-2b] started", { runId });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: record, error: fetchErr } = await supabase
      .from("runs").select("*").eq("id", runId).single();
    if (fetchErr || !record) {
      return new Response(JSON.stringify({ skipped: true, reason: "run not found" }), { headers: corsHeaders });
    }
    // step-2 hands off using the allowed status "running" (the runs.status CHECK
    // constraint has no "judging" value; "running" was otherwise unused).
    if (record.status !== "running") {
      return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
    }

    const keys: LLMKeys = {
      anthropic: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      openai: Deno.env.get("OPENAI_API_KEY") ?? "",
    };

    // Read the raw candidates + brief that step-2 persisted.
    const { data: prevData } = await supabase
      .from("run_candidates").select("data")
      .eq("run_id", runId).eq("stage", "generated_raw")
      .order("created_at", { ascending: false }).limit(1).single();

    const raw: any = prevData?.data ?? {};
    const candidates: Candidate[] = Array.isArray(raw) ? raw : (raw.candidates ?? []);
    const brief: BrandBrief = (raw && raw.brief) ? raw.brief : {
      avoid: "", territories: "", references: "", positioning: record.product_description ?? "",
    };

    console.log("[step-2b] judging", { candidates: candidates.length });

    const judgeResult = await judgeCandidates(keys, candidates, record, brief);
    const finalCandidates = applyJudgeAndPrune(candidates, judgeResult.scores, judgeResult.ok);

    const qualityDist = { high: 0, mid: 0, low: 0 };
    for (const c of finalCandidates) {
      const q = c.quality_score ?? 50;
      if (q >= 70) qualityDist.high++;
      else if (q >= 45) qualityDist.mid++;
      else qualityDist.low++;
    }
    console.log("[step-2b] judged", {
      evaluated: candidates.length,
      kept: finalCandidates.length,
      judgeOk: judgeResult.ok,
      qualityDist,
    });

    await supabase.from("run_candidates").insert({
      run_id: runId,
      stage: "generated",
      data: finalCandidates,
    });

    const { error: updateErr } = await supabase
      .from("runs")
      .update({
        status: "batch_ready",
        current_step: `Shortlisted ${finalCandidates.length} of ${candidates.length} names — checking trademarks...`,
      })
      .eq("id", runId)
      .eq("status", "running");

    if (updateErr) console.error("[step-2b] update failed:", updateErr);

    if (judgeResult.tokensIn > 0 || judgeResult.tokensOut > 0) {
      await supabase.from("api_usage_log").insert({
        run_id: runId,
        user_id: record.user_id,
        service: keys.anthropic ? "anthropic" : "openai",
        operation: "judge-candidates",
        tokens_input: judgeResult.tokensIn,
        tokens_output: judgeResult.tokensOut,
        api_calls: judgeResult.ok ? 1 : 0,
        estimated_cost_usd: (judgeResult.tokensIn * 3 + judgeResult.tokensOut * 15) / 1_000_000,
      });
    }

    console.log("[step-2b] completed", {
      runId,
      kept: finalCandidates.length,
      duration: `${Date.now() - startTime}ms`,
    });

    return new Response(JSON.stringify({ kept: finalCandidates.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[step-2b] error", { error: err.message, duration: `${Date.now() - startTime}ms` });
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
