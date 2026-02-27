import { Model, Schema, Types, model, models } from "mongoose";

type BeliefStatus = "active" | "superseded" | "draft";
type BeliefSourceType = "voice_note" | "call_log" | "manual";

type BeliefSourceRef = {
  sourceType: BeliefSourceType;
  sourceId: string;
  createdAt: Date;
};

export interface BeliefDocument {
  _id: Types.ObjectId;
  topic: string;
  statement: string;
  confidence: number;
  status: BeliefStatus;
  sourceType: BeliefSourceType;
  sourceId: string;
  sourceRefs: BeliefSourceRef[];
  effectiveFrom: Date;
  effectiveTo: Date | null;
  supersedesBeliefId: Types.ObjectId | null;
  evidenceCount: number;
  supportScore: number;
  challengeScore: number;
  confidenceReason: string | null;
  conflict: boolean;
  conflictsWithBeliefId: Types.ObjectId | null;
  changeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const beliefSourceRefSchema = new Schema<BeliefSourceRef>(
  {
    sourceType: {
      type: String,
      enum: ["voice_note", "call_log", "manual"],
      required: true,
    },
    sourceId: { type: String, required: true, trim: true, maxlength: 120 },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const beliefSchema = new Schema<BeliefDocument>(
  {
    topic: { type: String, required: true, trim: true, maxlength: 120, index: true },
    statement: { type: String, required: true, trim: true, maxlength: 500 },
    confidence: { type: Number, required: true, min: 0, max: 1, default: 0.6 },
    status: {
      type: String,
      enum: ["active", "superseded", "draft"],
      required: true,
      default: "active",
      index: true,
    },
    sourceType: {
      type: String,
      enum: ["voice_note", "call_log", "manual"],
      required: true,
    },
    sourceId: { type: String, required: true, trim: true, maxlength: 120 },
    sourceRefs: { type: [beliefSourceRefSchema], default: [] },
    effectiveFrom: { type: Date, required: true, default: Date.now, index: true },
    effectiveTo: { type: Date, default: null },
    supersedesBeliefId: { type: Schema.Types.ObjectId, ref: "Belief", default: null },
    evidenceCount: { type: Number, required: true, min: 0, default: 0 },
    supportScore: { type: Number, required: true, min: 0, default: 0 },
    challengeScore: { type: Number, required: true, min: 0, default: 0 },
    confidenceReason: { type: String, default: null, trim: true, maxlength: 240 },
    conflict: { type: Boolean, required: true, default: false, index: true },
    conflictsWithBeliefId: { type: Schema.Types.ObjectId, ref: "Belief", default: null },
    changeReason: { type: String, default: null, trim: true, maxlength: 240 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

beliefSchema.index({ topic: 1, status: 1, effectiveFrom: -1 });
beliefSchema.index({ status: 1, updatedAt: -1 });
beliefSchema.index({ conflict: 1, updatedAt: -1 });

export const Belief: Model<BeliefDocument> =
  (models.Belief as Model<BeliefDocument> | undefined) ??
  model<BeliefDocument>("Belief", beliefSchema);
