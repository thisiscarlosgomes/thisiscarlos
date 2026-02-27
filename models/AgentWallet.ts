import { Model, Schema, model, models } from "mongoose";

export interface AgentWalletDocument {
  userId: string;
  pin: string;
  credits: number;
  memoryMode: "casual" | "coach" | "builder";
  createdAt: Date;
  updatedAt: Date;
}

const agentWalletSchema = new Schema<AgentWalletDocument>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    pin: { type: String, required: true, unique: true, index: true },
    credits: { type: Number, required: true, default: 0, min: 0 },
    memoryMode: { type: String, enum: ["casual", "coach", "builder"], required: true, default: "casual" },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const AgentWallet: Model<AgentWalletDocument> =
  (models.AgentWallet as Model<AgentWalletDocument> | undefined) ??
  model<AgentWalletDocument>("AgentWallet", agentWalletSchema);
