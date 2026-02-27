import { Model, Schema, Types, model, models } from "mongoose";

export interface CallLogDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  callSid?: string | null;
  summary: string;
  durationSeconds: number;
  topic: string | null;
  intent: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  resolved: boolean | null;
  billingMode: "free-daily" | "paid" | "unknown";
  summarySource: string;
  summaryErrorReason: string | null;
  summaryRetryNeeded: boolean;
  summaryRetryCount: number;
  summaryRetryScheduledAt: Date | null;
  summaryRetryLastError: string | null;
  summaryTranscriptPreview: string | null;
  memoryFitScore: number | null;
  memoryMismatchReason: string | null;
  memoryBestBeliefId: Types.ObjectId | null;
  memoryEvaluatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const callLogSchema = new Schema<CallLogDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    callSid: { type: String, default: null, index: true },
    summary: { type: String, required: true, trim: true, maxlength: 300 },
    durationSeconds: { type: Number, required: true, min: 0 },
    topic: { type: String, default: null, trim: true, maxlength: 120 },
    intent: { type: String, default: null, trim: true, maxlength: 120 },
    sentiment: { type: String, enum: ["positive", "neutral", "negative"], default: null },
    resolved: { type: Boolean, default: null },
    billingMode: { type: String, enum: ["free-daily", "paid", "unknown"], default: "unknown" },
    summarySource: { type: String, default: "unknown", trim: true, maxlength: 64 },
    summaryErrorReason: { type: String, default: null, trim: true, maxlength: 160 },
    summaryRetryNeeded: { type: Boolean, default: false, index: true },
    summaryRetryCount: { type: Number, default: 0, min: 0 },
    summaryRetryScheduledAt: { type: Date, default: null, index: true },
    summaryRetryLastError: { type: String, default: null, trim: true, maxlength: 160 },
    summaryTranscriptPreview: { type: String, default: null, trim: true, maxlength: 3000 },
    memoryFitScore: { type: Number, default: null, min: 0, max: 1 },
    memoryMismatchReason: { type: String, default: null, trim: true, maxlength: 240 },
    memoryBestBeliefId: { type: Schema.Types.ObjectId, ref: "Belief", default: null },
    memoryEvaluatedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

callLogSchema.index({ userId: 1, createdAt: -1 });
callLogSchema.index(
  { callSid: 1 },
  { unique: true, partialFilterExpression: { callSid: { $type: "string" } } }
);

export const CallLog: Model<CallLogDocument> =
  (models.CallLog as Model<CallLogDocument> | undefined) ??
  model<CallLogDocument>("CallLog", callLogSchema);
