import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// On/off switch for the web-presence (Serper) check. TEMPORARILY OFF to avoid
// burning Serper credits during testing. The web check is informational only —
// step-6 does NOT score or gate on it — so disabling it does not change the final
// results, it just skips the paid searches. Re-enable without a redeploy by
// setting the env WEB_CHECK_ENABLED=true, or flip this default back before prod.
const WEB_CHECK_ENABLED =
  (Deno.env.get("WEB_CHECK_ENABLED") ?? "false").toLowerCase() === "true";

// Discriminated outcome so the caller can tell three DIFFERENT situations apart —
// which the old code conflated (it returned [] for both "search failed" and
// "genuinely nothing found", so a failed search silently marked every name
// "clear"/available):
//   ok           → the search ran; results may be empty (a real "no presence")
//   rate_limited → HTTP 429; retryable, mark "unchecked"
//   error        → HTTP 4xx/5xx or network fail; we never checked → mark "unchecked"
type SerperOutcome =
  | { kind: "ok"; results: any[] }
  | { kind: "rate_limited" }
  | { kind: "error"; status: number; message: string };

async function serperSearch(
  query: string,
  serperKey: string,
  name: string
): Promise<SerperOutcome> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    if (res.status === 429) {
      console.warn("[step-5] Serper rate-limited (429) for", name);
      return { kind: "rate_limited" };
    }
    if (!res.ok) {
      // Capture Serper's error BODY, not just the status. A valid key returning
      // HTTP 400 "Not enough credits" is Serper's out-of-credits signal — without
      // logging the message it looked like a request bug and stayed invisible.
      let message = res.statusText;
      try {
        const body = await res.json();
        message = body?.message ?? JSON.stringify(body).slice(0, 200);
      } catch {
        try { message = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      }
      console.error("[step-5] Serper API error:", { name, status: res.status, message });
      return { kind: "error", status: res.status, message };
    }
    const data = await res.json();
    const results = data.organic ?? [];
    console.log("[step-5] Serper response for", name, ":", results.length, "results");
    return { kind: "ok", results };
  } catch (err) {
    console.error("[step-5] Serper exception for", name, ":", err.message);
    return { kind: "error", status: 0, message: err.message };
  }
}

async function processName(
  candidate: any,
  productDescription: string,
  serperKey: string,
  openaiKey: string
): Promise<{
  result: any;
  tokensIn: number;
  tokensOut: number;
  serperCalls: number;
  openaiCalls: number;
  hit429: boolean;
}> {
  const name: string = candidate.name;

  // Default fields — used when skipping or on failure
  const defaultWeb = {
    presence_summary: "Unchecked",
    brand_clarity: "unchecked" as const,
    clarity_notes: "",
  };

  if (!serperKey) {
    return {
      result: { ...candidate, ...defaultWeb, presence_summary: "Serper API key not configured." },
      tokensIn: 0, tokensOut: 0, serperCalls: 0, openaiCalls: 0, hit429: false,
    };
  }

  const outcome = await serperSearch(
    `"${name}" brand OR company OR business OR trademark`,
    serperKey,
    name
  );

  if (outcome.kind === "rate_limited") {
    return {
      result: {
        ...candidate,
        presence_summary: "Web check skipped (rate limit).",
        brand_clarity: "unchecked",
        clarity_notes: "Serper rate limit hit during bulk check.",
      },
      tokensIn: 0, tokensOut: 0, serperCalls: 1, openaiCalls: 0, hit429: true,
    };
  }

  if (outcome.kind === "error") {
    // The search FAILED (e.g. Serper out of credits → HTTP 400). We never actually
    // checked this name, so it MUST NOT be marked "clear"/available. Report it
    // honestly as unchecked; the reason is carried in clarity_notes for the UI/logs.
    return {
      result: {
        ...candidate,
        presence_summary: "Web presence not checked (search unavailable).",
        brand_clarity: "unchecked",
        clarity_notes: `Web search failed (HTTP ${outcome.status}: ${outcome.message}).`,
      },
      tokensIn: 0, tokensOut: 0, serperCalls: 1, openaiCalls: 0, hit429: false,
    };
  }

  const searchResults = outcome.results;

  if (searchResults.length === 0) {
    // The search RAN and genuinely found nothing — safe to call this clear.
    return {
      result: {
        ...candidate,
        presence_summary: "No significant brand presence found.",
        brand_clarity: "clear",
        clarity_notes: "",
      },
      tokensIn: 0, tokensOut: 0, serperCalls: 1, openaiCalls: 0, hit429: false,
    };
  }

  const top5 = searchResults
    .slice(0, 5)
    .map((r: any) => ({ title: r.title ?? "", snippet: r.snippet ?? "", url: r.link ?? "" }));

  if (!openaiKey) {
    const nameLower = name.toLowerCase();
    const exactMatch = top5.some(
      (r: any) =>
        r.title.toLowerCase().includes(nameLower) ||
        r.url.toLowerCase().includes(nameLower.replace(/\s+/g, ""))
    );
    let clarity: string, summary: string;
    if (exactMatch && top5.length >= 3) {
      clarity = "taken";
      summary = `Multiple businesses appear to use "${name}" as a brand name.`;
    } else if (exactMatch) {
      clarity = "crowded";
      summary = `Some existing use of "${name}" found online.`;
    } else if (top5.length > 0) {
      clarity = "partial";
      summary = "Minimal relevant web presence for this name.";
    } else {
      clarity = "clear";
      summary = "No significant brand presence found.";
    }
    return {
      result: {
        ...candidate,
        presence_summary: summary,
        brand_clarity: clarity,
        clarity_notes: "",
      },
      tokensIn: 0, tokensOut: 0, serperCalls: 1, openaiCalls: 0, hit429: false,
    };
  }

  const fallback = {
    result: {
      ...candidate,
      presence_summary:
        top5.length > 0
          ? `${top5.length} web results found. AI analysis failed.`
          : "No significant brand presence found.",
      brand_clarity: top5.length > 2 ? "crowded" : "partial",
      clarity_notes: "AI analysis unavailable.",
    },
    tokensIn: 0, tokensOut: 0, serperCalls: 1, openaiCalls: 0, hit429: false,
  };

  async function callOpenAIForWeb(): Promise<{
    content: string | null;
    tokensIn: number;
    tokensOut: number;
    httpStatus: number;
  }> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 200,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You are a brand strategist assessing whether a proposed brand name is available as a distinct market identity.

Assess brand_clarity as one of:
- "clear": No meaningful existing use of this name as a brand or product. The name is available to own.
- "partial": Some use exists but in unrelated industries, different geographies, or as a minor player. Usable with care.
- "crowded": The name is in use by multiple entities or in closely related categories. Hard to stand out.
- "taken": The name is clearly and prominently associated with an existing brand in this or a closely adjacent category.

For presence_summary: write exactly ONE sentence in your own words describing what currently uses this name (if anything). Do NOT copy text from search results. If nothing relevant exists, write "No significant brand presence found."`,
          },
          {
            role: "user",
            content: `Proposed brand name: '${name}'
Product category: ${productDescription}
Web search results: ${JSON.stringify(top5)}

Return ONLY valid JSON:
{"presence_summary":"string (max 120 chars, your own words)","brand_clarity":"clear"|"partial"|"crowded"|"taken","clarity_notes":"string"}

You MUST respond with valid JSON only. No markdown, no code fences. Start with { and end with }.`,
          },
        ],
      }),
    });
    const httpStatus = res.status;
    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content ?? null,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      httpStatus,
    };
  }

  try {
    let openaiResult = await callOpenAIForWeb();
    console.log("[step-5] OpenAI response for", name, ":", {
      httpStatus: openaiResult.httpStatus,
      hasContent: !!openaiResult.content,
    });

    if (openaiResult.httpStatus === 429) {
      console.warn(`[step-5] Rate limited (429) for "${name}" — using fallback`);
      return { ...fallback, hit429: true };
    }

    if (!openaiResult.content || openaiResult.content.trim() === "") {
      console.log("[step-5] Retrying OpenAI for", name, "after 500ms...");
      await new Promise((resolve) => setTimeout(resolve, 500));
      openaiResult = await callOpenAIForWeb();
    }

    if (!openaiResult.content || openaiResult.content.trim() === "") {
      console.error(`[step-5] Empty OpenAI response for "${name}" (HTTP ${openaiResult.httpStatus})`);
      return {
        ...fallback,
        tokensIn: openaiResult.tokensIn,
        tokensOut: openaiResult.tokensOut,
        openaiCalls: 1,
        hit429: false,
      };
    }

    const stripped = openaiResult.content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : stripped);
    } catch (parseErr) {
      console.error(
        `[step-5] JSON parse failed for "${name}", content: ${openaiResult.content.substring(0, 200)}`
      );
      return {
        ...fallback,
        tokensIn: openaiResult.tokensIn,
        tokensOut: openaiResult.tokensOut,
        openaiCalls: 1,
        hit429: false,
      };
    }

    console.log("[step-5] Successfully parsed", name);
    return {
      result: {
        ...candidate,
        presence_summary: parsed.presence_summary ?? "Analysis complete.",
        brand_clarity: parsed.brand_clarity ?? "partial",
        clarity_notes: parsed.clarity_notes ?? "",
      },
      tokensIn: openaiResult.tokensIn,
      tokensOut: openaiResult.tokensOut,
      serperCalls: 1,
      openaiCalls: 1,
      hit429: false,
    };
  } catch (e) {
    console.error(`[step-5] OpenAI web analysis failed for "${name}":`, e.message);
    return fallback;
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
    console.log("[step-5] started", { runId });

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

    if (record.status !== "domains_done") {
      return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
    }

    const serperKey = Deno.env.get("SERPER_API_KEY") ?? "";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    console.log("[step-5] API keys configured:", { serper: !!serperKey, openai: !!openaiKey });

    const { data: prevData } = await supabase
      .from("run_candidates")
      .select("data")
      .eq("run_id", runId)
      .eq("stage", "domains")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const allCandidates: any[] = prevData?.data ?? [];
    const productDescription: string = record.product_description ?? "";
    const candidates = allCandidates;

    console.log("[step-5] candidates to process:", candidates.length);

    if (candidates.length === 0) {
      await supabase
        .from("run_candidates")
        .insert({ run_id: runId, stage: "web", data: [] });
      await supabase
        .from("runs")
        .update({
          status: "web_done",
          current_step: "No candidates passed trademark filter for web check.",
        })
        .eq("id", runId)
        .eq("status", "domains_done");
      return new Response(JSON.stringify({ checked: 0 }), { headers: corsHeaders });
    }

    // Web check disabled → skip ALL Serper/OpenAI calls (no credit burn), mark
    // every name "unchecked" (never a false "clear"), and advance the pipeline.
    if (!WEB_CHECK_ENABLED) {
      console.log(`[step-5] web check DISABLED — skipping ${candidates.length} Serper searches (saving credits)`);
      const skipped = candidates.map((c: any) => ({
        ...c,
        presence_summary: "Web presence check disabled (saving credits).",
        brand_clarity: "unchecked",
        clarity_notes: "",
      }));
      await supabase
        .from("run_candidates")
        .insert({ run_id: runId, stage: "web", data: skipped });
      await supabase
        .from("runs")
        .update({
          status: "web_done",
          current_step: "Web presence check skipped — scoring results...",
        })
        .eq("id", runId)
        .eq("status", "domains_done");
      return new Response(
        JSON.stringify({ checked: 0, skipped: skipped.length, webCheckDisabled: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const BATCH_SIZE = 8;
    const BATCH_PAUSE_MS = 200;

    let totalTokensIn = 0,
      totalTokensOut = 0,
      totalSerperCalls = 0,
      totalOpenaiCalls = 0;
    let successCount = 0,
      failCount = 0,
      total429s = 0;
    const allResults: any[] = [];

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map((c: any) => {
          const jitter = Math.floor(Math.random() * 100);
          return new Promise<any>((resolve) =>
            setTimeout(
              () => resolve(processName(c, productDescription, serperKey, openaiKey)),
              jitter
            )
          );
        })
      );

      for (const br of batchResults) {
        allResults.push(br.result);
        totalTokensIn += br.tokensIn;
        totalTokensOut += br.tokensOut;
        totalSerperCalls += br.serperCalls;
        totalOpenaiCalls += br.openaiCalls;
        if (br.result.brand_clarity !== "unchecked") successCount++;
        else failCount++;
        if (br.hit429) total429s++;
      }

      if (i + BATCH_SIZE < candidates.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
      }

      console.log(
        `[step-5] batch complete: ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length} (429s so far: ${total429s})`
      );
    }

    console.log("[step-5] processing summary", {
      total: candidates.length,
      success: successCount,
      failed: failCount,
      total429s,
      serperCalls: totalSerperCalls,
      openaiCalls: totalOpenaiCalls,
    });

    await supabase
      .from("run_candidates")
      .insert({ run_id: runId, stage: "web", data: allResults });

    // If most names came back "unchecked" the web search itself failed (typically
    // Serper out of credits). Surface that in current_step instead of pretending
    // the scan succeeded — otherwise the run looks healthy while every name is
    // actually unverified.
    const uncheckedCount = allResults.filter((r) => r.brand_clarity === "unchecked").length;
    const webStepMsg =
      uncheckedCount > candidates.length / 2
        ? `Web scan unavailable for ${uncheckedCount}/${candidates.length} names (check Serper API credits) — scoring results...`
        : `Web scan complete (${allResults.length}/${candidates.length}) — scoring results...`;
    if (uncheckedCount > candidates.length / 2) {
      console.error(`[step-5] WEB SEARCH LARGELY FAILED: ${uncheckedCount}/${candidates.length} unchecked — likely Serper credits exhausted`);
    }

    const { error: updateErr } = await supabase
      .from("runs")
      .update({
        status: "web_done",
        current_step: webStepMsg,
      })
      .eq("id", runId)
      .eq("status", "domains_done");

    if (updateErr) console.error("Step 5 update failed:", updateErr);

    if (totalSerperCalls > 0) {
      await supabase.from("api_usage_log").insert({
        run_id: runId,
        user_id: record.user_id,
        service: "serper",
        operation: "web-presence-search",
        api_calls: totalSerperCalls,
        estimated_cost_usd: totalSerperCalls * 0.003,
      });
    }
    if (totalOpenaiCalls > 0) {
      await supabase.from("api_usage_log").insert({
        run_id: runId,
        user_id: record.user_id,
        service: "openai",
        operation: "web-presence-analysis",
        tokens_input: totalTokensIn,
        tokens_output: totalTokensOut,
        api_calls: totalOpenaiCalls,
        estimated_cost_usd: (totalTokensIn * 0.15 + totalTokensOut * 0.60) / 1_000_000,
      });
    }

    console.log("[step-5] completed", {
      runId,
      checked: allResults.length,
      duration: `${Date.now() - startTime}ms`,
    });

    return new Response(
      JSON.stringify({ checked: allResults.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[step-5] error", {
      error: err.message,
      duration: `${Date.now() - startTime}ms`,
    });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});