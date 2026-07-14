import { X, Star, ExternalLink, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import type { RunResult, DomainEntry, ConflictingMark } from "./types";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-muted-foreground hover:text-foreground transition-colors"
      aria-label={`Copy ${text}`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function LargeStars({ stars }: { stars: number }) {
  return (
    <div className="flex gap-1" role="img" aria-label={`${stars} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-6 w-6 ${i <= stars ? "fill-primary text-primary" : "text-muted-foreground/30"}`} />
      ))}
    </div>
  );
}

function TrademarkTab({ result, niceClasses }: { result: RunResult; niceClasses: number[] | null }) {
  const marks = (result.uspto_conflicting_marks ?? []) as ConflictingMark[];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <LargeStars stars={result.uspto_stars ?? 0} />
        <Badge variant={
          !result.confusion_risk || result.confusion_risk === "none" || result.confusion_risk === "low"
            ? "default" : result.confusion_risk === "medium" ? "secondary" : "destructive"
        }>
          {result.confusion_risk === "high" ? "Conflict" : result.confusion_risk === "medium" ? "Similar exists" : "Clear"}
        </Badge>
      </div>

      {niceClasses && niceClasses.length > 0 && (
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">Nice Classes</p>
          <div className="flex flex-wrap gap-1.5">
            {niceClasses.map((c) => (
              <Badge key={c} variant="outline" className="text-xs">Class {c}</Badge>
            ))}
          </div>
        </div>
      )}

      {marks.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mark</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Serial No.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Classes</TableHead>
                <TableHead>Conflict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {marks.map((m, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{m.mark}</TableCell>
                  <TableCell>{m.owner}</TableCell>
                  <TableCell className="font-mono text-xs">{m.serial_number}</TableCell>
                  <TableCell>{m.status}</TableCell>
                  <TableCell>{m.classes?.join(", ")}</TableCell>
                  <TableCell className="text-sm">{m.conflict_reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No conflicting marks found in searched classes.</p>
      )}

      {result.uspto_reasoning && (
        <p className="text-sm text-foreground leading-relaxed">{result.uspto_reasoning}</p>
      )}

      <div className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
        ⚠ This analysis is informational only and does not constitute legal advice. Always consult a licensed USPTO-registered trademark attorney before filing any trademark application.
      </div>
    </div>
  );
}

function DomainsTab({ domains }: { domains: Record<string, DomainEntry> | null }) {
  if (!domains || Object.keys(domains).length === 0) {
    return <p className="text-sm text-muted-foreground">No domains were checked.</p>;
  }
  const entries = Object.entries(domains);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(([key, d]) => (
          <TableRow key={key}>
            <TableCell className={`font-mono text-sm ${!d.available ? "line-through text-muted-foreground" : ""}`}>
              {d.checked_domain}
            </TableCell>
            <TableCell>
              {d.available ? (
                <span className="text-emerald-700 font-medium">✓ Available</span>
              ) : (
                <span className="text-destructive">✗ Taken</span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="text-xs">
                {d.variant ? d.variant.charAt(0).toUpperCase() + d.variant.slice(1) : "Exact"}
              </Badge>
            </TableCell>
            <TableCell>
              {d.available && <CopyButton text={d.checked_domain} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BrandClarityBadge({ clarity }: { clarity: string }) {
  if (clarity === "clear") {
    return <Badge className="text-sm px-3 py-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-0">✓ Clear</Badge>;
  }
  if (clarity === "partial") {
    return <Badge className="text-sm px-3 py-1 bg-amber-100 text-amber-800 hover:bg-amber-100 border-0">~ Partial</Badge>;
  }
  if (clarity === "crowded") {
    return <Badge className="text-sm px-3 py-1 bg-orange-100 text-orange-800 hover:bg-orange-100 border-0">⚠ Crowded</Badge>;
  }
  if (clarity === "taken") {
    return <Badge className="text-sm px-3 py-1 bg-red-100 text-red-800 hover:bg-red-100 border-0">✗ Taken</Badge>;
  }
  return <Badge className="text-sm px-3 py-1 bg-muted text-muted-foreground hover:bg-muted border-0">Unknown</Badge>;
}

function WebTab({ result }: { result: RunResult }) {
  const clarity = result.brand_clarity ?? "clear";
  return (
    <div className="space-y-4">
      <BrandClarityBadge clarity={clarity} />

      {result.presence_summary && (
        <p className="text-sm italic text-muted-foreground leading-relaxed">
          <span className="not-italic font-medium text-foreground">Market presence:</span> {result.presence_summary}
        </p>
      )}

      {result.clarity_notes && (clarity === "partial" || clarity === "crowded" || clarity === "taken") && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          {result.clarity_notes}
        </div>
      )}

      <a
        href={`https://google.com/search?q=${encodeURIComponent(result.name + " brand company")}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        Search Google for &lsquo;{result.name}&rsquo; <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

export function DetailPanel({
  result,
  niceClasses,
  onClose,
}: {
  result: RunResult | null;
  niceClasses: number[] | null;
  onClose: () => void;
}) {
  if (!result) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      {/* Panel */}
      <div
        className="fixed right-0 top-0 z-50 h-full w-full max-w-lg overflow-y-auto border-l bg-background shadow-xl animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-label={`Details for ${result.name}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
          <h2 className="text-xl font-bold text-foreground">{result.name}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details panel">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6">
          <Tabs defaultValue="trademark">
            <TabsList className="w-full">
              <TabsTrigger value="trademark" className="flex-1">Trademark</TabsTrigger>
              <TabsTrigger value="domains" className="flex-1">Domains</TabsTrigger>
              <TabsTrigger value="web" className="flex-1">Brand Availability</TabsTrigger>
            </TabsList>
            <TabsContent value="trademark" className="mt-4">
              <TrademarkTab result={result} niceClasses={niceClasses} />
            </TabsContent>
            <TabsContent value="domains" className="mt-4">
              <DomainsTab domains={result.domain_results as Record<string, DomainEntry> | null} />
            </TabsContent>
            <TabsContent value="web" className="mt-4">
              <WebTab result={result} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
