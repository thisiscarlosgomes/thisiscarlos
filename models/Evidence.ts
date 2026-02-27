import { Model, Schema, Types, model, models } from "mongoose";

type EvidenceStance = "supports" | "challenges" | "neutral";

export interface EvidenceDocument {
  _id: Types.ObjectId;
  beliefId: Types.ObjectId | null;
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string | null;
  summary: string;
  excerpt: string;
  stance: EvidenceStance;
  qualityScore: number;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const evidenceSchema = new Schema<EvidenceDocument>(
  {
    beliefId: { type: Schema.Types.ObjectId, ref: "Belief", default: null, index: true },
    url: { type: String, required: true, trim: true, maxlength: 2000 },
    normalizedUrl: { type: String, required: true, trim: true, maxlength: 2000, index: true },
    domain: { type: String, required: true, trim: true, maxlength: 120, index: true },
    title: { type: String, default: null, trim: true, maxlength: 300 },
    summary: { type: String, required: true, trim: true, maxlength: 500 },
    excerpt: { type: String, required: true, trim: true, maxlength: 1200 },
    stance: {
      type: String,
      enum: ["supports", "challenges", "neutral"],
      required: true,
      default: "neutral",
      index: true,
    },
    qualityScore: { type: Number, required: true, min: 0, max: 1, default: 0.5 },
    fetchedAt: { type: Date, required: true, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

evidenceSchema.index({ beliefId: 1, createdAt: -1 });
evidenceSchema.index({ normalizedUrl: 1, beliefId: 1 });

export const Evidence: Model<EvidenceDocument> =
  (models.Evidence as Model<EvidenceDocument> | undefined) ??
  model<EvidenceDocument>("Evidence", evidenceSchema);
