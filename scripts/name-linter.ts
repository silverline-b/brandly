// ─────────────────────────────────────────────────────────────────────────────
// name-linter.ts  —  Tier-1 deterministic linter for brand-name batches
//
// PURPOSE
//   A pure, zero-dependency function that scores a batch of candidate names
//   WITHOUT an LLM. It catches the mechanical failures — the ones that are
//   objectively wrong regardless of taste or category — and turns "are these
//   names good?" into a number your harness (and Claude Code) can move.
//
//   It is category-AGNOSTIC. All category knowledge comes from two inputs you
//   pass per run: `avoid` (the cliché/literal words for THIS product) and
//   `subsegmentTerms` (e.g. dog breeds) — both derived from the run's brief.
//
// WHAT IT IS NOT
//   It does not judge distinctiveness, hook, or fit-to-brief. Those are
//   subjective and belong to the Tier-2 LLM judge. This layer only removes
//   the names that never should have reached a human.
//
// USAGE (in your harness / pipeline)
//   import { lintBatch } from "./name-linter.ts";
//   const report = lintBatch(candidates, { avoid, subsegmentTerms });
//   console.log(report.score);            // 0..1  → your headline metric
//   report.results.filter(r => !r.passed) // the names it would cut
//
// RUN THE DEMO
//   node name-linter.ts        (Node 22.18+ runs .ts directly)
//   → scores the exact 99-name batch from your latest run, twice:
//     once with your run's ACTUAL avoid list, once with a corrected one.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export interface Candidate {
  name: string;
  components?: string[]; // English roots the generator claims it used ([] = coined)
  style?: string;
}

export type Severity = "fail" | "flag";

export interface Issue {
  check: string;
  severity: Severity;
  detail: string;
}

export interface LintResult {
  name: string;
  style?: string;
  issues: Issue[];
  passed: boolean; // true = zero FAIL-severity issues
  phonetics?: Phonetics; // brand-strength score (informational, not a gate)
}

export interface BatchReport {
  total: number;
  passed: number;
  score: number; // passed / total, 0..1  ← headline metric
  meanBrandStrength: number; // mean phonetic brand-strength of PASSING names, 0..100
  byCheck: Record<string, number>; // how many names each check fired on
  byStyle: Record<string, { total: number; passed: number }>;
  results: LintResult[];
}

export interface LintOptions {
  // TIER-1 saturated words for THIS category (paw/fur/tail; bean/brew/roast).
  // Cap at 1-3 — the words so overused they can't clear trademark. Hard FAIL.
  // NOT the broad category vocabulary: fresh tier-2 words (snout, wag, den) are
  // ENCOURAGED and must never appear here.
  avoid?: string[];
  // The literal product/format nouns (dog sling -> sling, carrier, tote). A bare
  // one of these is a descriptor, not a brand -> hard FAIL.
  productNouns?: string[];
  subsegmentTerms?: string[]; // breeds / models / sub-hobbies that split the audience
  extraBrands?: string[]; // extra known brands to block beyond the built-in set
}

// Per-name phonetic "brand strength" — the semi-objective naming science
// (plosive onset, 2-3 syllables, sayability). A SCORE (0-100), never a gate:
// a low score doesn't fail a name, it just marks it phonetically weaker.
export interface Phonetics {
  brandStrength: number; // 0..100
  plosiveOnset: boolean; // starts with k/hard-c/p/t/b/d/g/q -> recall boost
  syllables: number;
  sayable: boolean; // no ugly consonant pile-ups / vowel-less runs
}

// ── Constants ────────────────────────────────────────────────────────────────

// Filler endings that signal a name was BOLTED together rather than crafted.
// Presence alone isn't damning (real brands end in -o), so these only FLAG.
const FILLER_SUFFIXES = [
  "lux", "ora", "lyn", "eo", "ino", "ify", "ette", "elle", "etta",
  "essa", "ella", "olo", "ade", "let", "ton", "ume", "lume", "aura",
];
// Single-vowel tails handled separately (too common to treat like the above).
const VOWEL_TAILS = ["o", "a", "i"];

// A small, deterministic block of names that are already well-known brands.
// Not exhaustive — the Tier-2 judge and a real trademark check catch the rest —
// but it stops the egregious ones (this batch shipped Vogue and Cameo).
const KNOWN_BRANDS = new Set([
  "vogue", "cameo", "brio", "bijou", "nestle", "tiffany", "apple", "nike",
  "adidas", "coronet", "dandy", "cosset", "dove", "shell", "amazon",
]);

const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

// ── Small helpers ────────────────────────────────────────────────────────────

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

function isVowel(ch: string): boolean {
  return VOWELS.has(ch);
}

// Is `short` obtainable from `long` by deleting characters only (subsequence)?
function isSubsequence(short: string, long: string): boolean {
  let i = 0;
  for (let j = 0; j < long.length && i < short.length; j++) {
    if (short[i] === long[j]) i++;
  }
  return i === short.length;
}

// Which characters of `long` were deleted to make `short` (as a subsequence)?
function deletedChars(short: string, long: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (let j = 0; j < long.length; j++) {
    if (i < short.length && short[i] === long[j]) i++;
    else out.push(long[j]);
  }
  return out;
}

// Does the name end in a cluster of 2+ consonants (reads as "broken / typo")?
function endsInConsonantCluster(s: string): boolean {
  if (s.length < 2) return false;
  const a = s[s.length - 1];
  const b = s[s.length - 2];
  return !isVowel(a) && !isVowel(b);
}

// Stems of a component that a bolt might attach to: the word, and the word with
// a trailing vowel or trailing 'e' removed (canoodle → canoodl).
function stemsOf(comp: string): string[] {
  const c = norm(comp);
  const out = new Set<string>([c]);
  if (c.length > 4 && isVowel(c[c.length - 1])) out.add(c.slice(0, -1));
  return [...out].filter((s) => s.length >= 4);
}

// ── The checks ───────────────────────────────────────────────────────────────
// Each returns an Issue or null. FAIL counts against the score; FLAG is review.

// 1. Contains a word from THIS run's avoid list (literal/cliché category words).
function checkAvoid(c: Candidate, avoid: Set<string>): Issue | null {
  const n = norm(c.name);
  const comps = (c.components ?? []).map(norm);
  for (const bad of avoid) {
    if (bad.length < 3) continue;
    if (n.includes(bad) || comps.some((cp) => cp.includes(bad))) {
      return { check: "avoid_word", severity: "fail", detail: `contains "${bad}"` };
    }
  }
  return null;
}

// 2. LITERAL DESCRIPTOR — the name is (or contains, bare) a literal product
//    noun: "Sling" for a dog sling, "Coffee" for coffee. A descriptor, not a
//    brand -> hard FAIL.
//    NOTE: a bare REAL WORD is NO LONGER a failure on its own. Zeus, Puma,
//    Helium, Trove are bare real words used non-literally — legitimate brands.
//    Whether such a name is *good* is the judge's call, not the linter's. The
//    linter only kills words that literally name the product or are tier-1
//    saturated (handled by checkAvoid).
function checkLiteralDescriptor(c: Candidate, productNouns: Set<string>): Issue | null {
  if (productNouns.size === 0) return null;
  const n = norm(c.name);
  const comps = (c.components ?? []).map(norm);
  for (const pn of productNouns) {
    if (pn.length < 3) continue;
    // bare product noun as the whole name, or a product noun used as a root
    if (n === pn || comps.includes(pn)) {
      return { check: "product_noun", severity: "fail", detail: `literal descriptor "${pn}"` };
    }
  }
  return null;
}

// 3. A known existing brand — not ownable.
function checkKnownBrand(c: Candidate, brands: Set<string>): Issue | null {
  if (brands.has(norm(c.name))) {
    return { check: "known_brand", severity: "fail", detail: `existing brand "${c.name}"` };
  }
  return null;
}

// 4. A "typo" respelling: the name is a component with vowels DROPPED, leaving a
//    broken-looking stem (Cradl, Regl, Kennl, Velvt). The good Flickr/Lyft
//    pattern keeps the base recognisable and readable; these don't.
function checkTypoSpelling(c: Candidate): Issue | null {
  const n = norm(c.name);
  for (const comp of c.components ?? []) {
    const cc = norm(comp);
    if (cc === n || cc.length <= n.length) continue;
    if (!isSubsequence(n, cc)) continue;
    const removed = cc.length - n.length;
    if (removed < 1 || removed > 3) continue;
    const del = deletedChars(n, cc);
    const allVowels = del.every(isVowel);
    if (!allVowels) continue;
    // Broken if it now ends in a consonant that used to be followed by a vowel,
    // or ends in a consonant cluster.
    const droppedTrailingVowel = isVowel(cc[cc.length - 1]) && !isVowel(n[n.length - 1]);
    if (droppedTrailingVowel || endsInConsonantCluster(n)) {
      return { check: "typo_spelling", severity: "fail", detail: `"${comp}" with vowels dropped` };
    }
  }
  return null;
}

// 5. A filler suffix bolted onto a single real stem (Kennelux, Nuzzleton) or a
//    short vowel-coinage (Yippo, Poko). FLAG — sometimes fine, usually lazy.
function checkFillerSuffix(c: Candidate): Issue | null {
  const n = norm(c.name);
  const comps = c.components ?? [];

  // (a) stem + filler, where the stem is a declared single component
  if (comps.length <= 1) {
    for (const comp of comps) {
      for (const stem of stemsOf(comp)) {
        if (n.startsWith(stem) && n.length > stem.length) {
          const tail = n.slice(stem.length);
          if (FILLER_SUFFIXES.includes(tail) || VOWEL_TAILS.includes(tail)) {
            return { check: "filler_suffix", severity: "flag", detail: `"${comp}" + "-${tail}"` };
          }
        }
      }
    }
  }
  // (b) short coinage ending in a bare vowel with no declared roots (Yippo, Vello)
  if (comps.length === 0 && n.length <= 6 && VOWEL_TAILS.includes(n[n.length - 1])) {
    return { check: "filler_suffix", severity: "flag", detail: `short "-${n[n.length - 1]}" coinage` };
  }
  // (c) recognised filler ending regardless of roots (Hounora, Agilyn)
  for (const suf of FILLER_SUFFIXES) {
    if (n.length > suf.length + 2 && n.endsWith(suf)) {
      return { check: "filler_suffix", severity: "flag", detail: `ends in filler "-${suf}"` };
    }
  }
  return null;
}

// 6. Built on a sub-segment term (a breed) that only part of the market relates
//    to — violates the "whole-category altitude" rule. FLAG.
function checkSubsegment(c: Candidate, terms: Set<string>): Issue | null {
  const n = norm(c.name);
  const comps = (c.components ?? []).map(norm);
  for (const t of terms) {
    if (t.length < 3) continue;
    if (n.includes(t) || comps.some((cp) => cp.includes(t))) {
      return { check: "subsegment", severity: "flag", detail: `sub-segment term "${t}"` };
    }
  }
  return null;
}

// ── Batch-level check: root clustering ───────────────────────────────────────
// The prompt says "max 2 names per shared root". Count roots across the batch;
// flag every occurrence beyond the 2nd. Roots = declared components (len>=4)
// plus the name's first 4 chars (catches shared roots the model didn't declare).
function rootClusterFlags(cands: Candidate[]): Map<number, Issue> {
  const rootToIdx = new Map<string, number[]>();
  cands.forEach((c, idx) => {
    const roots = new Set<string>();
    for (const comp of c.components ?? []) {
      const cc = norm(comp);
      if (cc.length >= 4) roots.add(cc);
    }
    roots.add(norm(c.name).slice(0, 4));
    for (const r of roots) {
      if (!rootToIdx.has(r)) rootToIdx.set(r, []);
      rootToIdx.get(r)!.push(idx);
    }
  });

  const flags = new Map<number, Issue>();
  for (const [root, idxs] of rootToIdx) {
    if (idxs.length > 2) {
      // 3rd occurrence onward gets flagged (first two are allowed)
      idxs.slice(2).forEach((idx) => {
        if (!flags.has(idx)) {
          flags.set(idx, {
            check: "root_cluster",
            severity: "flag",
            detail: `root "${root}" used ${idxs.length}× in batch`,
          });
        }
      });
    }
  }
  return flags;
}

// ── Phonetic brand-strength (the naming science, as a SCORE not a gate) ──────
// Grounded in brand-naming research: plosive onsets (k/p/t/b/d/g) boost recall;
// 2-3 syllables is the memorable sweet spot; ease of pronunciation dominates
// appeal. This does NOT pass/fail names — it surfaces phonetic weakness so a
// batch's overall "brand strength" is visible alongside the pass rate.

const PLOSIVE_ONSETS = new Set(["k", "p", "t", "b", "d", "g", "q"]);

// rough syllable count: vowel-groups, minus a silent trailing 'e'
function countSyllables(s: string): number {
  const w = norm(s);
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 0;
  if (w.length > 2 && w.endsWith("e") && !isVowel(w[w.length - 2])) n = Math.max(1, n - 1);
  return Math.max(1, n);
}

function startsPlosive(s: string): boolean {
  const w = norm(s);
  if (!w) return false;
  if (w[0] === "c") return w.length > 1 && !"ei y".includes(w[1]); // hard c (cat) not soft (cell)
  return PLOSIVE_ONSETS.has(w[0]);
}

// sayable = no vowel-less run and no 3+ consonant pile-up
function isSayable(s: string): boolean {
  const w = norm(s);
  if (!w || !/[aeiouy]/.test(w)) return false;
  if (/[^aeiouy]{3,}/.test(w)) return false;
  return true;
}

export function phonetics(name: string): Phonetics {
  const syl = countSyllables(name);
  const plosive = startsPlosive(name);
  const sayable = isSayable(name);
  const len = norm(name).length;

  let score = 40;
  score += plosive ? 18 : 0;                         // plosive onset -> recall
  score += syl >= 2 && syl <= 3 ? 22 : syl === 1 ? 10 : syl === 4 ? 4 : 0; // 2-3 sweet spot
  score += sayable ? 15 : 0;                          // pronounceable
  score += len >= 4 && len <= 8 ? 5 : 0;              // tidy length
  if (!sayable) score = Math.min(score, 35);          // unsayable can't be strong
  return {
    brandStrength: Math.max(0, Math.min(100, score)),
    plosiveOnset: plosive,
    syllables: syl,
    sayable,
  };
}

// ── The public API ───────────────────────────────────────────────────────────

export function lintBatch(cands: Candidate[], opts: LintOptions = {}): BatchReport {
  const avoid = new Set((opts.avoid ?? []).map(norm).filter(Boolean));
  const productNouns = new Set((opts.productNouns ?? []).map(norm).filter(Boolean));
  const subsegment = new Set((opts.subsegmentTerms ?? []).map(norm).filter(Boolean));
  const brands = new Set([...KNOWN_BRANDS, ...(opts.extraBrands ?? []).map(norm)]);

  const clusterFlags = rootClusterFlags(cands);

  const results: LintResult[] = cands.map((c, idx) => {
    const issues: Issue[] = [];
    const push = (i: Issue | null) => { if (i) issues.push(i); };

    push(checkAvoid(c, avoid));              // tier-1 saturated -> hard fail (backstop)
    push(checkLiteralDescriptor(c, productNouns)); // literal product noun -> hard fail
    push(checkKnownBrand(c, brands));
    push(checkTypoSpelling(c));
    push(checkFillerSuffix(c));
    push(checkSubsegment(c, subsegment));
    if (clusterFlags.has(idx)) issues.push(clusterFlags.get(idx)!);

    const passed = !issues.some((i) => i.severity === "fail");
    return { name: c.name, style: c.style, issues, passed, phonetics: phonetics(c.name) };
  });

  const byCheck: Record<string, number> = {};
  const byStyle: Record<string, { total: number; passed: number }> = {};
  let passed = 0;

  for (const r of results) {
    if (r.passed) passed++;
    for (const i of r.issues) byCheck[i.check] = (byCheck[i.check] ?? 0) + 1;
    const s = r.style ?? "unknown";
    byStyle[s] ??= { total: 0, passed: 0 };
    byStyle[s].total++;
    if (r.passed) byStyle[s].passed++;
  }

  const passers = results.filter((r) => r.passed && r.phonetics);
  const meanBrandStrength = passers.length
    ? passers.reduce((a, r) => a + (r.phonetics!.brandStrength), 0) / passers.length
    : 0;

  return {
    total: results.length,
    passed,
    score: results.length ? passed / results.length : 0,
    meanBrandStrength,
    byCheck,
    byStyle,
    results,
  };
}

// (library build — demo block stripped)
