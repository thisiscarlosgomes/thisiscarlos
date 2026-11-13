// Run against the local dev server only. Uses and cleans up an isolated database.
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseEnv } from "node:util";
import mongoose from "mongoose";
const env = parseEnv(fs.readFileSync(".env.local", "utf8"));
assert.equal(
  new URL(env.MONGODB_URI).pathname,
  "/thisiscarlos_blog_dev",
  "Refusing to test outside the isolated development database",
);
const base = "http://localhost:3000";
let cookie = "";
const ids = [];
const mediaIds = [];
async function request(path, method = "GET", body, expected = 200, extra = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body && !(body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...extra,
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  assert.equal(
    res.status,
    expected,
    `${method} ${path}: expected ${expected}, got ${res.status}`,
  );
  return res;
}
try {
  await request("/api/blog/posts", "GET", undefined, 401);
  await request("/api/blog/posts", "POST", {}, 401);
  await request("/api/blog/media", "POST", {}, 401);
  await request("/admin", "GET", undefined, 307);
  const login = await request("/api/voice-notes/auth", "POST", {
    password: env.VOICE_NOTES_OWNER_PASSWORD,
  });
  cookie = login.headers.get("set-cookie").split(";")[0];
  await request("/admin");
  await request("/api/blog/posts", "POST", {}, 400);
  await request("/api/blog/posts", "POST", {}, 403, {
    origin: "https://untrusted.invalid",
  });
  const draft = {
    title: "Blog verification",
    slug: `blog-verification-${Date.now()}`,
    excerpt: "A temporary verification post.",
    markdown: "## Hello\n\n**Markdown works.**\n\n<script>alert(1)</script>",
    coverImage: "",
    published: false,
  };
  let post = await (
    await request("/api/blog/posts", "POST", draft, 201)
  ).json();
  ids.push(post._id);
  await request(`/blog/${draft.slug}`, "GET", undefined, 404);
  assert.ok(
    !(await (await request("/sitemap.xml")).text()).includes(draft.slug),
  );
  await request("/api/blog/posts", "POST", draft, 409);
  const form = new FormData();
  form.append(
    "file",
    new Blob([fs.readFileSync("public/punk.png")], { type: "image/png" }),
    "test.png",
  );
  const media = await (
    await request("/api/blog/media", "POST", form, 201)
  ).json();
  mediaIds.push(media.url.split("/").pop());
  const audioForm = new FormData();
  const wav = Buffer.alloc(48);
  wav.write("RIFF");
  wav.writeUInt32LE(40, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4, 40);
  audioForm.append("file", new Blob([wav], { type: "audio/wav" }), "test.wav");
  const audio = await (
    await request("/api/blog/media", "POST", audioForm, 201)
  ).json();
  mediaIds.push(audio.url.split("/").pop());
  const invalid = new FormData();
  invalid.append(
    "file",
    new Blob(["<svg/>"], { type: "image/svg+xml" }),
    "test.svg",
  );
  await request("/api/blog/media", "POST", invalid, 400);
  post = await (
    await request(`/api/blog/posts/${post._id}`, "PUT", {
      ...draft,
      published: true,
      coverImage: media.url,
      coverCaption: "Cover caption test",
      markdown: `${draft.markdown}\n\n![Test image](${media.url} "Article caption test")\n\n[Listen](${audio.url} "audio")`,
    })
  ).json();
  assert.equal(post.coverCaption, "Cover caption test");
  const html = await (await request(`/blog/${draft.slug}`)).text();
  for (const text of [
    "Cover caption test",
    "Article caption test",
    "og:type",
    "article",
    "application/ld+json",
    "BlogPosting",
    `https://carlos.cv/blog/${draft.slug}`,
    "<audio",
    "<strong>Markdown works.</strong>",
  ])
    assert.ok(html.includes(text), `Missing rendered output: ${text}`);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(
    (await (await request("/sitemap.xml")).text()).includes(draft.slug),
  );
  assert.ok((await (await request("/blog")).text()).includes(draft.title.toLowerCase()));
  await request(
    `/api/blog/posts/${post._id}`,
    "PUT",
    { ...post, slug: `${draft.slug}-renamed` },
    200,
  );
  const moved = await request(`/blog/${draft.slug}`, "GET", undefined, 308);
  assert.equal(moved.headers.get("location"), `/blog/${draft.slug}-renamed`);
  await request(`/blog/${draft.slug}-renamed`);
  const range = await request(audio.url, "GET", undefined, 206, {
    range: "bytes=0-9",
  });
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  await request(audio.url, "GET", undefined, 416, { range: "bytes=999999-" });
  await request(`/api/blog/posts/${post._id}`, "PUT", {
    ...post,
    published: false,
  });
  await request(`/blog/${draft.slug}`, "GET", undefined, 404);
  assert.ok(
    !(await (await request("/sitemap.xml")).text()).includes(draft.slug),
  );
  console.log(
    "PASS: authentication, origin checks, validation, draft privacy, duplicate slugs, uploads, media ranges, publication, Markdown safety, SEO, sitemap, stable links and unpublishing.",
  );
} finally {
  await mongoose.connect(env.MONGODB_URI);
  if (ids.length)
    await mongoose.connection
      .collection("blogposts")
      .deleteMany({
        _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
      });
  if (mediaIds.length)
    await mongoose.connection
      .collection("blogmedias")
      .deleteMany({
        _id: { $in: mediaIds.map((id) => new mongoose.Types.ObjectId(id)) },
      });
  await mongoose.disconnect();
  console.log("Temporary verification posts and uploads cleaned up.");
}
