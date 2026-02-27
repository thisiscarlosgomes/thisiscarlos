import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type KnowledgeDoc = {
  fileName: string;
  title: string;
  content: string;
  tokens: Set<string>;
};

const KNOWLEDGE_DIR = path.join(process.cwd(), "elevenlabs-knowledge");
const ALWAYS_INCLUDE = new Set(["voice_guidelines.md", "bio.md"]);

let cache: KnowledgeDoc[] | null = null;

function toTitle(fileName: string): string {
  return fileName.replace(/\.md$/i, "").replace(/_/g, " ");
}

function tokenize(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(matches);
}

async function loadDocs(): Promise<KnowledgeDoc[]> {
  if (cache) return cache;

  let files: string[] = [];
  try {
    files = (await readdir(KNOWLEDGE_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    cache = [];
    return cache;
  }

  const docs = await Promise.all(
    files.map(async (fileName) => {
      const fullPath = path.join(KNOWLEDGE_DIR, fileName);
      const content = await readFile(fullPath, "utf8");
      return {
        fileName,
        title: toTitle(fileName),
        content: content.trim(),
        tokens: tokenize(content),
      } satisfies KnowledgeDoc;
    })
  );

  cache = docs;
  return docs;
}

function scoreDoc(doc: KnowledgeDoc, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;

  let score = 0;
  const lowerTitle = doc.title.toLowerCase();

  for (const token of queryTokens) {
    if (doc.tokens.has(token)) score += 1;
    if (lowerTitle.includes(token)) score += 2;
  }

  return score;
}

export async function buildKnowledgeContext(query: string): Promise<string> {
  const docs = await loadDocs();
  if (docs.length === 0) return "";

  const queryTokens = tokenize(query);

  const always = docs.filter((d) => ALWAYS_INCLUDE.has(d.fileName));
  const ranked = docs
    .filter((d) => !ALWAYS_INCLUDE.has(d.fileName))
    .map((doc) => ({ doc, score: scoreDoc(doc, queryTokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.doc);

  const selected = [...always, ...ranked];
  if (selected.length === 0) {
    return docs
      .slice(0, 2)
      .map((d) => `### ${d.title}\n${d.content}`)
      .join("\n\n");
  }

  return selected.map((d) => `### ${d.title}\n${d.content}`).join("\n\n");
}
