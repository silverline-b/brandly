import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function cleanDomainName(name: string): string {
  // Keep only DNS-legal characters. (A previous version prefixed this with a
  // hand-written class that, through double-escaping, silently deleted every
  // letter "s" — e.g. "Silkenly" -> "ilkenly". This single pass is correct.)
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 63);
}

async function checkDomain(
  fullDomain: string,
  fastlyKey: string
): Promise<{ available: boolean | null; status: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `https://api.fastly.com/domain-management/v1/tools/status?domain=${encodeURIComponent(fullDomain)}`;
    const res = await fetch(url, {
      headers: { "Fastly-Key": fastlyKey },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errorBody = await res.text();
      console.error("Domain check failed:", {
        domain: fullDomain,
        status: res.status,
        statusText: res.statusText,
        body: errorBody,
      });
      return { available: null, status: "unknown" };
    }

    const data = await res.json();

    // status is a space-delimited string — rightmost value has highest priority.
    // "inactive" = available for registration
    const rawStatus: string = data?.status ?? "unknown";
    const statusParts = rawStatus.trim().split(/\s+/);
    const primaryStatus = statusParts[statusParts.length - 1];

    console.log(`[step-4] domain=${fullDomain} rawStatus="${rawStatus}" primary="${primaryStatus}"`);

    if (primaryStatus === "inactive") return { available: true, status: primaryStatus };
    if (
      primaryStatus === "active" ||
      primaryStatus === "parked" ||
      primaryStatus === "marketed" ||
      primaryStatus === "transferable" ||
      primaryStatus === "priced"
    ) {
      return { available: false, status: primaryStatus };
    }

    return { available: null, status: primaryStatus };
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err.name === "AbortError";
    console.error("Domain check exception:", {
      domain: fullDomain,
      error: isTimeout ? "timeout (4s)" : err.message,
      type: isTimeout ? "timeout" : "network",
    });
    return { available: null, status: "unknown" };
  }
}

// An "unknown" result (available === null) means Fastly errored or timed out —
// NOT that the domain is taken. Because step 6 requires a CONFIRMED domain,
// every unconfirmed check silently drops an otherwise-strong name. Retry a few
// times so a transient hiccup doesn't cost us a good name. Checks run in
// parallel, so this adds latency only for the domains that actually flaked.
async function checkDomainConfirmed(
  fullDomain: string,
  fastlyKey: string,
  attempts = 3
): Promise<{ available: boolean | null; status: string }> {
  let result = await checkDomain(fullDomain, fastlyKey);
  let tries = 1;
  while (result.available === null && tries < attempts) {
    await new Promise((r) => setTimeout(r, 300));
    result = await checkDomain(fullDomain, fastlyKey);
    tries++;
  }
  return result;
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
    console.log("[step-4] started", { runId });

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

    if (record.status !== "uspto_done") {
      return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
    }

    const fastlyKey = Deno.env.get("FASTLY_API_KEY") ?? "";
    console.log("[step-4] FASTLY_API_KEY configured:", !!fastlyKey);

    const { data: prevData } = await supabase
      .from("run_candidates")
      .select("data")
      .eq("run_id", runId)
      .eq("stage", "uspto")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const usptoResults: any[] = prevData?.data ?? [];
    const filterTlds: string[] = record.filter_tlds ?? [".com", ".io", ".app"];
    const filterMinStars: number = record.filter_min_stars ?? 3;
    const allowPrefixSuffix: boolean = record.filter_allow_prefix_suffix ?? true;

    const passingCandidates = usptoResults.filter(
      (c: any) => (c.uspto_stars ?? 0) >= filterMinStars
    );
    console.log("[step-4] candidates:", {
      total: usptoResults.length,
      passing: passingCandidates.length,
    });

    if (passingCandidates.length === 0) {
      await supabase
        .from("run_candidates")
        .insert({ run_id: runId, stage: "domains", data: [] });
      await supabase
        .from("runs")
        .update({
          status: "domains_done",
          current_step: "No candidates passed trademark check — skipping domains.",
        })
        .eq("id", runId)
        .eq("status", "uspto_done");
      return new Response(JSON.stringify({ checked: 0 }), { headers: corsHeaders });
    }

    const PREFIXES = ["get", "try", "use", "my", "the"];
    const SUFFIXES = ["app", "hq", "co"];
    let totalApiCalls = 0;
    let nullCount = 0;
    let availableCount = 0;
    let takenCount = 0;
    let skippedVariants = 0;

    const results = await Promise.all(
      passingCandidates.map(async (candidate: any) => {
        const cleaned = cleanDomainName(candidate.name);
        if (!cleaned) {
          return {
            ...candidate,
            domain_results: {},
            best_domain: null,
            best_domain_is_exact: false,
          };
        }

        const domainResults: Record<string, any> = {};

        // ── Step A: Check exact TLDs first ──────────────────────────────────
        const exactCheckPromises = filterTlds.map(async (tld) => {
          const domain = `${cleaned}${tld}`;
          const result = fastlyKey
            ? await checkDomainConfirmed(domain, fastlyKey)
            : { available: null, status: "unknown" };
          if (fastlyKey) {
            totalApiCalls++;
            if (result.available === null) nullCount++;
            else if (result.available === true) availableCount++;
            else takenCount++;
          }
          return { tld, domain, result };
        });

        const exactResults = await Promise.all(exactCheckPromises);
        for (const r of exactResults) {
          domainResults[r.tld] = {
            available: r.result.available,
            status: r.result.status,
            checked_domain: r.domain,
            variant: null,
          };
        }

        // ── Step B: Pick best exact TLD ──────────────────────────────────────
        let bestDomain: string | null = null;
        let bestDomainIsExact = false;

        for (const tld of filterTlds) {
          if (domainResults[tld]?.available === true) {
            bestDomain = domainResults[tld].checked_domain;
            bestDomainIsExact = true;
            break;
          }
        }

        // ── Step C: Skip variants if exact .com is clean ─────────────────────
        // A clean exact .com is the best possible outcome — prefix/suffix
        // variants add zero value and are wasted API calls.
        const exactComClean = domainResults[".com"]?.available === true;

        if (exactComClean) {
          console.log(`[step-4] skipping variants for "${candidate.name}" — .com is clean`);
          skippedVariants++;
        } else if (allowPrefixSuffix && filterTlds.includes(".com")) {
          // Only run variants when .com is NOT available
          const variantPromises: Array<{
            key: string;
            domain: string;
            variant: string;
          }> = [];

          for (const prefix of PREFIXES) {
            variantPromises.push({
              key: `${prefix}.com`,
              domain: `${prefix}${cleaned}.com`,
              variant: "prefix",
            });
          }
          for (const suffix of SUFFIXES) {
            variantPromises.push({
              key: `${suffix}.com`,
              domain: `${cleaned}${suffix}.com`,
              variant: "suffix",
            });
          }

          const variantResults = await Promise.all(
            variantPromises.map(async (vp) => {
              const result = fastlyKey
                ? await checkDomainConfirmed(vp.domain, fastlyKey)
                : { available: null, status: "unknown" };
              if (fastlyKey) {
                totalApiCalls++;
                if (result.available === null) nullCount++;
                else if (result.available === true) availableCount++;
                else takenCount++;
              }
              return { ...vp, result };
            })
          );

          for (const r of variantResults) {
            domainResults[r.key] = {
              available: r.result.available,
              status: r.result.status,
              checked_domain: r.domain,
              variant: r.variant,
            };
          }

          // Pick best variant if no exact TLD found
          if (!bestDomain) {
            for (const r of variantResults) {
              if (r.result.available === true) {
                bestDomain = r.domain;
                break;
              }
            }
          }
        }

        return {
          ...candidate,
          domain_results: domainResults,
          best_domain: bestDomain,
          best_domain_is_exact: bestDomainIsExact,
        };
      })
    );

    console.log("[step-4] domain summary", {
      totalApiCalls,
      available: availableCount,
      taken: takenCount,
      unknown: nullCount,
      skippedVariantChecks: skippedVariants,
    });

    await supabase
      .from("run_candidates")
      .insert({ run_id: runId, stage: "domains", data: results });

    const { error: updateErr } = await supabase
      .from("runs")
      .update({
        status: "domains_done",
        current_step: "Domain check complete — scanning the web...",
      })
      .eq("id", runId)
      .eq("status", "uspto_done");

    if (updateErr) console.error("Step 4 update failed:", updateErr);

    if (totalApiCalls > 0) {
      await supabase.from("api_usage_log").insert({
        run_id: runId,
        user_id: record.user_id,
        service: "fastly",
        operation: "domain-status",
        api_calls: totalApiCalls,
        estimated_cost_usd: totalApiCalls * 0.001,
      });
    }

    console.log("[step-4] completed", {
      runId,
      checked: results.length,
      domainApiCalls: totalApiCalls,
      skippedVariants,
      duration: `${Date.now() - startTime}ms`,
    });

    return new Response(
      JSON.stringify({
        checked: results.length,
        domainApiCalls: totalApiCalls,
        skippedVariants,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[step-4] error", {
      error: err.message,
      duration: `${Date.now() - startTime}ms`,
    });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});