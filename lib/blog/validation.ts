export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160)
    .replace(/-$/, "");
}
export function validMediaUrl(value: string) {
  if (/^\/api\/blog\/media\/[a-f0-9]{24}$/.test(value)) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
export function validatePost(body: Record<string, unknown>) {
  const title = typeof body.title === "string" ? body.title.trim().toLowerCase() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const excerpt = typeof body.excerpt === "string" ? body.excerpt.trim() : "";
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  const coverImage =
    typeof body.coverImage === "string" ? body.coverImage.trim() : "";
  const coverCaption = typeof body.coverCaption === "string" ? body.coverCaption.trim() : "";
  if (coverCaption.length > 500) throw new Error("Keep the cover caption under 500 characters.");
  if (!title || title.length > 180)
    throw new Error("Add a title (up to 180 characters).");
  if (!slug || slug.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error("Use lowercase letters, numbers and hyphens for the URL.");
  if (excerpt.length > 320 || markdown.length > 200000)
    throw new Error("The description or post is too long.");
  if (coverImage && !validMediaUrl(coverImage))
    throw new Error("Use an HTTPS image URL or an uploaded image.");
  if (typeof body.published !== "boolean")
    throw new Error("Invalid publishing status.");
  if (body.published && !markdown.trim())
    throw new Error("Write some content before publishing.");
  return {
    title,
    slug,
    excerpt,
    markdown,
    coverImage,
    coverCaption,
    published: body.published,
  };
}
