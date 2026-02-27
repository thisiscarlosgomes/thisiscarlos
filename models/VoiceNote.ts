import { Model, Schema, model, models } from "mongoose";

export interface VoiceNoteDocument {
  ownerId: string;
  audioMimeType: string;
  audioData: Buffer;
  durationSeconds: number;
  transcript: string;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
}

const voiceNoteSchema = new Schema<VoiceNoteDocument>(
  {
    ownerId: { type: String, required: true, index: true },
    audioMimeType: { type: String, required: true, trim: true, maxlength: 120 },
    audioData: { type: Buffer, required: true },
    durationSeconds: { type: Number, required: true, min: 0, default: 0 },
    transcript: { type: String, required: true, trim: true, maxlength: 20000 },
    summary: { type: String, required: true, trim: true, maxlength: 300 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

voiceNoteSchema.index({ ownerId: 1, createdAt: -1 });

export const VoiceNote: Model<VoiceNoteDocument> =
  (models.VoiceNote as Model<VoiceNoteDocument> | undefined) ??
  model<VoiceNoteDocument>("VoiceNote", voiceNoteSchema);
