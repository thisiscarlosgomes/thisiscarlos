import { Model, Schema, model, models } from "mongoose";
interface BlogMediaDocument {
  data: Buffer;
  mimeType: string;
  name: string;
}
const schema = new Schema<BlogMediaDocument>(
  {
    data: { type: Buffer, required: true },
    mimeType: { type: String, required: true },
    name: { type: String, required: true },
  },
  { timestamps: true },
);
export const BlogMedia: Model<BlogMediaDocument> =
  (models.BlogMedia as Model<BlogMediaDocument>) || model("BlogMedia", schema);
