import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How many candidates to generate based on how strict the user's USPTO filter is.
// Stricter filters pass fewer names, so we need a larger initial pool.
function targetCandidates(filterMinStars: number): number {
  if (filterMinStars >= 5) return 250;
  if (filterMinStars === 4) return 200;
  if (filterMinStars === 3) return 150;
  return 100; // 1–2 stars (very permissive)
}

// For AUTO style, distribute the candidate target across styles. Weighted HARD
// toward the styles that actually SIGNAL THE CATEGORY, because "too random /
// unrelated to the product" is the recurring user complaint. Only some styles can
// carry category meaning:
//   • real_words  — an on-theme real word (Scamper, Gambol, Rover) → STRONG signal
//   • compound    — a category root + a surprising root (Wagglebond) → STRONG
//   • alternate_spelling — a respelled category word (Yipster, Wriggl) → decent
//   • evocative   — evokes a benefit/feeling, NOT the subject (Jaunt, Promenade)
//                   → WEAK category signal, so its share is cut
//   • non_english / brandable — abstract-quality or fully-coined words
//                   (Kokoro, Querenza, Kobbi) → CANNOT signal a category at all,
//                   so they are trimmed to a token share (variety only)
// Result: real_words + compound now dominate (64%), and the category-blind styles
// drop from 16% to 6%.
// Weights: real_words 34%, compound 30%, evocative 16%,
//          alternate_spelling 14%, non_english 3%, brandable 3% — sum = 100%.
const STYLE_WEIGHTS: Record<string, number> = {
  real_words: 0.34,
  compound: 0.30,
  evocative: 0.16,
  alternate_spelling: 0.14,
  non_english: 0.03,
  brandable: 0.03,
};

function buildStyleBuckets(
  nameStyle: string,
  candidateTarget: number
): Record<string, number> | null {
  if (nameStyle !== "auto") return null;

  const buckets: Record<string, number> = {};
  let assigned = 0;
  const styles = Object.keys(STYLE_WEIGHTS);

  // Assign floor of weighted count to each style
  styles.forEach((s) => {
    buckets[s] = Math.floor(candidateTarget * STYLE_WEIGHTS[s]);
    assigned += buckets[s];
  });

  // Distribute any remainder (due to flooring) to the highest-weight styles first
  let remainder = candidateTarget - assigned;
  for (const s of styles) {
    if (remainder <= 0) break;
    buckets[s]++;
    remainder--;
  }

  return buckets;
}

function fallbackClassify(description: string): number[] {
  const d = description.toLowerCase();
  if (/software|app|platform|saas|tool/.test(d)) return [42];
  if (/retail|store|shop|ecommerce/.test(d)) return [35];
  if (/food|drink|beverage|restaurant/.test(d)) return [43];
  if (/clothing|fashion|apparel|wear/.test(d)) return [25];
  if (/finance|banking|payment|insurance/.test(d)) return [36];
  return [35, 42];
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
    console.log("[step-1] started", { runId });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Fetch fresh run data
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

    if (record.status !== "pending") {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: corsHeaders,
      });
    }

    const productDescription = record.product_description ?? "";
    const keywords: string[] = record.keywords ?? [];
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

    // Calculate how many candidates step 2 should generate
    const filterMinStars: number = record.filter_min_stars ?? 3;
    const candidateTarget = targetCandidates(filterMinStars);
    console.log("[step-1] candidate target:", candidateTarget, "(filter_min_stars:", filterMinStars, ")");

    // Build style buckets for AUTO mode so step 2 can guarantee a diverse mix
    const nameStyle: string = record.name_style ?? "auto";
    const styleBuckets = buildStyleBuckets(nameStyle, candidateTarget);
    if (styleBuckets) {
      console.log("[step-1] AUTO mode — style buckets:", styleBuckets);
    }

    let niceClasses: number[];
    let tokensInput = 0;
    let tokensOutput = 0;

    if (openaiKey) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            max_tokens: 200,
            temperature: 0,
            messages: [
              {
                role: "system",
                content:
                  "You are a USPTO trademark classification expert. Given a product or service description, return the most relevant USPTO Nice Classification class numbers as a JSON array of integers. Return only the JSON array — no explanation, no markdown, no code fences.",
              },
              {
                role: "user",
                content: `Product/service: ${productDescription}. Keywords: ${keywords.join(", ")}`,
              },
            ],
          }),
        });
        const data = await res.json();
        const rawContent: string = data.choices?.[0]?.message?.content ?? "";
        tokensInput = data.usage?.prompt_tokens ?? 0;
        tokensOutput = data.usage?.completion_tokens ?? 0;

        const cleaned = rawContent.replace(/```[a-z]*\n?/gi, "").trim();
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) throw new Error("Not an array");
        niceClasses = parsed.filter((x: any) => typeof x === "number");
        if (niceClasses.length === 0) throw new Error("Empty array");
      } catch (err) {
        console.warn("[step-1] OpenAI parse failed, using fallback:", err.message);
        niceClasses = fallbackClassify(productDescription);
      }
    } else {
      niceClasses = fallbackClassify(productDescription);
    }

    // Store candidate_target AND style_buckets so step 2 has everything it needs
    const { error: updateErr } = await supabase
      .from("runs")
      .update({
        nice_classes: niceClasses,
        candidate_target: candidateTarget,
        style_buckets: styleBuckets, // null for non-AUTO styles
        status: "classified",
        current_step: "Identified trademark classes — generating names...",
      })
      .eq("id", runId)
      .eq("status", "pending");

    if (updateErr) console.error("Step 1 update failed:", updateErr);

    // Log usage
    const estimatedCost = (tokensInput * 5 + tokensOutput * 15) / 1_000_000;
    await supabase.from("api_usage_log").insert({
      run_id: runId,
      user_id: record.user_id,
      service: "openai",
      operation: "classify-nice-classes",
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      api_calls: 1,
      estimated_cost_usd: estimatedCost,
    });

    console.log("[step-1] completed", {
      runId,
      niceClasses,
      candidateTarget,
      styleBuckets,
      duration: `${Date.now() - startTime}ms`,
    });

    return new Response(
      JSON.stringify({
        nice_classes: niceClasses,
        candidate_target: candidateTarget,
        style_buckets: styleBuckets,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[step-1] error", {
      error: err.message,
      duration: `${Date.now() - startTime}ms`,
    });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});