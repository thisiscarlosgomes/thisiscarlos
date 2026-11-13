import { Schema, model, models } from "mongoose";
const schema = new Schema({
  path: { type: String, required: true },
  visitor: { type: String, required: true },
  bucket: { type: Number, required: true },
  referrer: { type: String, default: "direct" },
  createdAt: { type: Date, default: Date.now },
});
schema.index({ path: 1, visitor: 1, bucket: 1 }, { unique: true });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });
export const BlogView = models.BlogView || model("BlogView", schema);
