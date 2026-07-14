import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgressView } from "@/components/run-detail/ProgressView";
import { ResultsView } from "@/components/run-detail/ResultsView";
import type { Run, RunResult } from "@/components/run-detail/types";

const TERMINAL_STATUSES = ["complete", "partial_complete", "failed", "error"];

function RunDetailSkeleton() {
  return (
    <div className="py-8 px-4">
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

const RunDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const [run, setRun] = useState<Run | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch run + subscribe to realtime
  useEffect(() => {
    if (!id || !user) return;

    supabase
      .from("runs")
      .select("id, status, current_step, product_description, batches_run, results_count, created_at, completed_at, filter_min_stars, nice_classes")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) setRun(data as Run);
        setLoading(false);
      });

    const channel = supabase
      .channel(`run-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${id}` },
        (payload) => {
          setRun((prev) => (prev ? { ...prev, ...payload.new } : prev));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, user]);

  // Polling fallback — re-fetch every 5s while run is in progress
  useEffect(() => {
    if (!id || !user || !run) return;
    if (TERMINAL_STATUSES.includes(run.status)) return;

    const interval = setInterval(() => {
      supabase
        .from("runs")
        .select("id, status, current_step, product_description, batches_run, results_count, created_at, completed_at, filter_min_stars, nice_classes")
        .eq("id", id)
        .single()
        .then(({ data }) => {
          if (data) setRun(data as Run);
        });
    }, 5000);

    return () => clearInterval(interval);
  }, [id, user, run?.status]);

  // Fetch results when run reaches terminal status
  useEffect(() => {
    if (!run || !["complete", "partial_complete"].includes(run.status)) return;

    supabase
      .from("run_results")
      .select("id, name, uspto_status, uspto_stars, uspto_reasoning, uspto_conflicting_marks, confusion_risk, domain_results, presence_summary, brand_clarity, clarity_notes")
      .eq("run_id", run.id)
      .order("uspto_stars", { ascending: false })
      .then(({ data }) => {
        if (data) setResults(data as unknown as RunResult[]);
      });
  }, [run?.status]);

  if (authLoading || loading) {
    return <RunDetailSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Please sign in to view this run.</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  // Failed state
  if (run.status === "failed" || run.status === "error") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="max-w-md w-full border-destructive">
          <CardContent className="py-10 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive mb-3" aria-hidden="true" />
            <p className="text-lg font-medium text-foreground">Your run encountered an error</p>
            <p className="text-sm text-muted-foreground mt-2">No credits were deducted. Please try again.</p>
            {run.current_step && (
              <p className="text-xs text-muted-foreground mt-1">{run.current_step}</p>
            )}
            <Button asChild className="mt-6">
              <Link to="/new-run">Start New Run →</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Running state
  if (!TERMINAL_STATUSES.includes(run.status)) {
    return <ProgressView run={run} />;
  }

  // Complete / partial_complete
  return <ResultsView run={run} results={results} />;
};

export default RunDetail;
