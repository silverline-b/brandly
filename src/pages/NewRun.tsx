import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, Loader2, ArrowRight, X, AlertTriangle } from "lucide-react";

/* ───────────────────── Constants ───────────────────── */

const STYLE_OPTIONS = [
  { value: "auto", label: "Auto", subtitle: "All styles mixed", badge: "recommended" },
  { value: "brandable", label: "Brandable", subtitle: "Like Google and Rolex" },
  { value: "evocative", label: "Evocative", subtitle: "Like RedBull and Forever21" },
  { value: "compound", label: "Compound words", subtitle: "Like FedEx and Microsoft" },
  { value: "alternate_spelling", label: "Alternate spelling", subtitle: "Like Lyft and Fiverr" },
  { value: "non_english", label: "Non-English words", subtitle: "Like Toyota and Audi" },
  { value: "short_phrase", label: "Short phrase", subtitle: "Like Dollar Shave Club" },
  { value: "real_words", label: "Real words", subtitle: "Like Apple and Amazon" },
];

const VIBE_OPTIONS = ["Professional", "Playful", "Bold", "Minimal", "Techy", "Friendly", "Luxurious", "Edgy"];

const TLD_OPTIONS = [
  ".com", ".net", ".org", ".io", ".co", ".app",
  ".us", ".dev", ".ai", ".tech", ".online", ".store",
  ".shop", ".info", ".biz",
];
const DEFAULT_TLDS = [".com", ".io", ".app"];

const THRESHOLD_OPTIONS = [
  { value: "5", label: "Very Likely (5 stars)", description: "only the strongest candidates" },
  { value: "4", label: "Likely (4 stars and above)" },
  { value: "3", label: "Neutral (3 stars and above)" },
  { value: "2", label: "Unlikely (2 stars and above)" },
  { value: "1", label: "Very Unlikely (show all results)" },
];

/* ───────────────────── Component ───────────────────── */

const NewRun = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const tagInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Credit info
  const [credits, setCredits] = useState<{ available: number; expiresAt: string | null } | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);

  // Form state
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [nameStyle, setNameStyle] = useState("auto");
  const [vibes, setVibes] = useState<string[]>([]);
  const [targetAudience, setTargetAudience] = useState("");
  const [nameLength, setNameLength] = useState("medium");
  const [filterMinStars, setFilterMinStars] = useState(3);
  const [filterTlds, setFilterTlds] = useState<string[]>(DEFAULT_TLDS);
  const [allowPrefixSuffix, setAllowPrefixSuffix] = useState(true);

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch credits
  useEffect(() => {
    if (!user) return;
    supabase
      .from("purchases")
      .select("credits_total, credits_used, expires_at")
      .eq("user_id", user.id)
      .gte("expires_at", new Date().toISOString())
      .order("purchased_at", { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          const totalAvailable = data.reduce((sum, p) => sum + (p.credits_total - (p.credits_used ?? 0)), 0);
          const nearestExpiry = data[0].expires_at;
          setCredits({ available: totalAvailable, expiresAt: nearestExpiry });
        } else {
          setCredits({ available: 0, expiresAt: null });
        }
        setCreditsLoading(false);
      });
  }, [user]);

  /* ───────────── Tag input handlers ───────────── */

  const addKeyword = (word: string) => {
    const cleaned = word.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "");
    if (!cleaned || keywords.includes(cleaned) || keywords.length >= 8) return;
    setKeywords((prev) => [...prev, cleaned]);
    setKeywordInput("");
    setErrors((prev) => ({ ...prev, keywords: "" }));
  };

  const removeKeyword = (word: string) => {
    setKeywords((prev) => prev.filter((k) => k !== word));
  };

  const handleKeywordKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && keywordInput.trim()) {
      e.preventDefault();
      addKeyword(keywordInput);
    }
    if (e.key === "Backspace" && !keywordInput && keywords.length > 0) {
      setKeywords((prev) => prev.slice(0, -1));
    }
  };

  /* ───────────── Toggles ───────────── */

  const toggleVibe = (v: string) => {
    setVibes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };

  const toggleTld = (tld: string) => {
    setFilterTlds((prev) =>
      prev.includes(tld) ? prev.filter((x) => x !== tld) : [...prev, tld],
    );
  };

  /* ───────────── Validation ───────────── */

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (description.trim().length < 20) {
      errs.description = "Please provide at least 20 characters describing your product or service.";
    }
    if (description.length > 300) {
      errs.description = "Description must be under 300 characters.";
    }
    if (keywords.length < 3) {
      errs.keywords = "Please add at least 3 keywords.";
    }
    if (filterTlds.length === 0) {
      errs.tlds = "Please select at least one domain extension.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /* ───────────── Submit ───────────── */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("start-run", {
        body: {
          product_description: description.trim(),
          keywords,
          name_style: nameStyle,
          name_length: nameLength,
          vibe: vibes,
          target_audience: targetAudience.trim() || null,
          filter_min_stars: filterMinStars,
          filter_tlds: filterTlds,
          filter_allow_prefix_suffix: allowPrefixSuffix,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: "Run started!", description: "Your brand name search is in progress." });
      navigate(`/runs/${data.run_id}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to start run", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  /* ───────────── Loading / auth guards ───────────── */

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Sign in required</h2>
          <p className="text-muted-foreground">You need to sign in to create a new brand name search.</p>
        </div>
      </div>
    );
  }

  const hasCredits = credits && credits.available > 0;

  return (
    <div className="py-8 px-4 sm:py-12">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">New Brand Name Search</h1>
          <p className="mt-2 text-muted-foreground">
            Describe your product and we'll generate unique, trademarkable brand names.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-10">
          {/* ─────── Section 1: Core Info ─────── */}
          <section className="space-y-6">
            {/* Product description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                What does your product or service do? <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Textarea
                  id="description"
                  placeholder="e.g. A mobile app that helps freelancers track their time and send invoices automatically"
                  value={description}
                  onChange={(e) => {
                    if (e.target.value.length <= 300) setDescription(e.target.value);
                  }}
                  rows={4}
                  className={errors.description ? "border-destructive" : ""}
                />
                <span className="absolute bottom-2 right-3 text-xs text-muted-foreground">
                  {description.length}/300
                </span>
              </div>
              {errors.description ? (
                <p className="text-sm text-destructive">{errors.description}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Be specific — this determines which trademark categories we search
                </p>
              )}
            </div>

            {/* Keywords tag input */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Descriptive Keywords <span className="text-destructive">*</span>
              </Label>
              <div
                className={`flex flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 min-h-[42px] cursor-text bg-background ${
                  errors.keywords ? "border-destructive" : "border-input"
                }`}
                onClick={() => tagInputRef.current?.focus()}
              >
                {keywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="gap-1 pl-2.5 pr-1 py-0.5 text-sm">
                    {kw}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeKeyword(kw);
                      }}
                      className="ml-0.5 rounded-full hover:bg-muted p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {keywords.length < 8 && (
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={handleKeywordKeyDown}
                    onBlur={() => {
                      if (keywordInput.trim()) addKeyword(keywordInput);
                    }}
                    placeholder={keywords.length === 0 ? "Type a word and press Enter — e.g. fast, secure, modern" : ""}
                    className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
                  />
                )}
              </div>
              {errors.keywords ? (
                <p className="text-sm text-destructive">{errors.keywords}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Add 3–8 words that capture the essence of your brand ({keywords.length}/8)
                </p>
              )}
            </div>
          </section>

          {/* ─────── Section 2: Name Style ─────── */}
          <section className="space-y-4">
            <Label className="text-sm font-medium">How should the name be generated?</Label>
            <div className="grid grid-cols-2 gap-3">
              {STYLE_OPTIONS.map((opt) => {
                const selected = nameStyle === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setNameStyle(opt.value)}
                    className={`relative flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    {/* Radio circle */}
                    <div
                      className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                        selected ? "border-primary" : "border-muted-foreground/40"
                      }`}
                    >
                      {selected && <div className="h-2 w-2 rounded-full bg-primary" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-foreground">{opt.label}</span>
                        {opt.badge && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                            {opt.badge}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{opt.subtitle}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ─────── Section 3: Optional Refinements ─────── */}
          <Collapsible open={refineOpen} onOpenChange={setRefineOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                Refine your results
                <ChevronDown className={`h-4 w-4 transition-transform text-muted-foreground ${refineOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-6">
              {/* Vibe */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Vibe / Tone</Label>
                <div className="flex flex-wrap gap-2">
                  {VIBE_OPTIONS.map((v) => (
                    <Button
                      key={v}
                      type="button"
                      variant={vibes.includes(v) ? "default" : "outline"}
                      size="sm"
                      className="rounded-full"
                      onClick={() => toggleVibe(v)}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Target audience */}
              <div className="space-y-2">
                <Label htmlFor="audience" className="text-sm font-medium">Target Audience</Label>
                <Input
                  id="audience"
                  placeholder="e.g. small business owners, Gen Z consumers"
                  maxLength={100}
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                />
              </div>

              {/* Name length */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Name Length</Label>
                <div className="flex rounded-lg border border-input overflow-hidden">
                  {([
                    { value: "short", label: "Short", example: "e.g. Lyft, Zoom" },
                    { value: "medium", label: "Medium", example: "e.g. Spotify, Notion" },
                    { value: "long", label: "Long", example: "e.g. Salesforce, Mailchimp" },
                    { value: "any", label: "Any", example: "No preference" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setNameLength(opt.value)}
                      className={`flex-1 py-2.5 px-3 text-center text-sm transition-colors ${
                        nameLength === opt.value
                          ? "bg-primary text-primary-foreground font-medium"
                          : "bg-background text-foreground hover:bg-muted"
                      }`}
                    >
                      <div className="font-medium">{opt.label}</div>
                      <div className={`text-[10px] ${nameLength === opt.value ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {opt.example}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* ─────── Section 4: Advanced Filters ─────── */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                Advanced Filters
                <ChevronDown className={`h-4 w-4 transition-transform text-muted-foreground ${advancedOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-6">
              {/* USPTO threshold */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Minimum trademark approval confidence</Label>
                <p className="text-xs text-muted-foreground">
                  Only show names rated at this confidence level and above. Selecting "Neutral" means you'll see names with a reasonable chance of approval — no major conflicts found, but not guaranteed. Higher thresholds return fewer but stronger results.
                </p>
                <Select
                  value={String(filterMinStars)}
                  onValueChange={(v) => setFilterMinStars(Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THRESHOLD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                        {opt.description && <span className="text-muted-foreground"> — {opt.description}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Domain extensions */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Which domain extensions matter to you?</Label>
                {errors.tlds && <p className="text-sm text-destructive">{errors.tlds}</p>}
                <div className="grid grid-cols-3 gap-2">
                  {TLD_OPTIONS.map((tld) => (
                    <label
                      key={tld}
                      className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={filterTlds.includes(tld)}
                        onCheckedChange={() => toggleTld(tld)}
                      />
                      <span className="text-foreground">{tld}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Prefix/suffix toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="prefix-suffix" className="text-sm font-medium">
                    Allow domain variants (e.g. getbrandname.com or brandnamehq.com)
                  </Label>
                  <Switch
                    id="prefix-suffix"
                    checked={allowPrefixSuffix}
                    onCheckedChange={setAllowPrefixSuffix}
                  />
                </div>
                {!allowPrefixSuffix && (
                  <div className="flex items-start gap-2 rounded-md bg-accent px-3 py-2 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                    <span className="text-muted-foreground">
                      Turning this off may significantly reduce results, as many exact-match domains are already registered.
                    </span>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* ─────── Submit ─────── */}
          <div className="space-y-3 pt-2">
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={submitting || !hasCredits}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting...
                </>
              ) : (
                <>
                  Generate 50 Brand Names <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            {creditsLoading ? (
              <p className="text-center text-xs text-muted-foreground">Loading credit info...</p>
            ) : hasCredits ? (
              <div className="text-center space-y-1">
                <p className="text-xs text-muted-foreground">
                  This will use 1 credit · You have{" "}
                  <span className="font-medium text-foreground">{credits!.available} credit{credits!.available !== 1 ? "s" : ""}</span>{" "}
                  remaining
                  {credits!.expiresAt && (
                    <> · Expires {new Date(credits!.expiresAt).toLocaleDateString()}</>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Runs typically take 2–4 minutes. You can leave this page — we'll save your results.
                </p>
              </div>
            ) : (
              <div className="text-center space-y-1">
                <p className="text-sm text-destructive font-medium">
                  You have no credits remaining.
                </p>
                <p className="text-xs text-muted-foreground">
                  <Link to="/account" className="underline hover:text-foreground">
                    Purchase a package
                  </Link>{" "}
                  to continue.
                </p>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewRun;
