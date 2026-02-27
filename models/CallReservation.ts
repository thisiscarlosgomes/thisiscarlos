import { Model, Schema, model, models } from "mongoose";

export interface CallReservationDocument {
  callSid: string;
  userId: string;
  callerPhone: string | null;
  reservedMinutes: number;
  reservedCredits: number;
  maxDurationSeconds: number;
  billingMode: "paid" | "free-daily";
  freeDateKey: string | null;
  billableStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const callReservationSchema = new Schema<CallReservationDocument>(
  {
    callSid: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    callerPhone: { type: String, default: null, index: true },
    reservedMinutes: { type: Number, required: true, min: 1 },
    reservedCredits: { type: Number, required: true, min: 0, default: 0 },
    maxDurationSeconds: { type: Number, required: true, min: 1 },
    billingMode: { type: String, enum: ["paid", "free-daily"], required: true, index: true },
    freeDateKey: { type: String, default: null, index: true },
    billableStartedAt: { type: Date, default: null, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const CallReservation: Model<CallReservationDocument> =
  (models.CallReservation as Model<CallReservationDocument> | undefined) ??
  model<CallReservationDocument>("CallReservation", callReservationSchema);
