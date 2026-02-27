const STATIC_TOPIC_ALIASES: Record<string, string> = {
  "ai development": "ai product development",
  "ai experiments": "ai product development",
  "ai experiment": "ai product development",
  "ai product": "ai product development",
  "product development": "ai product development",
  "artificial intelligence development": "ai product development",
  "ai thinking": "ai product development",
  "current thinking": "decision making",
  "decision-making": "decision making",
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function normalizeTopic(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "general";
}

export function canonicalizeTopic(value: string): string {
  const normalized = normalizeTopic(value);
  return STATIC_TOPIC_ALIASES[normalized] ?? normalized;
}

function tokenOverlapScore(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const bSet = new Set(bTokens);
  const matches = aTokens.filter((token) => bSet.has(token)).length;
  if (matches === 0) return 0;

  const precision = matches / aTokens.length;
  const recall = matches / bTokens.length;
  return (precision + recall) / 2;
}

export function pickCanonicalTopic(input: {
  candidate: string;
  existingTopics: string[];
}): string {
  const candidate = canonicalizeTopic(input.candidate);
  if (candidate === "general") return candidate;

  let bestTopic = "";
  let bestScore = 0;

  for (const existingRaw of input.existingTopics) {
    const existing = canonicalizeTopic(existingRaw);
    if (!existing || existing === "general") continue;
    if (existing === candidate) return existing;

    const score = tokenOverlapScore(candidate, existing);
    if (score > bestScore) {
      bestScore = score;
      bestTopic = existing;
    }
  }

  if (bestScore >= 0.8) return bestTopic;
  return candidate;
}
