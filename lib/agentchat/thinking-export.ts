import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { connectToDatabase } from "@/lib/db";
import { Belief } from "@/models/Belief";
import { BeliefVersion } from "@/models/BeliefVersion";

function clip(value: string, max = 280): string {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function formatPercent(value: number): string {
  const safe = Math.max(0, Math.min(1, Number(value ?? 0)));
  return `${Math.round(safe * 100)}%`;
}

function isoToDateTime(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString();
}

function resolveConfiguredThinkingExportDir(): string {
  const configured = String(process.env.THINKING_EXPORT_DIR ?? "").trim();
  if (configured) return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  return path.join(process.cwd(), "data", "thinking");
}

function resolveThinkingExportDirCandidates(): string[] {
  const configured = resolveConfiguredThinkingExportDir();
  const candidates = [configured];
  const vercelTmp = "/tmp/thinking";
  if (!candidates.includes(vercelTmp)) {
    candidates.push(vercelTmp);
  }
  return candidates;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, filePath);
}

function buildCurrentMarkdown(
  rows: Array<{
    topic: string;
    statement: string;
    confidence: number;
    updatedAt: Date | string;
    sourceType?: string;
  }>
): string {
  const lines: string[] = [];
  lines.push("# current thinking");
  lines.push("");
  lines.push(`updated_at: ${new Date().toISOString()}`);
  lines.push("");

  if (rows.length === 0) {
    lines.push("_no active beliefs yet._");
    lines.push("");
    return lines.join("\n");
  }

  for (const row of rows) {
    lines.push(`## ${row.topic}`);
    lines.push(`- statement: ${clip(row.statement, 320)}`);
    lines.push(`- confidence: ${formatPercent(row.confidence)}`);
    lines.push(`- source: ${row.sourceType ?? "unknown"}`);
    lines.push(`- updated_at: ${isoToDateTime(row.updatedAt)}`);
    lines.push("");
  }

  return lines.join("\n");
}

function buildTimelineMarkdown(
  rows: Array<{
    topic: string;
    statement: string;
    eventType: string;
    status: string;
    confidence: number;
    reason?: string | null;
    createdAt: Date | string;
  }>
): string {
  const lines: string[] = [];
  lines.push("# thinking timeline");
  lines.push("");
  lines.push(`generated_at: ${new Date().toISOString()}`);
  lines.push("");

  if (rows.length === 0) {
    lines.push("_no timeline events yet._");
    lines.push("");
    return lines.join("\n");
  }

  for (const row of rows) {
    const createdAt = isoToDateTime(row.createdAt);
    lines.push(
      `- ${createdAt} · ${row.topic} · ${row.eventType} · ${row.status} · ${formatPercent(
        row.confidence
      )}`
    );
    lines.push(`  ${clip(row.statement, 320)}`);
    if (row.reason) lines.push(`  reason: ${clip(row.reason, 200)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function exportThinkingMarkdown(): Promise<{ dir: string; currentPath: string; timelinePath: string }> {
  await connectToDatabase();

  const [activeBeliefs, timelineRows] = await Promise.all([
    Belief.find({ status: "active" })
      .sort({ updatedAt: -1 })
      .limit(200)
      .select({ topic: 1, statement: 1, confidence: 1, updatedAt: 1, sourceType: 1 })
      .lean<
        Array<{
          topic: string;
          statement: string;
          confidence: number;
          updatedAt: Date | string;
          sourceType?: string;
        }>
      >()
      .exec(),
    BeliefVersion.find({})
      .sort({ createdAt: -1 })
      .limit(600)
      .select({ topic: 1, statement: 1, eventType: 1, status: 1, confidence: 1, reason: 1, createdAt: 1 })
      .lean<
        Array<{
          topic: string;
          statement: string;
          eventType: string;
          status: string;
          confidence: number;
          reason?: string | null;
          createdAt: Date | string;
        }>
      >()
      .exec(),
  ]);

  const currentContent = buildCurrentMarkdown(activeBeliefs);
  const timelineContent = buildTimelineMarkdown(timelineRows);
  const dirs = resolveThinkingExportDirCandidates();
  let lastError: unknown = null;

  for (const dir of dirs) {
    try {
      await mkdir(dir, { recursive: true });
      const currentPath = path.join(dir, "current.md");
      const timelinePath = path.join(dir, "timeline.md");
      await Promise.all([atomicWrite(currentPath, currentContent), atomicWrite(timelinePath, timelineContent)]);
      return { dir, currentPath, timelinePath };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Could not write thinking markdown");
}

export async function tryExportThinkingMarkdown(): Promise<void> {
  try {
    await exportThinkingMarkdown();
  } catch (error) {
    console.error("thinking markdown export failed", error);
  }
}
