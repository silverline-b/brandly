import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PACKAGE_PRICES: Record<string, number> = {
  starter: 24.99,
  standard: 44.99,
  pro: 79.99,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    // Verify user identity
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub;

    // Service role client for all queries (bypasses RLS)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check admin role
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const { report, email: grantEmail } = body;

    let result: unknown = null;

    // ─── OVERVIEW ───
    if (report === "overview") {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

      const [purchasesRes, profilesRes, runsRes, dailySpendRes] = await Promise.all([
        admin.from("purchases").select("package_id, credits_total, purchased_at"),
        admin.from("profiles").select("id, created_at"),
        admin.from("runs").select("id, status, created_at"),
        admin.from("daily_spend").select("date, total_usd").gte("date", thirtyDaysAgo).order("date"),
      ]);

      const purchases = purchasesRes.data || [];
      const profiles = profilesRes.data || [];
      const runs = runsRes.data || [];

      const totalRevenue = purchases.reduce((s, p) => s + (PACKAGE_PRICES[p.package_id] || 0), 0);
      const revenueThisMonth = purchases
        .filter((p) => p.purchased_at && p.purchased_at >= monthStart)
        .reduce((s, p) => s + (PACKAGE_PRICES[p.package_id] || 0), 0);

      const totalUsers = profiles.length;
      const newUsersThisMonth = profiles.filter((p) => p.created_at && p.created_at >= monthStart).length;

      const completedRuns = runs.filter((r) => r.status === "complete").length;
      const runsThisMonth = runs.filter((r) => r.created_at && r.created_at >= monthStart).length;

      // Daily chart data
      const dailyData: Record<string, { revenue: number; newUsers: number }> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const key = d.toISOString().slice(0, 10);
        dailyData[key] = { revenue: 0, newUsers: 0 };
      }
      purchases.forEach((p) => {
        if (p.purchased_at) {
          const key = p.purchased_at.slice(0, 10);
          if (dailyData[key]) dailyData[key].revenue += PACKAGE_PRICES[p.package_id] || 0;
        }
      });
      profiles.forEach((p) => {
        if (p.created_at) {
          const key = p.created_at.slice(0, 10);
          if (dailyData[key]) dailyData[key].newUsers += 1;
        }
      });

      result = {
        totalRevenue,
        revenueThisMonth,
        totalUsers,
        newUsersThisMonth,
        completedRuns,
        runsThisMonth,
        dailyChart: Object.entries(dailyData).map(([date, v]) => ({ date, ...v })),
      };
    }

    // ─── REVENUE ───
    else if (report === "revenue") {
      const { data: purchases } = await admin
        .from("purchases")
        .select("package_id, credits_total, purchased_at, stripe_payment_intent_id, user_id")
        .order("purchased_at", { ascending: false });

      const { data: profiles } = await admin.from("profiles").select("id, email");
      const emailMap: Record<string, string> = {};
      (profiles || []).forEach((p) => (emailMap[p.id] = p.email));

      const byPackage: Record<string, number> = {};
      (purchases || []).forEach((p) => {
        const pkg = p.package_id;
        byPackage[pkg] = (byPackage[pkg] || 0) + (PACKAGE_PRICES[pkg] || 0);
      });

      result = {
        byPackage: Object.entries(byPackage).map(([name, value]) => ({ name, value })),
        transactions: (purchases || []).map((p) => ({
          date: p.purchased_at,
          email: emailMap[p.user_id || ""] || "unknown",
          package_id: p.package_id,
          amount: PACKAGE_PRICES[p.package_id] || 0,
          stripe_id: p.stripe_payment_intent_id,
        })),
      };
    }

    // ─── USERS ───
    else if (report === "users") {
      const now = new Date().toISOString();
      const [profilesRes, purchasesRes, runsRes] = await Promise.all([
        admin.from("profiles").select("id, email, created_at"),
        admin.from("purchases").select("user_id, package_id, credits_total, credits_used, expires_at"),
        admin.from("runs").select("user_id, created_at").order("created_at", { ascending: false }),
      ]);

      const profiles = profilesRes.data || [];
      const purchases = purchasesRes.data || [];
      const runs = runsRes.data || [];

      const usersWithActive = new Set<string>();
      const usersWithExhausted = new Set<string>();
      const usersPurchased = new Set<string>();

      purchases.forEach((p) => {
        if (p.user_id) usersPurchased.add(p.user_id);
        const remaining = p.credits_total - (p.credits_used ?? 0);
        const expired = p.expires_at && p.expires_at < now;
        if (remaining > 0 && !expired && p.user_id) usersWithActive.add(p.user_id);
        else if (p.user_id) usersWithExhausted.add(p.user_id);
      });

      // Last run per user
      const lastRun: Record<string, string> = {};
      runs.forEach((r) => {
        if (r.user_id && !lastRun[r.user_id]) lastRun[r.user_id] = r.created_at!;
      });

      // User credit summaries
      const userCredits: Record<string, { package_id: string; remaining: number; expires_at: string | null }> = {};
      purchases.forEach((p) => {
        if (!p.user_id) return;
        const remaining = p.credits_total - (p.credits_used ?? 0);
        const expired = p.expires_at && p.expires_at < now;
        if (!expired && remaining > 0) {
          if (!userCredits[p.user_id] || remaining > userCredits[p.user_id].remaining) {
            userCredits[p.user_id] = { package_id: p.package_id, remaining, expires_at: p.expires_at };
          }
        }
      });

      result = {
        totalUsers: profiles.length,
        activeCredits: usersWithActive.size,
        exhaustedCredits: usersWithExhausted.size,
        conversionRate: profiles.length > 0 ? ((usersPurchased.size / profiles.length) * 100).toFixed(1) : "0",
        users: profiles.map((p) => ({
          email: p.email,
          joined: p.created_at,
          package_id: userCredits[p.id]?.package_id || null,
          creditsRemaining: userCredits[p.id]?.remaining ?? 0,
          expiresAt: userCredits[p.id]?.expires_at || null,
          lastRun: lastRun[p.id] || null,
        })),
      };
    }

    // ─── USAGE ───
    else if (report === "usage") {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

      const { data: runs } = await admin.from("runs").select("id, status, results_count, batches_run, created_at, filter_min_stars, filter_tlds");

      const allRuns = runs || [];
      const completed = allRuns.filter((r) => r.status === "complete");
      const runsThisMonth = allRuns.filter((r) => r.created_at && r.created_at >= monthStart);

      const successRate = allRuns.length > 0 ? ((completed.length / allRuns.length) * 100).toFixed(1) : "0";
      const avgResults = completed.length > 0 ? (completed.reduce((s, r) => s + (r.results_count || 0), 0) / completed.length).toFixed(1) : "0";
      const avgBatches = completed.length > 0 ? (completed.reduce((s, r) => s + (r.batches_run || 0), 0) / completed.length).toFixed(1) : "0";

      // Runs per day
      const runsPerDay: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
        runsPerDay[d] = 0;
      }
      allRuns.forEach((r) => {
        if (r.created_at) {
          const key = r.created_at.slice(0, 10);
          if (runsPerDay[key] !== undefined) runsPerDay[key]++;
        }
      });

      // Stars distribution
      const starsDist: Record<number, number> = {};
      allRuns.forEach((r) => {
        const s = r.filter_min_stars ?? 3;
        starsDist[s] = (starsDist[s] || 0) + 1;
      });

      // TLD distribution
      const tldDist: Record<string, number> = {};
      allRuns.forEach((r) => {
        ((r.filter_tlds as string[]) || []).forEach((t) => {
          tldDist[t] = (tldDist[t] || 0) + 1;
        });
      });

      // Status breakdown
      const statusBreakdown: Record<string, number> = {};
      allRuns.forEach((r) => {
        const s = r.status || "unknown";
        statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
      });

      result = {
        totalRuns: allRuns.length,
        runsThisMonth: runsThisMonth.length,
        successRate,
        avgResults,
        avgBatches,
        runsPerDay: Object.entries(runsPerDay).map(([date, count]) => ({ date, count })),
        starsDist: Object.entries(starsDist).map(([stars, count]) => ({ stars: Number(stars), count })),
        tldDist: Object.entries(tldDist).map(([tld, count]) => ({ tld, count })).sort((a, b) => b.count - a.count),
        statusBreakdown: Object.entries(statusBreakdown).map(([status, count]) => ({ status, count })),
      };
    }

    // ─── API COSTS ───
    else if (report === "api_costs") {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

      const [usageRes, dailyRes, runsRes, profilesRes] = await Promise.all([
        admin.from("api_usage_log").select("service, estimated_cost_usd, created_at, run_id"),
        admin.from("daily_spend").select("*").gte("date", thirtyDaysAgo).order("date"),
        admin.from("runs").select("id, user_id, created_at, batches_run, status"),
        admin.from("profiles").select("id, email"),
      ]);

      const usage = usageRes.data || [];
      const daily = dailyRes.data || [];
      const runs = runsRes.data || [];
      const profiles = profilesRes.data || [];

      const emailMap: Record<string, string> = {};
      profiles.forEach((p) => (emailMap[p.id] = p.email));

      // Monthly totals
      const monthUsage = usage.filter((u) => u.created_at && u.created_at >= monthStart);
      const totalMonth = monthUsage.reduce((s, u) => s + (u.estimated_cost_usd || 0), 0);
      const openaiMonth = monthUsage.filter((u) => u.service === "openai").reduce((s, u) => s + (u.estimated_cost_usd || 0), 0);
      const serperMonth = monthUsage.filter((u) => u.service === "serper").reduce((s, u) => s + (u.estimated_cost_usd || 0), 0);
      const domainrMonth = monthUsage.filter((u) => u.service === "domainr").reduce((s, u) => s + (u.estimated_cost_usd || 0), 0);

      const completedRuns = runs.filter((r) => r.status === "complete");
      const avgCostPerRun = completedRuns.length > 0 ? totalMonth / completedRuns.length : 0;

      // Aggregate cost per run
      const runCosts: Record<string, number> = {};
      usage.forEach((u) => {
        if (u.run_id) runCosts[u.run_id] = (runCosts[u.run_id] || 0) + (u.estimated_cost_usd || 0);
      });

      const highCostRuns = runs
        .filter((r) => (runCosts[r.id] || 0) > 1.0)
        .map((r) => ({
          id: r.id,
          email: emailMap[r.user_id || ""] || "unknown",
          date: r.created_at,
          batches: r.batches_run,
          cost: (runCosts[r.id] || 0).toFixed(2),
          status: r.status,
        }))
        .sort((a, b) => Number(b.cost) - Number(a.cost));

      result = {
        totalMonth: totalMonth.toFixed(2),
        openaiMonth: openaiMonth.toFixed(2),
        serperMonth: serperMonth.toFixed(2),
        domainrMonth: domainrMonth.toFixed(2),
        avgCostPerRun: avgCostPerRun.toFixed(2),
        dailySpend: daily.map((d) => ({
          date: d.date,
          openai: d.openai_usd || 0,
          serper: d.serper_usd || 0,
          domainr: d.domainr_usd || 0,
          total: d.total_usd || 0,
        })),
        highCostRuns,
      };
    }

    // ─── SETTINGS ───
    else if (report === "settings") {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);

      const [dailyRes, adminsRes, contactRes] = await Promise.all([
        admin.from("daily_spend").select("total_usd").eq("date", todayStr).maybeSingle(),
        admin.from("user_roles").select("user_id, role").eq("role", "admin"),
        admin.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(50),
      ]);

      // Get admin emails
      const adminUserIds = (adminsRes.data || []).map((r) => r.user_id);
      let adminEmails: string[] = [];
      if (adminUserIds.length > 0) {
        const { data: adminProfiles } = await admin
          .from("profiles")
          .select("id, email")
          .in("id", adminUserIds);
        adminEmails = (adminProfiles || []).map((p) => p.email);
      }

      result = {
        todaySpend: dailyRes.data?.total_usd ?? 0,
        admins: adminEmails,
        contactMessages: contactRes.data || [],
      };
    }

    // ─── GRANT ADMIN ───
    else if (report === "grant_admin") {
      if (!grantEmail) {
        return new Response(JSON.stringify({ error: "Email required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .eq("email", grantEmail)
        .maybeSingle();

      if (!profile) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await admin.from("user_roles").upsert(
        { user_id: profile.id, role: "admin" },
        { onConflict: "user_id,role" }
      );

      result = { success: true, email: grantEmail };
    }

    else {
      return new Response(JSON.stringify({ error: "Unknown report type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
