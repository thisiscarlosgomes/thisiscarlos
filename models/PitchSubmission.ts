import { Model, Schema, model, models } from "mongoose";

export interface PitchSubmissionDocument {
  name: string;
  email: string;
  projectName: string;
  details: string;
  websiteUrl: string;
  xUrl: string | null;
  raiseAmountUsd: number;
  valuationUsd: number;
  status: "new" | "reviewing" | "contacted" | "archived";
  source: "web_p";
  createdAt: Date;
  updatedAt: Date;
}

const pitchSubmissionSchema = new Schema<PitchSubmissionDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 220, index: true },
    projectName: { type: String, required: true, trim: true, maxlength: 160, index: true },
    details: { type: String, required: true, trim: true, maxlength: 3000 },
    websiteUrl: { type: String, required: true, trim: true, maxlength: 300 },
    xUrl: { type: String, default: null, trim: true, maxlength: 300 },
    raiseAmountUsd: { type: Number, required: true, min: 0 },
    valuationUsd: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["new", "reviewing", "contacted", "archived"], default: "new", index: true },
    source: { type: String, enum: ["web_p"], required: true, default: "web_p", index: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

pitchSubmissionSchema.index({ createdAt: -1 });
pitchSubmissionSchema.index({ email: 1, createdAt: -1 });

export const PitchSubmission: Model<PitchSubmissionDocument> =
  (models.PitchSubmission as Model<PitchSubmissionDocument> | undefined) ??
  model<PitchSubmissionDocument>("PitchSubmission", pitchSubmissionSchema);
