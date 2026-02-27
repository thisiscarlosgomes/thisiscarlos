import { connectToDatabase } from "@/lib/db";
import type { MemoryMode } from "@/lib/agentchat/store";
import { CallLog } from "@/models/CallLog";
import { User } from "@/models/User";

const DEFAULT_CALL_SUMMARY = "Voice call with Carlos AI";

function hasCoachSignal(text: string): boolean {
  return /\b(goal|stuck|improve|plan|feedback|discipline|habit|accountability|help me)\b/i.test(text);
}

function hasBuilderSignal(text: string): boolean {
  return /\b(build|ship|code|stack|api|architecture|product|deploy|bug|tech)\b/i.test(text);
}

function pickWeightedMode(input: { coachBoost: boolean; builderBoost: boolean }): MemoryMode {
  const utcHour = new Date().getUTCHours();
  const builderHours = utcHour >= 13 && utcHour <= 22;

  let casualWeight = 0.7;
  let coachWeight = input.coachBoost ? 0.2 : 0.1;
  let builderWeight = input.builderBoost ? 0.2 : builderHours ? 0.2 : 0.1;

  // Normalize to 1.0 while preserving "mostly casual".
  const total = casualWeight + coachWeight + builderWeight;
  casualWeight /= total;
  coachWeight /= total;
  builderWeight /= total;

  const r = Math.random();
  if (r < casualWeight) return "casual";
  if (r < casualWeight + coachWeight) return "coach";
  return "builder";
}

export async function resolveMemoryModeForCall(input: {
  callerPhone: string;
  userId?: string | null;
}): Promise<MemoryMode> {
  await connectToDatabase();
  const user = await User.findOne({ phoneNumber: input.callerPhone })
    .select({ _id: 1 })
    .lean<{ _id?: unknown } | null>()
    .exec();

  if (!user?._id) {
    return pickWeightedMode({ coachBoost: false, builderBoost: false });
  }

  const lastCall = await CallLog.findOne({ userId: user._id })
    .where("summary")
    .ne(DEFAULT_CALL_SUMMARY)
    .sort({ createdAt: -1 })
    .select({ summary: 1 })
    .lean<{ summary?: string } | null>()
    .exec();

  const summary = String(lastCall?.summary ?? "");
  return pickWeightedMode({
    coachBoost: hasCoachSignal(summary),
    builderBoost: hasBuilderSignal(summary),
  });
}
