"use client";
import Link from "next/link";
import {
  PanelLeft,
  SlidersHorizontal,
  Plus,
  Image as ImageIcon,
  AudioLines,
  X,
  Eye,
  FileText,
  Focus,
  Search,
  Save,
  Check,
  Upload,
  Undo2,
  Redo2,
} from "lucide-react";
import { MarkdownInput } from "./markdown-input";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { BlogMarkdown } from "@/app/components/blog/markdown";
import { slugify, validMediaUrl } from "@/lib/blog/validation";

type Post = {
  _id?: string;
  title: string;
  slug: string;
  excerpt: string;
  markdown: string;
  coverImage: string;
  coverCaption?: string;
  published: boolean;
  publishedAt?: string | null;
};
type History = { past: Post[]; present: Post; future: Post[] };
type HistoryAction =
  | { type: "edit"; value: Post | ((post: Post) => Post) }
  | { type: "reset"; value: Post }
  | { type: "undo" }
  | { type: "redo" };
function postHistory(state: History, action: HistoryAction): History {
  if (action.type === "reset") return { past: [], present: action.value, future: [] };
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
  }
  const next = typeof action.value === "function" ? action.value(state.present) : action.value;
  if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
  return { past: [...state.past.slice(-99), state.present], present: next, future: [] };
}
const empty = (): Post => ({
  title: "",
  slug: "",
  excerpt: "",
  markdown: "",
  coverImage: "",
  coverCaption: "",
  published: false,
});
const field =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 disabled:bg-zinc-50";
const button =
  "rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-40";
export function BlogEditor() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [history, dispatch] = useReducer(postHistory, undefined, () => ({ past: [], present: empty(), future: [] }));
  const post = history.present;
  function setPost(value: Post | ((post: Post) => Post)) {
    dispatch({ type: "edit", value });
  }
  const [baseline, setBaseline] = useState(JSON.stringify(empty()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [mediaKind, setMediaKind] = useState<
    "image" | "audio" | "cover" | null
  >(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");
  const [mediaLabel, setMediaLabel] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadPreview, setUploadPreview] = useState("");
  const [mediaError, setMediaError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);
  useEffect(() => () => uploadRequest.current?.abort(), []);
  useEffect(() => () => {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
  }, [uploadPreview]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mediaPosition = useRef<number | null>(null);
  function openMedia(kind: "image" | "audio" | "cover") {
    // Media is inserted after a selection, never in place of the selected prose.
    mediaPosition.current = textarea.current?.selectionEnd ?? null;
    setMediaKind(kind);
    setMediaCaption(kind === "cover" ? post.coverCaption || "" : "");
    setDragging(false);
    setMediaError("");
    setUploadProgress(null);
    setUploadName("");
    setUploadPreview("");
    setMediaUrl("");
    setMediaLabel("");
  }
  const dirty = JSON.stringify(post) !== baseline;
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1279px)");
    let cleanup = () => {};
    function sync() {
      cleanup();
      cleanup = () => {};
      const name = helpOpen ? "Markdown help" : mediaKind
        ? "Add media"
        : !focusMode && query.matches
          ? settingsOpen
            ? "Post settings panel"
            : sidebarOpen
              ? "Post library"
              : null
          : null;
      if (!name) return;
      const panel = document.querySelector<HTMLElement>(
        `[aria-label="${name}"]`,
      );
      if (!panel) return;
      const previous = document.activeElement as HTMLElement | null;
      const overflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const controls = () =>
        Array.from(
          panel.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], select:not(:disabled)",
          ),
        ).filter((el) => el.getClientRects().length);
      controls()[0]?.focus();
      const trap = (event: KeyboardEvent) => {
        if (event.key !== "Tab") return;
        const items = controls();
        const first = items[0];
        const last = items.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !panel.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !panel.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", trap);
      cleanup = () => {
        document.body.style.overflow = overflow;
        document.removeEventListener("keydown", trap);
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      };
    }
    sync();
    query.addEventListener("change", sync);
    return () => {
      cleanup();
      query.removeEventListener("change", sync);
    };
  }, [sidebarOpen, settingsOpen, mediaKind, focusMode, helpOpen]);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHelpOpen(false);
      setInsertOpen(false);
      setSettingsOpen(false);
      setSidebarOpen(false);
      if (!busy) setMediaKind(null);
      setFocusMode(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [busy]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/blog/posts");
      if (res.status === 401) {
        window.location.href = "/lg?next=/admin";
        return;
      }
      if (!res.ok)
        throw new Error(
          "Could not load posts. Check the database connection and retry.",
        );
      setPosts(await res.json());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load posts.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function select(next: Post) {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    dispatch({ type: "reset", value: next });
    setBaseline(JSON.stringify(next));
    if (window.matchMedia("(max-width: 1279px)").matches) setSidebarOpen(false);
    setMessage("");
    setPreview(false);
  }
  function update<K extends keyof Post>(key: K, value: Post[K]) {
    setPost((p) => ({ ...p, [key]: value }));
  }
  async function save(published: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(
        post._id ? `/api/blog/posts/${post._id}` : "/api/blog/posts",
        {
          method: post._id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...post, published }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save post.");
      dispatch({ type: "reset", value: data });
      setBaseline(JSON.stringify(data));
      setPosts((list) => [data, ...list.filter((p) => p._id !== data._id)]);
      setMessage(
        published
          ? "Published. Your post is live."
          : "Draft saved. Only you can see it.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save post.");
    } finally {
      setBusy(false);
    }
  }
  function insert(text: string) {
    const start = Math.min(
      mediaPosition.current ?? post.markdown.length,
      post.markdown.length,
    );
    setPost((p) => ({
      ...p,
      markdown: p.markdown.slice(0, start) + text + p.markdown.slice(start),
    }));
    mediaPosition.current = null;
    setPreview(false);
    requestAnimationFrame(() => {
      textarea.current?.focus({ preventScroll: true });
      textarea.current?.setSelectionRange(
        start + text.length,
        start + text.length,
      );
    });
  }
  function addMedia(url: string) {
    if (!validMediaUrl(url)) {
      setMediaError("Use an HTTPS image or audio URL.");
      return;
    }
    const label = (
      mediaLabel || (mediaKind === "audio" ? "Listen" : "Image description")
    ).replace(/[\[\]\\\n]/g, "");
    const caption = mediaCaption.trim().replace(/\r?\n/g, " ");
    if (mediaKind === "cover") setPost((current) => ({ ...current, coverImage: url, coverCaption: mediaCaption.trim() }));
    else
      insert(
        mediaKind === "audio"
          ? `\n\n[${label}](<${url}> "audio")\n\n`
          : `\n\n![${label}](<${url}>${caption ? ` ${JSON.stringify(caption)}` : ""})\n\n`,
      );
    setMediaKind(null);
    setMediaUrl("");
    setMediaLabel("");
  }
  async function upload(file: File) {
    if (uploadRequest.current || busy) return;
    setMediaError("");
    if (!file.size || file.size > 4 * 1024 * 1024) {
      setMediaError("Choose a file under 4 MB, or use a link.");
      return;
    }
    if (mediaKind !== "audio" && !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setMediaError("Choose a JPG, PNG, WebP or GIF image.");
      return;
    }
    if (mediaKind === "audio" && !file.type.startsWith("audio/") && !/\.mp3$/i.test(file.name)) {
      setMediaError("Choose an audio file.");
      return;
    }
    setBusy(true);
    setUploadProgress(0);
    setUploadName(file.name);
    setUploadPreview(mediaKind === "audio" ? "" : URL.createObjectURL(file));
    try {
      const form = new FormData();
      form.append("file", file);
      const url = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadRequest.current = xhr;
        xhr.open("POST", "/api/blog/media");
        xhr.responseType = "json";
        xhr.timeout = 120000;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setUploadProgress(Math.round(event.loaded / event.total * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.url) resolve(xhr.response.url);
          else reject(new Error(xhr.response?.error || "Upload failed. Try again."));
        };
        xhr.onerror = () => reject(new Error("Connection lost. Try again."));
        xhr.ontimeout = () => reject(new Error("Upload timed out. Try again."));
        xhr.onabort = () => reject(new Error("Upload canceled."));
        xhr.send(form);
      });
      addMedia(url);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "Upload failed. Try again.");
    } finally {
      uploadRequest.current = null;
      setUploadProgress(null);
      setBusy(false);
    }
  }
  const words = post.markdown.trim()
    ? post.markdown.trim().split(/\s+/).length
    : 0;
  const visiblePosts = posts.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase()),
  );
  function toggleFocus() {
    setFocusMode((current) => !current);
    setSettingsOpen(false);
    setInsertOpen(false);
  }
  return (
    <main
      className="blog-admin min-h-screen bg-white text-sm normal-case text-zinc-800"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (mediaKind || target.closest('[role="dialog"]') || target.closest('[aria-label="Post library"]')) return;
        const key = event.key.toLowerCase();
        if (!(event.metaKey || event.ctrlKey) || event.altKey || event.nativeEvent.isComposing) return;
        if (key !== "z" && !(event.ctrlKey && key === "y")) return;
        // Keep native undo in temporary inputs such as the link popover.
        if (target instanceof HTMLInputElement && target.id !== "post-title" && target.getAttribute("aria-label") !== "Post URL") return;
        event.preventDefault();
        if (!busy && !loading) dispatch({ type: key === "y" || event.shiftKey ? "redo" : "undo" });
      }}
    >
      <header className="editor-header sticky top-0 z-30 flex items-center justify-between gap-1 border-b border-zinc-100 bg-white/95 px-2 backdrop-blur sm:gap-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <button
            type="button"
            aria-label="Toggle post library"
            aria-expanded={sidebarOpen && !focusMode}
            onClick={() => {
              setFocusMode(false);
              setSidebarOpen(!sidebarOpen);
              setSettingsOpen(false);
            }}
            className="editor-icon"
          >
            <PanelLeft size={17} />
          </button>
          <Link href="/" className="font-medium lowercase">
            carlos
          </Link>
          <span className="hidden text-zinc-300 sm:inline">/</span>
          <span className="hidden text-zinc-500 sm:inline">writing</span>
          <span
            className="hidden items-center gap-1.5 border-l border-zinc-200 pl-3 text-zinc-400 sm:flex"
            role="status"
          >
            {busy ? (
              "saving…"
            ) : dirty ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                unsaved
              </>
            ) : post._id ? (
              <>
                <Check size={13} />
                saved
              </>
            ) : (
              "new draft"
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={focusMode ? "Exit focus mode" : "Focus mode"}
            aria-pressed={focusMode}
            onClick={toggleFocus}
            className={`editor-icon hidden sm:inline-flex ${focusMode ? "bg-zinc-100" : ""}`}
          >
            <Focus size={17} />
          </button>
          <button
            type="button"
            aria-label="Post settings"
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsOpen(!settingsOpen);
              setSidebarOpen(false);
              setFocusMode(false);
            }}
            className={`editor-icon ${settingsOpen ? "bg-zinc-100" : ""}`}
          >
            <SlidersHorizontal size={17} />
          </button>
          <span className="mx-1 hidden h-5 w-px bg-zinc-200 sm:block" />
          {!post.published && (
            <button
              disabled={busy || loading || !dirty}
              aria-label="Save draft"
              className="rounded-lg px-3 py-2 text-zinc-500 hover:bg-zinc-50 disabled:opacity-40"
              onClick={() => save(false)}
            >
              <Save size={16} className="sm:hidden" />
              <span className="hidden sm:inline">save draft</span>
            </button>
          )}
          <button
            disabled={busy || loading}
            onClick={() => save(true)}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {busy ? "saving…" : post.published ? "update" : "publish"}
          </button>
        </div>
      </header>
      {(sidebarOpen || settingsOpen) && !focusMode && (
        <button
          type="button"
          aria-label="Close open panel"
          className="fixed inset-0 z-40 bg-black/25 xl:hidden"
          onClick={() => {
            setSidebarOpen(false);
            setSettingsOpen(false);
          }}
        />
      )}
      {helpOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-3" onClick={() => setHelpOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="Markdown help" onClick={(event) => event.stopPropagation()} className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-medium">markdown help</h2>
              <button aria-label="Close markdown help" className="editor-icon" onClick={() => setHelpOpen(false)}><X size={16} /></button>
            </div>
            <p className="mb-4 text-xs text-zinc-500">⌘ on Mac · Ctrl on Windows</p>
            <dl className="divide-y divide-zinc-100">
              {[
                ["bold", "⌘/Ctrl + B", "**text**"],
                ["italic", "⌘/Ctrl + I", "_text_"],
                ["link", "⌘/Ctrl + K", "[text](url)"],
                ["code", "⌘/Ctrl + E", "`code`"],
                ["strikethrough", "⌘/Ctrl + Shift + X", "~~text~~"],
                ["heading", "⌘/Ctrl + Alt + 1–3", "## heading"],
                ["numbered list", "⌘/Ctrl + Shift + 7", "1. item"],
                ["bullet list", "⌘/Ctrl + Shift + 8", "- item"],
                ["quote", "⌘/Ctrl + Shift + 9", "> quote"],
                ["undo", "⌘/Ctrl + Z", ""],
                ["redo", "⌘/Ctrl + Shift + Z", ""],
              ].map(([label, keys, syntax]) => (
                <div key={label} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <dt>{label}{syntax && <code className="mt-1 block text-xs text-zinc-400">{syntax}</code>}</dt>
                  <dd className="text-xs text-zinc-500">{keys}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs leading-5 text-zinc-500">Select text to format it. List and heading shortcuts also work on the current line. Use insert for images and audio. Add or edit an image caption with <code>{'![alt](url "caption")'}</code>. Paste a tweet URL on its own line to embed it. Type /bot and press Enter, or right-click to insert a bot.</p>
          </section>
        </div>
      )}
      {mediaKind && (
        <button
          type="button"
          aria-label="Dismiss media panel"
          disabled={busy}
          className="fixed inset-0 z-50 bg-black/25"
          onClick={() => setMediaKind(null)}
        />
      )}
      <div className="flex min-h-[calc(100dvh-64px)]">
        {sidebarOpen && !focusMode && (
          <aside
            aria-label="Post library"
            className="editor-drawer fixed left-0 z-50 flex w-80 max-w-[calc(100vw-2rem)] shrink-0 flex-col border-r border-zinc-100 bg-[#fafaf9] px-4 py-5 shadow-lg xl:sticky xl:z-20 xl:w-64 xl:shadow-none"
          >
            <div className="mb-6 flex items-center justify-between">
              <button
                type="button"
                aria-label="Close post library"
                className="editor-icon xl:hidden"
                onClick={() => setSidebarOpen(false)}
              >
                <X size={18} />
              </button>
              <h1 className="font-medium">
                your posts{" "}
                <span className="ml-1 text-zinc-400">{posts.length}</span>
              </h1>
              <button
                type="button"
                aria-label="New post"
                title="New post"
                disabled={busy || loading}
                className="editor-icon"
                onClick={() => select(empty())}
              >
                <Plus size={17} />
              </button>
            </div>
            <label className="mb-5 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-zinc-400">
              <Search size={15} />
              <input
                aria-label="Search posts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="find a post"
                className="min-w-0 w-full bg-transparent text-sm text-zinc-700 outline-none"
              />
            </label>
            <nav
              aria-label="Posts"
              className="min-h-0 flex-1 space-y-1 overflow-y-auto"
            >
              {loading ? (
                <p className="px-2 py-3 text-zinc-400">loading…</p>
              ) : visiblePosts.length ? (
                visiblePosts.map((item) => (
                  <button
                    key={item._id}
                    disabled={busy}
                    onClick={() => {
                      select(item);
                    }}
                    className={`w-full rounded-lg px-3 py-3 text-left transition ${post._id === item._id ? "bg-white shadow-sm ring-1 ring-zinc-200/60" : "hover:bg-zinc-100"}`}
                  >
                    <span className="mb-1.5 flex items-center gap-2 text-zinc-400">
                      <FileText size={14} />
                      <span>{item.published ? "published" : "draft"}</span>
                    </span>
                    <span className="block break-words leading-6 lowercase">
                      {item.title}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-3 leading-6 text-zinc-400">
                  {query
                    ? "no matching posts"
                    : "a little space for your ideas."}
                </p>
              )}
            </nav>
            <div className="mt-6 space-y-3 border-t border-zinc-200/70 pt-5 text-zinc-500">
              <Link href="/blog" className="block hover:text-zinc-900">
                view blog
              </Link>
              <button
                onClick={load}
                disabled={loading || busy}
                className="block hover:text-zinc-900"
              >
                refresh posts
              </button>
              <button
                className="block hover:text-zinc-900"
                onClick={async () => {
                  if (
                    dirty &&
                    !window.confirm("Discard unsaved changes and sign out?")
                  )
                    return;
                  await fetch("/api/voice-notes/auth", { method: "DELETE" });
                  window.location.href = "/lg?next=/admin";
                }}
              >
                sign out
              </button>
            </div>
          </aside>
        )}
        <section className="min-w-0 flex-1">
          <div className="mx-auto max-w-[800px] px-4 pb-12 pt-5 sm:px-10 sm:pt-10">
            <div
              className={`mb-10 flex flex-wrap items-center justify-between gap-3 text-zinc-400 ${focusMode ? "hidden" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${post.published ? "bg-emerald-500" : "bg-zinc-300"}`}
                />
                {post.published ? "published" : "draft"}
                {post.published && (
                  <Link
                    href={`/blog/${post.slug}`}
                    target="_blank"
                    className="ml-3 text-zinc-500 underline underline-offset-4"
                  >
                    view post
                  </Link>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" aria-label="Undo" title="Undo (⌘/Ctrl+Z)" disabled={busy || loading || !history.past.length} onPointerDown={(event) => event.preventDefault()} onClick={() => dispatch({ type: "undo" })} className="editor-icon disabled:opacity-30">
                  <Undo2 size={15} />
                </button>
                <button type="button" aria-label="Redo" title="Redo (⌘/Ctrl+Shift+Z)" disabled={busy || loading || !history.future.length} onPointerDown={(event) => event.preventDefault()} onClick={() => dispatch({ type: "redo" })} className="editor-icon disabled:opacity-30">
                  <Redo2 size={15} />
                </button>
                <button
                  disabled={busy || loading}
                  aria-label={preview ? "Edit Markdown" : "Preview post"}
                  aria-pressed={preview}
                  onClick={() => setPreview(!preview)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-zinc-500 hover:bg-zinc-50"
                >
                  {preview ? <FileText size={15} /> : <Eye size={15} />}
                  {preview ? "write" : "preview"}
                </button>
                <div className="relative">
                  <button
                    disabled={busy || loading}
                    aria-expanded={insertOpen}
                    onClick={() => setInsertOpen(!insertOpen)}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-zinc-500 hover:bg-zinc-50"
                  >
                    <Plus size={15} />
                    insert
                  </button>
                  {insertOpen && (
                    <div className="absolute right-0 top-full z-20 mt-2 w-40 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
                      <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-50" onClick={() => {
                        mediaPosition.current = textarea.current?.selectionEnd ?? null;
                        insert("::bot:: ");
                        setInsertOpen(false);
                      }}>bot</button>
                      {(["image", "audio"] as const).map((kind) => (
                        <button
                          key={kind}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-50"
                          onClick={() => {
                            openMedia(kind);
                            setInsertOpen(false);
                          }}
                        >
                          {kind === "image" ? (
                            <ImageIcon size={16} />
                          ) : (
                            <AudioLines size={16} />
                          )}
                          {kind}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {message && (
              <p
                role="status"
                className="mb-6 rounded-lg bg-zinc-50 px-4 py-3 leading-6"
              >
                {message}
              </p>
            )}
            <fieldset
              disabled={busy || loading}
              className="disabled:opacity-50"
            >
              <label className="sr-only" htmlFor="post-title">
                Title
              </label>
              <input
                id="post-title"
                className="mb-8 block w-full border-0 bg-transparent py-2 text-sm font-semibold lowercase outline-none placeholder:font-normal placeholder:text-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-200"
                maxLength={180}
                value={post.title.toLowerCase()}
                placeholder="untitled"
                onChange={(e) =>
                  setPost((p) => ({
                    ...p,
                    title: e.target.value.toLowerCase(),
                    slug:
                      !p._id && p.slug === slugify(p.title)
                        ? slugify(e.target.value)
                        : p.slug,
                  }))
                }
              />
              {post.coverImage && (
                <figure className="mb-8">
                  <img src={post.coverImage} alt="Cover preview" className="max-h-64 w-full rounded-lg object-cover object-top" />
                  {post.coverCaption && <figcaption className="mt-2 text-center text-sm text-zinc-500">{post.coverCaption}</figcaption>}
                </figure>
              )}
              {preview ? (
                <div className="min-h-[55vh]">
                  {post.markdown ? (
                    <BlogMarkdown>{post.markdown}</BlogMarkdown>
                  ) : (
                    <p className="text-zinc-400">
                      your words will appear here.
                    </p>
                  )}
                </div>
              ) : (
                <MarkdownInput
                  inputRef={textarea}
                  className="block min-h-[55vh] w-full resize-none border-0 bg-transparent p-0 text-sm leading-8 text-zinc-700 outline-none placeholder:text-zinc-400"
                  value={post.markdown}
                  onChange={(value) => update("markdown", value)}
                />
              )}
            </fieldset>
            <footer
              className={`mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-5 text-zinc-400 ${focusMode ? "hidden" : ""}`}
            >
              <span>
                {words} {words === 1 ? "word" : "words"} ·{" "}
                {Math.max(1, Math.ceil(words / 220))} min read
              </span>
              <Link href="/admin/analytics" className="hover:text-zinc-700">analytics</Link>
              <button
                aria-expanded={helpOpen}
                onClick={() => setHelpOpen(!helpOpen)}
                className="hover:text-zinc-700"
              >
                markdown help
              </button>
            </footer>

          </div>
        </section>
        {settingsOpen && !focusMode && (
          <aside
            aria-label="Post settings panel"
            className="editor-drawer fixed right-0 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto border-l border-zinc-100 bg-white p-5 shadow-lg xl:sticky xl:z-20 xl:shrink-0 xl:shadow-none"
          >
            <div className="mb-8 flex items-center justify-between">
              <h2 className="font-medium">post settings</h2>
              <button
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
                className="editor-icon"
              >
                <X size={16} />
              </button>
            </div>
            <fieldset disabled={busy || loading} className="space-y-7">
              <label className="block">
                post url
                <span className="mt-2 block text-zinc-400">
                  carlos.cv/blog/
                </span>
                <input
                  aria-label="Post URL"
                  className={`${field} mt-2`}
                  value={post.slug}
                  maxLength={160}
                  onChange={(e) => update("slug", e.target.value)}
                />
                {post.publishedAt && (
                  <span className="mt-2 block leading-6 text-zinc-400">
                    you can change this URL. Previous links will redirect here.
                  </span>
                )}
              </label>
              <label className="block">
                description
                <textarea
                  aria-label="Description"
                  className={`${field} mt-2 leading-6`}
                  rows={4}
                  value={post.excerpt}
                  maxLength={320}
                  onChange={(e) => update("excerpt", e.target.value)}
                  placeholder="a short introduction for search and sharing"
                />
                <span className="mt-2 block text-zinc-400">
                  {post.excerpt.length}/320
                </span>
              </label>
              <div>
                <h3>cover image</h3>
                <button
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-zinc-500 hover:bg-zinc-50"
                  onClick={() => {
                    openMedia("cover");
                  }}
                >
                  <ImageIcon size={16} />
                  {post.coverImage ? "change image" : "add a cover"}
                </button>
                {post.coverImage && (
                  <button
                    onClick={() => update("coverImage", "")}
                    className="mt-3 text-zinc-500"
                  >
                    remove cover
                  </button>
                )}
                {post.coverImage && <label className="mt-4 block">caption
                  <input className={`${field} mt-2`} value={post.coverCaption || ""} maxLength={500} onChange={(event) => update("coverCaption", event.target.value)} placeholder="optional" />
                </label>}
              </div>
              {post.published && (
                <div className="border-t border-zinc-100 pt-6">
                  <button
                    className={button}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Unpublish this post? Its public page will be unavailable until you publish again.",
                        )
                      )
                        void save(false);
                    }}
                  >
                    unpublish post
                  </button>
                </div>
              )}
            </fieldset>
          </aside>
        )}
      </div>
      {mediaKind && (
        <section
          aria-label="Add media"
          role="dialog"
          aria-modal="true"
          className="editor-media fixed inset-x-3 z-[60] mx-auto max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl sm:p-6"
        >
          <button
            type="button"
            aria-label="Close media panel"
            disabled={busy}
            onClick={() => setMediaKind(null)}
            className="absolute right-4 top-4 rounded p-1 hover:bg-zinc-100"
          >
            <X size={16} />
          </button>
          <h2 className="pr-8 font-medium">
            {mediaKind === "cover" ? "cover image" : mediaKind}
          </h2>
          {mediaKind !== "audio" && <label className="mt-4 block text-sm text-zinc-500">caption
            <input className={`${field} mt-2 text-zinc-800`} disabled={busy} value={mediaCaption} maxLength={500} onChange={(event) => setMediaCaption(event.target.value)} placeholder="optional" />
          </label>}
          <input
            ref={fileInput}
            className="hidden"
            type="file"
            accept={mediaKind === "audio" ? "audio/*,.mp3" : "image/jpeg,image/png,image/webp,image/gif"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label={mediaKind === "audio" ? "Upload audio" : "Upload image"}
            aria-disabled={busy}
            onClick={() => { if (!busy) fileInput.current?.click(); }}
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (busy) return;
              if (event.dataTransfer.files.length !== 1) {
                setMediaError("Drop one file at a time.");
                return;
              }
              void upload(event.dataTransfer.files[0]);
            }}
            className={`mt-5 flex min-h-44 w-full min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${dragging ? "border-zinc-900 bg-zinc-100" : "border-zinc-300 bg-zinc-50 hover:border-zinc-500"}`}
          >
            {uploadPreview ? (
              // Local file previews cannot use the Next.js image optimizer.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={uploadPreview} alt="Selected upload" className="max-h-32 max-w-full rounded-md object-contain" />
            ) : <Upload size={24} strokeWidth={1.5} className="text-zinc-500" />}
            <span className="text-sm">{uploadProgress !== null ? "uploading…" : dragging ? "drop to upload" : "drop a file or browse"}</span>
            <span className="max-w-full truncate text-xs text-zinc-500">{uploadName || (mediaKind === "audio" ? "audio · up to 4 MB" : "JPG, PNG, WebP, GIF · up to 4 MB")}</span>
          </button>
          {uploadProgress !== null && (
            <div className="mt-3" role="status" aria-live="polite">
              <div className="mb-2 flex justify-between text-xs text-zinc-500">
                <span>{uploadProgress === 100 ? "finishing…" : "uploading"}</span>
                <span>{uploadProgress}%</span>
              </div>
              <progress aria-label="Upload progress" max={100} value={uploadProgress} className="block h-1 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-zinc-100 [&::-webkit-progress-value]:bg-zinc-900 [&::-moz-progress-bar]:bg-zinc-900" />
              <button type="button" className="mt-3 text-sm text-zinc-500 hover:text-zinc-900" onClick={() => uploadRequest.current?.abort()}>cancel upload</button>
            </div>
          )}
          {mediaError && <p role="alert" className="mt-3 text-sm text-red-600">{mediaError}</p>}
          {mediaKind !== "cover" && (
            <label className="mt-4 block text-sm text-zinc-500">
              {mediaKind === "audio" ? "label" : "alt text"}
              <input disabled={busy} className={`${field} mt-2 text-zinc-800`} value={mediaLabel} onChange={(event) => setMediaLabel(event.target.value)} />
            </label>
          )}
          <div className="mt-5 flex min-w-0 items-center gap-2 border-t border-zinc-100 pt-4">
            <input
              aria-label="Media URL"
              disabled={busy}
              className={`${field} min-w-0 flex-1`}
              type="url"
              value={mediaUrl}
              onChange={(event) => setMediaUrl(event.target.value)}
              placeholder="or paste a link"
              onKeyDown={(event) => { if (event.key === "Enter" && mediaUrl.trim() && !busy) addMedia(mediaUrl.trim()); }}
            />
            <button disabled={busy || !mediaUrl.trim()} className={`${button} shrink-0`} onClick={() => addMedia(mediaUrl.trim())}>insert</button>
          </div>
        </section>
      )}
    </main>
  );
}
