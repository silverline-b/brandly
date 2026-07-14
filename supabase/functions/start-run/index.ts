import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  try {
    console.log('[start-run] started');

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth client to verify user
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    // Service client for privileged operations
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();

    // 1. Check credits
    const { data: purchase, error: purchaseErr } = await supabase
      .from("purchases")
      .select("*")
      .eq("user_id", userId)
      .lt("credits_used", supabase.rpc ? undefined : undefined) // handled by filter below
      .gte("expires_at", new Date().toISOString())
      .order("purchased_at", { ascending: true })
      .limit(1)
      .single();

    // Manual credit check since we can't do credits_used < credits_total in PostgREST easily
    let validPurchase = purchase;
    if (!purchase || purchaseErr) {
      // Try fetching all valid purchases
      const { data: purchases } = await supabase
        .from("purchases")
        .select("*")
        .eq("user_id", userId)
        .gte("expires_at", new Date().toISOString())
        .order("purchased_at", { ascending: true });

      validPurchase = purchases?.find((p: any) => p.credits_used < p.credits_total) ?? null;
    } else if (purchase.credits_used >= purchase.credits_total) {
      const { data: purchases } = await supabase
        .from("purchases")
        .select("*")
        .eq("user_id", userId)
        .gte("expires_at", new Date().toISOString())
        .order("purchased_at", { ascending: true });

      validPurchase = purchases?.find((p: any) => p.credits_used < p.credits_total) ?? null;
    }

    if (!validPurchase) {
      return new Response(JSON.stringify({ error: "No credits available" }), { status: 400, headers: corsHeaders });
    }

    // 2. Check for runs ACTUALLY in progress.
    // Count real in-progress runs from the DB rather than trusting the
    // active_runs counter — that counter drifts upward whenever a run errors
    // before step-7 can decrement it, which permanently locked users out.
    // The 30-minute window ensures a run stuck forever can't block new runs.
    const TERMINAL_STATUSES = ["complete", "partial_complete", "failed", "error"];
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: openRuns } = await supabase
      .from("runs")
      .select("id")
      .eq("user_id", userId)
      .gte("created_at", thirtyMinAgo)
      .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`);
    const openCount = openRuns?.length ?? 0;
    if (openCount >= 2) {
      return new Response(JSON.stringify({ error: "You already have 2 runs in progress" }), { status: 429, headers: corsHeaders });
    }

    // 3. Self-heal the active_runs counter to reality (+ this new run).
    await supabase.from("profiles").update({ active_runs: openCount + 1 }).eq("id", userId);

    // 4. Insert new run
    const { data: newRun, error: runErr } = await supabase
      .from("runs")
      .insert({
        user_id: userId,
        status: "pending",
        product_description: body.product_description,
        keywords: body.keywords ?? [],
        vibe: body.vibe ?? [],
        target_audience: body.target_audience ?? null,
        name_style: body.name_style ?? "auto",
        name_length: body.name_length ?? "any",
        filter_min_stars: body.filter_min_stars ?? 3,
        filter_tlds: body.filter_tlds ?? [".com", ".io", ".app"],
        filter_allow_prefix_suffix: body.filter_allow_prefix_suffix ?? true,
        purchase_id: validPurchase.id,
      })
      .select("id")
      .single();

    if (runErr || !newRun) {
      // Rollback active_runs to the real open count (this new run failed to insert)
      await supabase.from("profiles").update({ active_runs: openCount }).eq("id", userId);
      return new Response(JSON.stringify({ error: "Failed to create run" }), { status: 500, headers: corsHeaders });
    }

    // 5. Log analytics event
    await supabase.from("analytics_events").insert({
      event_type: "run_started",
      user_id: userId,
      metadata: { run_id: newRun.id },
    });

    console.log('[start-run] completed', { runId: newRun.id, duration: `${Date.now() - startTime}ms` });

    return new Response(JSON.stringify({ run_id: newRun.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[start-run] error", { error: err.message, duration: `${Date.now() - startTime}ms` });
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
