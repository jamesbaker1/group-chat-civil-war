// questions.js — imports the 4 category files (compile-time JSON imports, no runtime fetch),
// merges them into one bank, and runs a tolerant integrity check.
//
// The bank may be EMPTY or PARTIAL at module load (other agents are stocking the armory
// right now). Nothing in here may throw at import time. Bad rows are skipped, not fatal.

import trivia from "../data/questions/trivia.json";
import quotes from "../data/questions/who-said-it.json";
import headlines from "../data/questions/headlines.json";
import stats from "../data/questions/stat-duel.json";

const VALID_CATEGORIES = new Set(["trivia", "quote", "headline", "stat"]);
const VALID_CITIES = new Set(["PHI", "NY", "BOTH"]);

// Expected choice count per category (per the spec table). null = "any non-empty" tolerance.
const EXPECTED_CHOICES = {
  trivia: 4,
  quote: 4,
  headline: 2,
  stat: 2,
};

function isValidQuestion(q) {
  if (!q || typeof q !== "object") return false;
  if (typeof q.id !== "string" || q.id.length === 0) return false;
  if (typeof q.category !== "string" || !VALID_CATEGORIES.has(q.category)) return false;
  if (typeof q.city !== "string" || !VALID_CITIES.has(q.city)) return false;
  if (typeof q.prompt !== "string" || q.prompt.length === 0) return false;
  if (!Array.isArray(q.choices) || q.choices.length < 2) return false;
  if (!q.choices.every((c) => typeof c === "string")) return false;
  if (
    typeof q.answer_index !== "number" ||
    !Number.isInteger(q.answer_index) ||
    q.answer_index < 0 ||
    q.answer_index >= q.choices.length
  )
    return false;
  // flavor / roast / difficulty are content niceties; default them rather than reject.
  return true;
}

function normalize(q) {
  return {
    id: q.id,
    category: q.category,
    city: q.city,
    prompt: q.prompt,
    choices: q.choices.slice(),
    answer_index: q.answer_index,
    flavor: typeof q.flavor === "string" ? q.flavor : "A clean hit. The enemy reels.",
    roast:
      typeof q.roast === "string"
        ? q.roast
        : "☠️ CASUALTY REPORT: A soldier fell believing a falsehood. The dispatch is brief and unkind.",
    difficulty:
      typeof q.difficulty === "number" && q.difficulty >= 1 && q.difficulty <= 3
        ? q.difficulty
        : 1,
  };
}

function safeArray(x) {
  return Array.isArray(x) ? x : [];
}

// Build the merged bank, skipping malformed rows and de-duping ids (first id wins).
const _raw = [
  ...safeArray(trivia),
  ...safeArray(quotes),
  ...safeArray(headlines),
  ...safeArray(stats),
];

const _seen = new Set();
export const BANK = [];
export const integrity = {
  total: 0,
  skippedInvalid: 0,
  skippedDuplicate: 0,
  byCategory: { trivia: 0, quote: 0, headline: 0, stat: 0 },
  byCity: { PHI: 0, NY: 0, BOTH: 0 },
  wrongChoiceCount: [], // ids whose choice count doesn't match the spec table (warn-only)
};

for (const q of _raw) {
  if (!isValidQuestion(q)) {
    integrity.skippedInvalid++;
    continue;
  }
  if (_seen.has(q.id)) {
    integrity.skippedDuplicate++;
    continue;
  }
  _seen.add(q.id);
  const n = normalize(q);
  if (EXPECTED_CHOICES[n.category] && n.choices.length !== EXPECTED_CHOICES[n.category]) {
    integrity.wrongChoiceCount.push(n.id);
  }
  BANK.push(n);
  integrity.total++;
  integrity.byCategory[n.category]++;
  integrity.byCity[n.city]++;
}

// Index by id for O(1) scoring lookups.
export const BY_ID = new Map(BANK.map((q) => [q.id, q]));

export function questionById(id) {
  return BY_ID.get(id) || null;
}

// The "armory is stocked enough to fight" gate. Spec §hard-constraints: < 10 → 503.
export const MIN_BANK = 10;
export function bankReady() {
  return BANK.length >= MIN_BANK;
}

// Strip server-only fields before sending a question to the client.
export function publicQuestion(q) {
  return {
    id: q.id,
    category: q.category,
    city: q.city,
    prompt: q.prompt,
    choices: q.choices,
  };
}
