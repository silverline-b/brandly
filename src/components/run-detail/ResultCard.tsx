import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RunResult, DomainEntry } from "./types";

const STAR_ARIA_LABELS: Record<number, string> = {
  5: "Very Likely",
  4: "Likely",
  3: "Neutral",
  2: "Unlikely",
  1: "Very Unlikely",
  0: "Not rated",
};

function StarRating({ stars }: { stars: number }) {
  const label = STAR_ARIA_LABELS[stars] || "Not rated";
  return (
    <div className="flex gap-0.5" role="img" aria-label={`${stars} out of 5 stars — ${label}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i <= stars ? "fill-primary text-primary" : "text-muted-foreground/30"}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function ConfusionBadge({ risk }: { risk: string | null }) {
  if (!risk || risk === "none" || risk === "low") {
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-0">✓ Clear</Badge>;
  }
  if (risk === "medium") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-0">⚠ Review</Badge>;
  }
  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-0">✗ Conflict</Badge>;
}

function BrandClarity({ riskLevel }: { riskLevel: string | null }) {
  const level = riskLevel ?? "none";
  if (level === "none" || level === "low") {
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-0">✓ Clear</Badge>;
  }
  if (level === "medium") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-0">~ Partial</Badge>;
  }
  if (level === "high") {
    return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 border-0">⚠ Crowded</Badge>;
  }
  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-0">✗ Taken</Badge>;
}

function BestDomainLine({ domains }: { domains: Record<string, DomainEntry> | null }) {
  if (!domains) return <span className="text-sm text-muted-foreground">✗ No domains checked</span>;

  const entries = Object.entries(domains);
  const available = entries.filter(([, d]) => d.available);

  if (available.length > 0) {
    // Prefer .com (exact or variant) over other TLDs
    const comExact = available.find(([, d]) => !d.variant && d.checked_domain.endsWith(".com"));
    const comVariant = available.find(([, d]) => d.variant && d.checked_domain.endsWith(".com"));
    const anyExact = available.find(([, d]) => !d.variant);
    const anyVariant = available.find(([, d]) => d.variant);

    const best = comExact ?? comVariant ?? anyExact ?? anyVariant ?? available[0];
    const isVariant = !!best[1].variant;

    return (
      <span className="text-sm text-emerald-700 font-medium flex items-center gap-1.5">
        ✓ {best[1].checked_domain}
        {isVariant && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{best[1].variant}</span>
        )}
      </span>
    );
  }

  // Check if any domains had timeouts/unknowns
  const hasUnknown = entries.some(([, d]) => d.available === undefined || d.available === null);
  if (hasUnknown) {
    return <span className="text-sm text-muted-foreground">? Unknown — check timed out</span>;
  }

  return <span className="text-sm text-muted-foreground">✗ No domains available</span>;
}

export function ResultCard({
  result,
  onViewDetails,
}: {
  result: RunResult;
  onViewDetails: (result: RunResult) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow focus-within:ring-2 focus-within:ring-primary/50">
      {/* Name */}
      <h3 className="text-2xl font-bold text-foreground tracking-tight">{result.name}</h3>

      {/* Stars + Confusion */}
      <div className="flex items-center gap-3">
        <StarRating stars={result.uspto_stars ?? 0} />
        <ConfusionBadge risk={result.confusion_risk} />
      </div>

      {/* Domain */}
      <BestDomainLine domains={result.domain_results as Record<string, DomainEntry> | null} />


      {/* Market presence */}
      {result.presence_summary && (
        <p className="text-sm italic text-muted-foreground line-clamp-2">
          <span className="not-italic font-medium">Market presence:</span> {result.presence_summary}
        </p>
      )}

      <Button
        variant="outline"
        size="sm"
        className="mt-auto self-start"
        onClick={() => onViewDetails(result)}
        aria-label={`View details for ${result.name}`}
      >
        View Details →
      </Button>
    </div>
  );
}
