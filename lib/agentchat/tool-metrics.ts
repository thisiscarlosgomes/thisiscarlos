import { connectToDatabase } from "@/lib/db";
import { ToolMetric } from "@/models/ToolMetric";

type RecordToolMetricInput = {
  tool: string;
  statusCode: number;
  success: boolean;
  latencyMs: number;
  errorCode?: string | null;
};

export async function recordToolMetric(input: RecordToolMetricInput): Promise<void> {
  try {
    await connectToDatabase();
    await ToolMetric.create({
      tool: input.tool,
      statusCode: input.statusCode,
      success: input.success,
      latencyMs: Math.max(0, Math.floor(input.latencyMs)),
      errorCode: input.errorCode ?? null,
    });
  } catch (error) {
    console.error("Failed to record tool metric", {
      tool: input.tool,
      statusCode: input.statusCode,
      success: input.success,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode ?? null,
      error,
    });
  }
}

type ToolMetricSummaryRow = {
  tool: string;
  total: number;
  successCount: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
};

export async function getToolMetricsSummary(input?: {
  tools?: string[];
  hours?: number;
}): Promise<{
  windowHours: number;
  generatedAt: string;
  tools: ToolMetricSummaryRow[];
}> {
  const tools = (input?.tools ?? []).filter(Boolean);
  const hours = Math.min(168, Math.max(1, Math.floor(Number(input?.hours ?? 24) || 24)));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    createdAt: { $gte: since },
  };
  if (tools.length > 0) {
    filter.tool = { $in: tools };
  }

  const rows = await ToolMetric.find(filter)
    .sort({ createdAt: -1 })
    .select({ tool: 1, success: 1, latencyMs: 1 })
    .lean<Array<{ tool: string; success: boolean; latencyMs: number }>>()
    .exec();

  const byTool = new Map<string, Array<{ success: boolean; latencyMs: number }>>();
  for (const row of rows) {
    if (!byTool.has(row.tool)) byTool.set(row.tool, []);
    byTool.get(row.tool)?.push({
      success: Boolean(row.success),
      latencyMs: Math.max(0, Number(row.latencyMs ?? 0)),
    });
  }

  const summary: ToolMetricSummaryRow[] = [...byTool.entries()].map(([tool, entries]) => {
    const total = entries.length;
    const successCount = entries.filter((entry) => entry.success).length;
    const successRate = total > 0 ? successCount / total : 0;
    const sortedLatency = entries.map((entry) => entry.latencyMs).sort((a, b) => a - b);
    const avgLatencyMs =
      total > 0
        ? Math.round(sortedLatency.reduce((sum, current) => sum + current, 0) / total)
        : 0;
    const p95Index = total > 0 ? Math.min(total - 1, Math.floor(total * 0.95)) : 0;
    const p95LatencyMs = total > 0 ? sortedLatency[p95Index] : 0;
    return {
      tool,
      total,
      successCount,
      successRate,
      avgLatencyMs,
      p95LatencyMs,
    };
  });

  return {
    windowHours: hours,
    generatedAt: new Date().toISOString(),
    tools: summary.sort((a, b) => a.tool.localeCompare(b.tool)),
  };
}
