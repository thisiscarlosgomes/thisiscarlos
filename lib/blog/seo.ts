import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
};
export function postText(markdown: string) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  function text(node: MarkdownNode): string {
    if (
      ["image", "imageReference", "html", "definition", "code"].includes(
        node.type,
      ) ||
      (node.type === "link" && node.title === "audio")
    )
      return "";
    if (node.type === "text" || node.type === "inlineCode")
      return node.value || "";
    return (node.children || [])
      .map(text)
      .join(
        [
          "paragraph",
          "heading",
          "emphasis",
          "strong",
          "link",
          "delete",
        ].includes(node.type)
          ? ""
          : " ",
      );
  }
  return text(tree).replace(/\s+/g, " ").trim();
}
export function postDescription(excerpt: string, markdown: string) {
  const text = excerpt.trim() || postText(markdown);
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  return (
    cut.slice(
      0,
      cut.lastIndexOf(" ") > 100 ? cut.lastIndexOf(" ") : cut.length,
    ) + "…"
  );
}
export function firstPostImage(markdown: string): string | undefined {
  const tree = unified().use(remarkParse).parse(markdown);
  function find(node: MarkdownNode): string | undefined {
    if (node.type === "image") return node.url;
    for (const child of node.children || []) {
      const url = find(child);
      if (url) return url;
    }
  }
  return find(tree);
}
