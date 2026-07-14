export type Run = {
  id: string;
  status: string;
  current_step: string | null;
  product_description: string;
  batches_run: number;
  results_count: number;
  created_at: string;
  completed_at: string | null;
  filter_min_stars: number;
  nice_classes: number[] | null;
};

export type RunResult = {
  id: string;
  name: string;
  uspto_status: string | null;
  uspto_stars: number | null;
  uspto_reasoning: string | null;
  uspto_conflicting_marks: ConflictingMark[] | null;
  confusion_risk: string | null;
  domain_results: Record<string, DomainEntry> | null;
  web_snippet: string | null;
  web_summary: string | null;
  web_risk_level: string | null;
  web_risk_notes: string | null;
  presence_summary: string | null;
  brand_clarity: string | null;
  clarity_notes: string | null;
};

export type DomainEntry = {
  available: boolean;
  checked_domain: string;
  variant: string | null;
};

export type ConflictingMark = {
  mark: string;
  owner: string;
  serial_number: string;
  status: string;
  classes: number[];
  conflict_reason: string;
};

export const PIPELINE_STAGES = [
  { key: "pending", label: "Initialising run" },
  { key: "classified", label: "Classifying trademark categories" },
  { key: "batch_ready", label: "Generating candidate names" },
  { key: "uspto_done", label: "Checking USPTO trademarks" },
  { key: "domains_done", label: "Checking domain availability" },
  { key: "web_done", label: "Scanning web presence" },
  { key: "scored", label: "Scoring & ranking results" },
] as const;

export const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  classified: 1,
  batch_ready: 2,
  uspto_done: 3,
  domains_done: 4,
  web_done: 5,
  scored: 6,
  complete: 7,
  partial_complete: 7,
  failed: -1,
  error: -1,
};

export type SortOption = "stars" | "name" | "domains";
export type FilterStars = 1 | 2 | 3 | 4 | 5;
