import { Model, Schema, model, models } from "mongoose";

export interface BlogPostDocument {
  title: string;
  slug: string;
  previousSlugs: string[];
  excerpt: string;
  markdown: string;
  coverImage: string;
  coverCaption: string;
  audioVersion?: { url: string; voice: string; voiceId: string; model: string; hash: string; generatedAt: Date };
  published: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const schema = new Schema<BlogPostDocument>(
  {
    title: { type: String, required: true, maxlength: 180 },
    slug: { type: String, required: true, unique: true, maxlength: 160 },
    previousSlugs: { type: [String], default: [] },
    excerpt: { type: String, default: "", maxlength: 320 },
    markdown: { type: String, default: "", maxlength: 200000 },
    coverImage: { type: String, default: "", maxlength: 2000 },
    coverCaption: { type: String, default: "", maxlength: 500 },
    audioVersion: { type: new Schema({ url: String, voice: String, voiceId: String, model: String, hash: String, generatedAt: Date }, { _id: false }), default: undefined },
    published: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
schema.index({ published: 1, publishedAt: -1 });
export const BlogPost: Model<BlogPostDocument> =
  (models.BlogPost as Model<BlogPostDocument>) || model("BlogPost", schema);
