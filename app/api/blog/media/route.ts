import { connectToDatabase } from "@/lib/db";
import { BlogMedia } from "@/models/BlogMedia";
import { authorizeBlog, blogError } from "@/lib/blog/api";
const TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/aac",
  "audio/x-m4a",
]);
export async function POST(req: Request) {
  const denied = authorizeBlog(req);
  if (denied) return denied;
  if (Number(req.headers.get("content-length")) > 4 * 1024 * 1024 + 16384)
    return Response.json(
      {
        error:
          "Uploads must be 4 MB or smaller. Use a hosted HTTPS link for larger audio.",
      },
      { status: 413 },
    );
  try {
    const form = await req.formData();
    const file = form.get("file");
    const mimeType =
      file instanceof File &&
      /\.mp3$/i.test(file.name) &&
      ["", "application/octet-stream", "audio/mp3", "audio/x-mp3"].includes(
        file.type,
      )
        ? "audio/mpeg"
        : file instanceof File
          ? file.type
          : "";
    if (!(file instanceof File) || !TYPES.has(mimeType))
      return Response.json(
        {
          error:
            "Choose a JPG, PNG, WebP, GIF, MP3, M4A, WAV, OGG, AAC or WebM file.",
        },
        { status: 400 },
      );
    if (!file.size || file.size > 4 * 1024 * 1024)
      return Response.json(
        {
          error:
            "Uploads must be between 1 byte and 4 MB. Use a hosted HTTPS link for larger audio.",
        },
        { status: 413 },
      );
    await connectToDatabase();
    const media = await BlogMedia.create({
      name: file.name.slice(0, 200),
      mimeType,
      data: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json(
      { url: `/api/blog/media/${media._id}`, type: mimeType },
      { status: 201 },
    );
  } catch (e) {
    return blogError(e);
  }
}
