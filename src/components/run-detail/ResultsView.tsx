import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResultCard } from "./ResultCard";
import { DetailPanel } from "./DetailPanel";
import type { Run, RunResult, SortOption, FilterStars, DomainEntry } from "./types";

const STAR_LABELS: Record<number, string> = {
  5: "Very Likely (5★)",
  4: "Likely (4★+)",
  3: "Neutral (3★+)",
  2: "Unlikely (2★+)",
  1: "Very Unlikely (all)",
};

export function ResultsView({ run, results }: { run: Run; results: RunResult[] }) {
  const [sortBy, setSortBy] = useState<SortOption>("stars");
  const [filterStars, setFilterStars] = useState<FilterStars>(1);
  const [visibleCount, setVisibleCount] = useState(25);
  const [selectedResult, setSelectedResult] = useState<RunResult | null>(null);

  const isPartial = run.status === "partial_complete";
  const completedDate = run.completed_at ? new Date(run.completed_at) : null;

  // Check for USPTO issues
  const hasUsptoIssues = results.some((r) => r.uspto_status === "unavailable" || r.uspto_status === "error");
  // Check for domain timeout issues
  const hasDomainIssues = results.some((r) => {
    if (!r.domain_results) return false;
    return Object.values(r.domain_results as Record<string, DomainEntry>).some(
      (d) => d.available === undefined || d.available === null
    );
  });

  const sortedResults = useMemo(() => {
    let filtered = results.filter((r) => (r.uspto_stars ?? 0) >= filterStars);

    filtered.sort((a, b) => {
      if (sortBy === "stars") return (b.uspto_stars ?? 0) - (a.uspto_stars ?? 0);
      if (sortBy === "name") return a.name.localeCompare(b.name);
      const countAvail = (d: Record<string, DomainEntry> | null) =>
        d ? Object.values(d).filter((v) => v.available).length : 0;
      return countAvail(b.domain_results as Record<string, DomainEntry> | null) -
        countAvail(a.domain_results as Record<string, DomainEntry> | null);
    });
    return filtered;
  }, [results, sortBy, filterStars]);

  const visible = sortedResults.slice(0, visibleCount);
  const hasMore = visibleCount < sortedResults.length;
  const isNonDefault = filterStars !== 1;
  const truncatedDesc = run.product_description.length > 60
    ? run.product_description.slice(0, 57) + "..."
    : run.product_description;

  return (
    <div>
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4" aria-label="Back to dashboard">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Dashboard
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {truncatedDesc} — Brand Name Results
              </h1>
              {completedDate && (
                <p className="text-sm text-muted-foreground mt-1">
                  Completed {completedDate.toLocaleDateString()} at {completedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
            <Badge
              className={`self-start text-sm px-3 py-1 border-0 ${
                isPartial
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
                  : "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
              }`}
            >
              {run.results_count ?? results.length} results
            </Badge>
          </div>
        </div>
      </div>

      {/* Warning banners */}
      {isPartial && (
        <div className="bg-amber-50 border-b border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
          <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-2 flex-1">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-amber-900 dark:text-amber-200">
                We found {run.results_count} names matching your filters — fewer than the target of 50. Try relaxing your USPTO approval threshold or enabling prefix/suffix domain variants.
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/new-run">Start New Run →</Link>
            </Button>
          </div>
        </div>
      )}

      {hasUsptoIssues && (
        <div className="bg-amber-50 border-b border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              USPTO data was temporarily unavailable for some names. Trademark data may be incomplete — we recommend rechecking flagged names manually.
            </p>
          </div>
        </div>
      )}

      {/* Filter/Sort bar */}
      <div className="sticky top-14 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-[200px]" aria-label="Sort results by">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stars">USPTO Stars</SelectItem>
              <SelectItem value="name">Name A–Z</SelectItem>
              <SelectItem value="domains">Domain Availability</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-3">
            <Select value={String(filterStars)} onValueChange={(v) => { setFilterStars(Number(v) as FilterStars); setVisibleCount(25); }}>
              <SelectTrigger className="w-[200px]" aria-label="Filter by minimum stars">
                <SelectValue placeholder="Filter by stars" />
              </SelectTrigger>
              <SelectContent>
                {[5, 4, 3, 2, 1].map((s) => (
                  <SelectItem key={s} value={String(s)}>{STAR_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isNonDefault && (
              <button
                onClick={() => { setFilterStars(1); setVisibleCount(25); }}
                className="text-sm text-primary hover:underline whitespace-nowrap"
                aria-label="Clear star filter"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results grid */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        {visible.length === 0 ? (
          <div className="text-center py-16">
            <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground mb-3" aria-hidden="true" />
            <p className="text-foreground font-medium">No results match your current filters.</p>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting the USPTO threshold above.</p>
            {isNonDefault && (
              <button
                onClick={() => { setFilterStars(1); setVisibleCount(25); }}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visible.map((r) => (
                <ResultCard key={r.id} result={r} onViewDetails={setSelectedResult} />
              ))}
            </div>
            {hasMore && (
              <div className="mt-8 text-center">
                <Button variant="outline" onClick={() => setVisibleCount((c) => c + 25)} aria-label="Load 25 more results">
                  Load 25 more ({sortedResults.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail panel */}
      <DetailPanel
        result={selectedResult}
        niceClasses={run.nice_classes}
        onClose={() => setSelectedResult(null)}
      />
    </div>
  );
}
