import { Model, Schema, Types, model, models } from "mongoose";

type BeliefStatus = "active" | "superseded" | "draft";
type BeliefSourceType = "voice_note" | "call_log" | "manual";
type BeliefEventType =
  | "created"
  | "updated"
  | "approved"
  | "activated"
  | "superseded"
  | "archived"
  | "merged"
  | "conflict_detected";

export interface BeliefVersionDocument {
  _id: Types.ObjectId;
  beliefId: Types.ObjectId;
  topic: string;
  statement: string;
  status: BeliefStatus;
  confidence: number;
  sourceType: BeliefSourceType;
  sourceId: string;
  eventType: BeliefEventType;
  reason: string | null;
  previousBeliefId: Types.ObjectId | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const beliefVersionSchema = new Schema<BeliefVersionDocument>(
  {
    beliefId: { type: Schema.Types.ObjectId, ref: "Belief", required: true, index: true },
    topic: { type: String, required: true, trim: true, maxlength: 120, index: true },
    statement: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ["active", "superseded", "draft"], required: true, index: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    sourceType: { type: String, enum: ["voice_note", "call_log", "manual"], required: true },
    sourceId: { type: String, required: true, trim: true, maxlength: 120 },
    eventType: {
      type: String,
      enum: ["created", "updated", "approved", "activated", "superseded", "archived", "merged", "conflict_detected"],
      required: true,
      index: true,
    },
    reason: { type: String, default: null, trim: true, maxlength: 240 },
    previousBeliefId: { type: Schema.Types.ObjectId, ref: "Belief", default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

beliefVersionSchema.index({ beliefId: 1, createdAt: -1 });
beliefVersionSchema.index({ topic: 1, createdAt: -1 });

export const BeliefVersion: Model<BeliefVersionDocument> =
  (models.BeliefVersion as Model<BeliefVersionDocument> | undefined) ??
  model<BeliefVersionDocument>("BeliefVersion", beliefVersionSchema);
