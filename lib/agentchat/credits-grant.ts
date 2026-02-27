import { addCredits } from "@/lib/agentchat/store";
import { connectToDatabase } from "@/lib/db";
import { CreditGrant } from "@/models/CreditGrant";

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === 11000;
}

export async function grantCreditsForCheckoutSession(input: {
  sessionId: string;
  userId: string;
  credits: number;
}): Promise<{ granted: boolean }> {
  const sessionId = input.sessionId.trim();
  const userId = input.userId.trim();
  const credits = Math.floor(Number(input.credits ?? 0));

  if (!sessionId || !userId || !Number.isFinite(credits) || credits <= 0) {
    return { granted: false };
  }

  await connectToDatabase();

  try {
    await CreditGrant.updateOne(
      { sessionId },
      {
        $setOnInsert: {
          sessionId,
          userId,
          credits,
          state: "pending",
          appliedAt: null,
        },
      },
      { upsert: true }
    ).exec();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const claim = await CreditGrant.updateOne(
    {
      sessionId,
      $or: [{ state: "pending" }, { state: { $exists: false } }],
    },
    { $set: { state: "processing", userId, credits } }
  ).exec();

  if (!claim.modifiedCount) {
    return { granted: false };
  }

  try {
    await addCredits(userId, credits);
    await CreditGrant.updateOne(
      { sessionId, state: "processing" },
      { $set: { state: "applied", appliedAt: new Date() } }
    ).exec();
    return { granted: true };
  } catch (error) {
    await CreditGrant.updateOne(
      { sessionId, state: "processing" },
      { $set: { state: "pending" } }
    ).exec();
    throw error;
  }
}
