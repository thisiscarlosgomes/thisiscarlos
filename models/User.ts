import { Model, Schema, Types, model, models } from "mongoose";

export interface UserDocument {
  _id: Types.ObjectId;
  firstName: string | null;
  phoneNumber: string;
  callCredits: number;
  walletUserId: string | null;
  totalCalls: number;
  totalCallSeconds: number;
  lastCallAt: Date | null;
  lastCallSummary: string | null;
  lastSeenAt: Date | null;
  tags: string[];
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    firstName: { type: String, default: null, trim: true, maxlength: 120 },
    phoneNumber: { type: String, required: true, unique: true, index: true },
    callCredits: { type: Number, required: true, default: 0, min: 0 },
    walletUserId: { type: String, default: null, index: true },
    totalCalls: { type: Number, required: true, default: 0, min: 0 },
    totalCallSeconds: { type: Number, required: true, default: 0, min: 0 },
    lastCallAt: { type: Date, default: null },
    lastCallSummary: { type: String, default: null, trim: true, maxlength: 300 },
    lastSeenAt: { type: Date, default: null },
    tags: { type: [String], default: [] },
    notes: { type: String, default: null, trim: true, maxlength: 500 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const User: Model<UserDocument> =
  (models.User as Model<UserDocument> | undefined) ?? model<UserDocument>("User", userSchema);
