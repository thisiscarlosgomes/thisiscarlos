import { Model, Schema, model, models } from "mongoose";

export interface ToolMetricDocument {
  tool: string;
  statusCode: number;
  success: boolean;
  latencyMs: number;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const toolMetricSchema = new Schema<ToolMetricDocument>(
  {
    tool: { type: String, required: true, trim: true, maxlength: 120, index: true },
    statusCode: { type: Number, required: true, min: 100, max: 599 },
    success: { type: Boolean, required: true, index: true },
    latencyMs: { type: Number, required: true, min: 0 },
    errorCode: { type: String, default: null, trim: true, maxlength: 120 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

toolMetricSchema.index({ tool: 1, createdAt: -1 });

export const ToolMetric: Model<ToolMetricDocument> =
  (models.ToolMetric as Model<ToolMetricDocument> | undefined) ??
  model<ToolMetricDocument>("ToolMetric", toolMetricSchema);
