import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Sparkles, ArrowRight, AlertTriangle } from "lucide-react";

type RunSummary = {
  id: string;
  status: string;
  product_description: string;
  results_count: number;
  created_at: string;
  current_step: string | null;
};

type CreditInfo = {
  available: number;
  total: number;
  used: number;
  expiresAt: string | null;
};

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  complete: "default",
  partial_complete: "outline",
  failed: "destructive",
};

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <Skeleton className="h-9 w-64 mb-2" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-10 w-56" />
      <div>
        <Skeleton className="h-6 w-40 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

const Dashboard = () => {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [credits, setCredits] = useState<CreditInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Payment success/cancel toasts
  useEffect(() => {
    const payment = searchParams.get("payment");
    const pkg = searchParams.get("package");
    if (payment === "success") {
      toast({ title: "Payment successful!", description: `Your credits have been added.${pkg ? ` (${pkg} package)` : ""}` });
      searchParams.delete("payment");
      searchParams.delete("package");
      setSearchParams(searchParams, { replace: true });
    } else if (payment === "cancelled") {
      toast({ title: "Payment not completed", description: "You have not been charged.", variant: "destructive" });
      searchParams.delete("payment");
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    Promise.all([
      supabase
        .from("runs")
        .select("id, status, product_description, results_count, created_at, current_step")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("purchases")
        .select("credits_total, credits_used, expires_at")
        .eq("user_id", user.id)
        .gte("expires_at", new Date().toISOString())
        .order("purchased_at", { ascending: true }),
    ]).then(([runsRes, creditsRes]) => {
      if (runsRes.data) setRuns(runsRes.data as RunSummary[]);
      if (creditsRes.data && creditsRes.data.length > 0) {
        const total = creditsRes.data.reduce((s, p) => s + p.credits_total, 0);
        const used = creditsRes.data.reduce((s, p) => s + (p.credits_used ?? 0), 0);
        setCredits({ available: total - used, total, used, expiresAt: creditsRes.data[0].expires_at });
      } else {
        setCredits({ available: 0, total: 0, used: 0, expiresAt: null });
      }
      setLoading(false);
    });
  }, [user]);

  if (authLoading || loading) {
    return (
      <div className="py-8 px-4">
        <div className="mx-auto max-w-4xl">
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Please sign in to view your dashboard.</p>
      </div>
    );
  }

  const firstName = user.user_metadata?.full_name?.split(" ")[0] || "there";
  const hasCredits = credits && credits.available > 0;

  return (
    <div className="py-8 px-4">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">Welcome back, {firstName}</h1>
          <p className="text-muted-foreground mt-1">Your brand name searches</p>
        </div>

        {/* Credits card */}
        {hasCredits ? (
          <Card>
            <CardContent className="py-4 flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {credits.available} credits remaining
                  {credits.expiresAt && <span className="text-muted-foreground"> · Expires {new Date(credits.expiresAt).toLocaleDateString()}</span>}
                </p>
                <Progress value={(credits.used / credits.total) * 100} className="mt-2 h-2" aria-label="Credit usage progress" />
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/account">Manage</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10">
            <CardContent className="py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  No active credits — purchase a package to start generating.
                </p>
              </div>
              <Button size="sm" asChild>
                <Link to="/account">Buy Credits →</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Primary CTA */}
        <div>
          {hasCredits ? (
            <Button size="lg" asChild className="w-full sm:w-auto">
              <Link to="/new-run">
                <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" /> Generate Brand Names →
              </Link>
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="lg" disabled className="w-full sm:w-auto" aria-label="Generate Brand Names — purchase credits first">
                    <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" /> Generate Brand Names →
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Purchase credits to start</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Recent Runs */}
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-4">Your Recent Runs</h2>
          {runs.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Sparkles className="mx-auto h-12 w-12 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground">You haven't run Brandly yet</h3>
                <p className="text-muted-foreground mt-2">Start your first name search.</p>
                {hasCredits && (
                  <Button asChild className="mt-6">
                    <Link to="/new-run"><Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Create Your First Search</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => {
                const isRunning = !["complete", "partial_complete", "failed", "error"].includes(run.status);
                return (
                  <Link key={run.id} to={`/runs/${run.id}`} className="block" aria-label={`View run: ${run.product_description}`}>
                    <Card className="hover:border-primary/50 transition-colors">
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">{run.product_description}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {isRunning ? (
                                <span className="flex items-center gap-1">
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                  {run.current_step || "Processing..."}
                                </span>
                              ) : (
                                <>{run.results_count ?? 0} results · {new Date(run.created_at).toLocaleDateString()}</>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={STATUS_COLORS[run.status] ?? "secondary"}>
                              {isRunning ? "Running" : run.status.replace("_", " ")}
                            </Badge>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
