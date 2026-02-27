import { Model, Schema, model, models } from "mongoose";

export interface CreditGrantDocument {
  sessionId: string;
  userId: string;
  credits: number;
  state: "pending" | "processing" | "applied";
  appliedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const creditGrantSchema = new Schema<CreditGrantDocument>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    credits: { type: Number, required: true, min: 1 },
    state: {
      type: String,
      required: true,
      enum: ["pending", "processing", "applied"],
      default: "pending",
      index: true,
    },
    appliedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const CreditGrant: Model<CreditGrantDocument> =
  (models.CreditGrant as Model<CreditGrantDocument> | undefined) ??
  model<CreditGrantDocument>("CreditGrant", creditGrantSchema);
