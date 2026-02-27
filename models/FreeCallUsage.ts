import { Model, Schema, model, models } from "mongoose";

export interface FreeCallUsageDocument {
  dateKey: string;
  confirmedCount: number;
  inFlightCount: number;
  confirmedSeconds: number;
  inFlightReservedSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

const freeCallUsageSchema = new Schema<FreeCallUsageDocument>(
  {
    dateKey: { type: String, required: true, unique: true, index: true },
    confirmedCount: { type: Number, required: true, default: 0, min: 0 },
    inFlightCount: { type: Number, required: true, default: 0, min: 0 },
    confirmedSeconds: { type: Number, required: true, default: 0, min: 0 },
    inFlightReservedSeconds: { type: Number, required: true, default: 0, min: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const FreeCallUsage: Model<FreeCallUsageDocument> =
  (models.FreeCallUsage as Model<FreeCallUsageDocument> | undefined) ??
  model<FreeCallUsageDocument>("FreeCallUsage", freeCallUsageSchema);
