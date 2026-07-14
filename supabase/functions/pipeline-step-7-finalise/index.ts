import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET_RESULTS = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  try {
    const body = await req.json();
    const payload = body.record ?? body;
    const runId = payload.id;
    console.log('[step-7] started', { runId });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Fetch fresh run data
    const { data: record, error: fetchErr } = await supabase
      .from("runs").select("*").eq("id", runId).single();
    if (fetchErr || !record) {
      return new Response(JSON.stringify({ skipped: true, reason: "run not found" }), { headers: corsHeaders });
    }

    if (record.status !== "scored") {
      return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
    }

    const batchesRun: number = record.batches_run ?? 1;
    const userId: string = record.user_id;
    const purchaseId: string = record.purchase_id;

    // Read scored candidates from run_candidates
    const { data: prevData } = await supabase
      .from("run_candidates").select("data")
      .eq("run_id", runId).eq("stage", "scored")
      .order("created_at", { ascending: false }).limit(1).single();

    const scoredCandidates: any[] = prevData?.data ?? [];

    /* ───────────────────── Helper functions ───────────────────── */

    async function decrementActiveRuns() {
      const { data: profile } = await supabase.from("profiles").select("active_runs").eq("id", userId).single();
      if (profile) {
        await supabase.from("profiles").update({ active_runs: Math.max(0, (profile.active_runs ?? 1) - 1) }).eq("id", userId);
      }
    }

    async function deductCredits(amount: number) {
      if (amount <= 0 || !purchaseId) return;
      const { data: purchase } = await supabase.from("purchases").select("credits_used").eq("id", purchaseId).single();
      if (purchase) {
        await supabase.from("purchases").update({ credits_used: (purchase.credits_used ?? 0) + amount }).eq("id", purchaseId);
      }
    }

    async function hasRemainingCredits(): Promise<boolean> {
      if (!purchaseId) return false;
      const { data: purchase } = await supabase.from("purchases").select("credits_used, credits_total").eq("id", purchaseId).single();
      if (!purchase) return false;
      return (purchase.credits_used ?? 0) < purchase.credits_total;
    }

    async function resetAndLoop(nextBatchMessage: string) {
      await supabase.from("run_candidates")
        .delete()
        .eq("run_id", runId)
        .in("stage", ["generated", "uspto", "domains", "web", "scored"]);

      await supabase.from("runs").update({
        status: "classified",
        current_step: nextBatchMessage,
      }).eq("id", runId);
    }

    /* ───────────────────── Save results to run_results ───────────────────── */

    const { count: existingCount } = await supabase
      .from("run_results").select("id", { count: "exact", head: true }).eq("run_id", runId);

    const existingResults = existingCount ?? 0;
    const slotsRemaining = Math.max(0, TARGET_RESULTS - existingResults);
    const toInsert = scoredCandidates.slice(0, slotsRemaining);

    if (toInsert.length > 0) {
      const insertRows = toInsert.map((c: any) => ({
        run_id: runId,
        name: c.name,
        uspto_status: c.uspto_status ?? "clear",
        uspto_stars: c.uspto_stars ?? 3,
        uspto_conflicting_marks: c.uspto_conflicting_marks ?? [],
        uspto_reasoning: c.uspto_reasoning ?? "",
        confusion_risk: c.confusion_risk ?? "low",
        domain_results: c.domain_results ?? {},
        best_domain: c.best_domain ?? null,
        best_domain_is_exact: c.best_domain_is_exact ?? false,
        composite_score: c.composite_score ?? null,
        // Web presence fields — renamed in step 5
        presence_summary: c.presence_summary ?? "",
        brand_clarity: c.brand_clarity ?? "unchecked",
        clarity_notes: c.clarity_notes ?? "",
      }));
      await supabase.from("run_results").insert(insertRows);
    }

    const totalResults = existingResults + toInsert.length;

    /* ───────────────────── Decision logic ───────────────────── */

    let finalStatus = "";

    if (totalResults >= TARGET_RESULTS) {
      const creditsToDeduct = batchesRun <= 3 ? 1 : 2;
      await deductCredits(creditsToDeduct);

      await supabase.from("runs").update({
        status: "complete",
        current_step: `Done! ${totalResults} brand names ready.`,
        results_count: totalResults,
        credits_used_for_run: creditsToDeduct,
        completed_at: new Date().toISOString(),
      }).eq("id", runId).eq("status", "scored");

      await decrementActiveRuns();
      await supabase.from("analytics_events").insert({
        event_type: "run_complete", user_id: userId,
        metadata: { run_id: runId, results: totalResults, batches: batchesRun, credits_used: creditsToDeduct },
      });

      finalStatus = "complete";
      console.log('[step-7] completed', { runId, status: finalStatus, results: totalResults, batches: batchesRun, duration: `${Date.now() - startTime}ms` });
      return new Response(JSON.stringify({ status: "complete", results: totalResults, credits: creditsToDeduct }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // NO LOOPING. A single batch generates ~150 names and step-2 now keeps the
    // bulk of them for checking, so one batch should reach 50. If it still comes
    // up short we deliberately do NOT start another batch — we return whatever
    // qualified (partial_complete) rather than silently regenerating. (The old
    // behaviour looped up to 3 batches, which is what caused the "second run".)
    if (totalResults > 0) {
      await deductCredits(1);
      await supabase.from("runs").update({
        status: "partial_complete",
        current_step: `Completed with ${totalResults} names (target was ${TARGET_RESULTS}).`,
        results_count: totalResults, credits_used_for_run: 1, completed_at: new Date().toISOString(),
      }).eq("id", runId).eq("status", "scored");
      await decrementActiveRuns();
      await supabase.from("analytics_events").insert({ event_type: "run_partial", user_id: userId, metadata: { run_id: runId, results: totalResults, batches: batchesRun } });
      finalStatus = "partial_complete";
      console.log('[step-7] completed', { runId, status: finalStatus, results: totalResults, duration: `${Date.now() - startTime}ms` });
      return new Response(JSON.stringify({ status: "partial_complete", results: totalResults }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Failed: zero results
    await supabase.from("runs").update({
      status: "failed", current_step: "No qualifying names found. No credits were deducted.",
      results_count: 0, credits_used_for_run: 0, completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("status", "scored");
    await decrementActiveRuns();
    await supabase.from("analytics_events").insert({ event_type: "run_failed", user_id: userId, metadata: { run_id: runId, step: "finalise", error: "Zero qualifying results after all batches" } });

    console.log('[step-7] completed', { runId, status: 'failed', results: 0, duration: `${Date.now() - startTime}ms` });
    return new Response(JSON.stringify({ status: "failed", results: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[step-7] error", { error: err.message, duration: `${Date.now() - startTime}ms` });
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});