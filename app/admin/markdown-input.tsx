"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  Bold,
  Italic,
  Heading2,
  Quote,
  List,
  Code,
  Link as LinkIcon,
} from "lucide-react";

type Action =
  "strike" | "ordered" | "h1" | "h3" | "bold" | "italic" | "heading" | "quote" | "list" | "code" | "link";
const actions = [
  { id: "bold", label: "Bold", icon: Bold },
  { id: "italic", label: "Italic", icon: Italic },
  { id: "heading", label: "Heading", icon: Heading2 },
  { id: "quote", label: "Quote", icon: Quote },
  { id: "list", label: "Bullet list", icon: List },
  { id: "code", label: "Code", icon: Code },
  { id: "link", label: "Link", icon: LinkIcon },
] as const;

export function MarkdownInput({
  value,
  onChange,
  inputRef,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  className: string;
}) {
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => {
      const x = window.scrollX;
      const y = window.scrollY;
      const parent = input.parentElement;
      if (parent) parent.style.minHeight = `${input.offsetHeight}px`;
      input.style.height = "0px";
      input.style.height = `${input.scrollHeight}px`;
      if (parent) parent.style.minHeight = "";
      window.scrollTo({ left: x, top: y, behavior: "instant" });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value, inputRef]);
  const wrapper = useRef<HTMLDivElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
    top: number;
    left: number;
  } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; position: number } | null>(null);
  const contextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!contextMenu) return;
    contextButton.current?.focus({ preventScroll: true });
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);
  function insertBot(start: number, end = start) {
    const token = "::bot:: ";
    onChange(value.slice(0, start) + token + value.slice(end));
    setContextMenu(null);
    setSelection(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const linkOpen = link !== null;
  useLayoutEffect(() => {
    if (linkOpen) linkInput.current?.focus({ preventScroll: true });
  }, [linkOpen]);

  function capture() {
    const input = inputRef.current;
    if (!input || link !== null || document.activeElement !== input) return;
    if (input.selectionStart === input.selectionEnd) {
      setSelection(null);
      setLink(null);
      return;
    }
    // Mirror the textarea's wrapping to anchor the toolbar beside the selection.
    const mirror = document.createElement("div");
    const style = getComputedStyle(input);
    for (const key of [
      "font",
      "lineHeight",
      "letterSpacing",
      "padding",
      "border",
      "boxSizing",
      "tabSize",
    ] as const)
      mirror.style[key] = style[key];
    Object.assign(mirror.style, {
      position: "fixed",
      top: "0",
      left: "0",
      pointerEvents: "none",
      visibility: "hidden",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      width: `${input.clientWidth + 2}px`,
    });
    mirror.textContent = value.slice(0, input.selectionStart);
    const marker = document.createElement("span");
    marker.textContent =
      value.slice(input.selectionStart, input.selectionEnd) || ".";
    mirror.append(marker);
    document.body.append(mirror);
    const rect = marker.getClientRects()[0];
    const bounds = mirror.getBoundingClientRect();
    const top = Math.min(
      input.clientHeight - 44,
      Math.max(
        4,
        (rect?.top ?? bounds.top) - bounds.top - input.scrollTop - 44,
      ),
    );
    const left = Math.max(
      0,
      Math.min(
        (rect?.left ?? bounds.left) - bounds.left,
        input.clientWidth - 286,
      ),
    );
    mirror.remove();
    setSelection({
      start: input.selectionStart,
      end: input.selectionEnd,
      top,
      left,
    });
  }

  function apply(action: Action, url?: string) {
    const input = inputRef.current;
    if (!input) return;
    let { start, end } = selection ?? { start: input.selectionStart, end: input.selectionEnd };
    let selected = value.slice(start, end);
    let replacement: string;
    let innerOffset = 0;
    if (["heading", "h1", "h3", "quote", "list", "ordered"].includes(action)) {
      start = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = value.indexOf("\n", Math.max(start, end - 1));
      end = lineEnd === -1 ? value.length : lineEnd;
      selected = value.slice(start, end);
      const prefix =
        action === "heading" ? "## " : action === "h1" ? "# " : action === "h3" ? "### " : action === "ordered" ? "1. " : action === "quote" ? "> " : "- ";
      const lines = selected.split("\n");
      const remove = selected.trim().length > 0 && lines.every(
        (line) => !line.trim() || (action === "ordered" ? /^\d+\. /.test(line) : line.startsWith(prefix)),
      );
      replacement = lines
        .map((line, index) =>
          !line.trim() && lines.length > 1
            ? line
            : remove
              ? action === "ordered" ? line.replace(/^\d+\. /, "") : line.slice(prefix.length)
              : (action === "ordered" ? `${index + 1}. ` : prefix) +
                line.replace(["heading", "h1", "h3"].includes(action) ? /^#{1,6} / : /$^/, ""),
        )
        .join("\n");
    } else if (action === "link") {
      replacement = `[${selected.replace(/[\[\]\\]/g, "\\$&")}](${url})`;
      innerOffset = 1;
    } else {
      const marker =
        action === "strike" ? "~~" : action === "bold"
          ? "**"
          : action === "italic"
            ? "_"
            : selected.includes("\n")
              ? "```\n"
              : "`";
      const closing = marker === "```\n" ? "\n```" : marker;
      if (
        value.slice(Math.max(0, start - marker.length), start) === marker &&
        value.slice(end, end + closing.length) === closing
      ) {
        start -= marker.length;
        end += closing.length;
        replacement = selected;
      } else {
        replacement = marker + selected + closing;
        innerOffset = marker.length;
      }
    }
    const scrollY = window.scrollY;
    onChange(value.slice(0, start) + replacement + value.slice(end));
    setLink(null);
    setError("");
    setSelection(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.setSelectionRange(
        start + innerOffset,
        start +
          (innerOffset ? innerOffset + selected.length : replacement.length),
      );
      window.scrollTo({ top: scrollY, behavior: "instant" });
    });
  }

  function insertLink() {
    try {
      const entered = (link || "").trim();
      const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(entered) ? entered : `https://${entered}`);
      if (!entered || (url.protocol !== "mailto:" && !url.hostname.includes("."))) throw new Error();
      if (!["https:", "http:", "mailto:"].includes(url.protocol))
        throw new Error();
      apply("link", url.href.replace(/\(/g, "%28").replace(/\)/g, "%29"));
    } catch {
      setError("Enter a valid https://, http:// or mailto: link.");
    }
  }

  return (
    <div
      ref={wrapper}
      className="relative min-w-0"
      onBlur={(event) => {
        const container = event.currentTarget;
        requestAnimationFrame(() => {
          if (!container.contains(document.activeElement)) {
            setSelection(null);
            setLink(null);
          }
        });
      }}
    >
      <textarea
        ref={inputRef}
        aria-label="Post Markdown"
        className={className}
        value={value}
        maxLength={200000}
        onChange={(event) => {
          onChange(event.target.value);
          setSelection(null);
          setLink(null);
        }}
        onSelect={capture}
        onContextMenu={(event) => {
          // Shift + right click keeps the browser's native menu available.
          if (event.shiftKey) return;
          event.preventDefault();
          setSelection(null);
          setLink(null);
          const bounds = event.currentTarget.getBoundingClientRect();
          setContextMenu({ x: Math.max(8, Math.min(event.clientX || bounds.left, window.innerWidth - 192)), y: Math.max(8, Math.min(event.clientY || bounds.top, window.innerHeight - 60)), position: event.currentTarget.selectionEnd });
        }}

        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            const cursor = event.currentTarget.selectionStart;
            const command = /(?:^|\s)(\/bot)$/.exec(value.slice(0, cursor));
            if (command && event.currentTarget.selectionEnd === cursor) {
              event.preventDefault();
              insertBot(cursor - 4, cursor);
              return;
            }
          }
          if (event.key === "Escape") {
            setSelection(null);
            setLink(null);
          }
          if (!(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
          const key = event.key.toLowerCase();
          let action: Action | undefined;
          if (event.altKey && !event.shiftKey) {
            action = ({ Digit1: "h1", Digit2: "heading", Digit3: "h3" } as Record<string, Action>)[event.code];
          } else if (event.shiftKey && !event.altKey) {
            action = ({ Digit7: "ordered", Digit8: "list", Digit9: "quote", KeyX: "strike" } as Record<string, Action>)[event.code];
          } else if (!event.altKey && !event.shiftKey) {
            action = ({ b: "bold", i: "italic", k: "link", e: "code" } as Record<string, Action>)[key];
          }
          if (!action) return;
          event.preventDefault();
          if (action === "link") {
            if (!selection) setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd, top: 0, left: 0 });
            setLink("");
          } else apply(action);
        }}
        placeholder={"start writing…"}
      />
      {contextMenu && (
        <div role="menu" aria-label="Editor actions" className="fixed z-[80] w-44 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setContextMenu(null); }}>
          <button ref={contextButton} type="button" role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none" onClick={() => insertBot(contextMenu.position)} onKeyDown={(event) => {
            if (event.key === "Escape") { event.stopPropagation(); setContextMenu(null); inputRef.current?.focus({ preventScroll: true }); }
          }}>insert bot</button>
        </div>
      )}
      {selection && (
        <div
          className="markdown-toolbar absolute z-30 max-w-full rounded-xl border border-zinc-200 bg-white p-1 shadow-lg"
          style={{ top: selection.top, left: selection.left }}
        >
          <div
            role="toolbar"
            aria-label="Format selected text"
            className="flex flex-wrap items-center gap-0.5"
          >
            {actions.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                title={label}
                aria-label={label}
                className="rounded-lg p-2 text-sm text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-900"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => (id === "link" ? setLink("") : apply(id))}
              >
                <Icon size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
          {link !== null && (
            <div className="w-64 max-w-full border-t border-zinc-100 p-2">
              <label className="block text-sm">
                Link URL
                <input
                  ref={linkInput}
                  type="url"
                  value={link}
                  onChange={(event) => {
                    setLink(event.target.value);
                    setError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      insertLink();
                    }
                    if (event.key === "Escape") {
                      setLink(null);
                      inputRef.current?.focus({ preventScroll: true });
                    }
                  }}
                  placeholder="https://…"
                  className="mt-2 w-full rounded border border-zinc-200 px-2 py-1 text-sm"
                />
              </label>
              {error && (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={insertLink}
                className="mt-2 rounded bg-zinc-950 px-3 py-1 text-sm text-white"
              >
                Insert link
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
