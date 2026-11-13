import type { Root, Element, Text } from "hast";
import { AnimatedBot } from "./animated-bot";
import { tweetId } from "@/lib/blog/tweet";
import { TweetEmbed } from "./tweet-embed";
import { AudioPlayer } from "./audio-player";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Transform text nodes only, leaving code samples and URLs untouched.
function inlineBots() {
  return (tree: Root) => {
    function walk(parent: Root | Element) {
      if (parent.type === "element" && ["code", "pre"].includes(parent.tagName)) return;
      parent.children = parent.children.flatMap((node) => {
        if (node.type === "element") walk(node);
        if (node.type !== "text" || !node.value.includes("::bot::")) return [node];
        const parts = node.value.split("::bot::");
        const result: (Text | Element)[] = [];
        parts.forEach((part, index) => {
          if (index) result.push({ type: "element", tagName: "span", properties: { dataBot: true }, children: [] });
          if (part) result.push({ type: "text", value: part });
        });
        return result;
      });
      // Earlier insertions saved bots as separate paragraphs. Keep those inline too.
      for (let index = 1; index < parent.children.length; index++) {
        const current = parent.children[index];
        if (current.type !== "element" || current.tagName !== "p") continue;
        const content = current.children.filter((child) => child.type !== "text" || child.value.trim());
        if (content.length !== 1 || content[0].type !== "element" || !content[0].properties.dataBot) continue;
        let previousIndex = index - 1;
        while (previousIndex >= 0 && parent.children[previousIndex].type === "text" && !(parent.children[previousIndex] as Text).value.trim()) previousIndex--;
        const previous = parent.children[previousIndex];
        if (previous?.type !== "element" || previous.tagName !== "p") continue;
        previous.children.push({ type: "text", value: " " }, content[0]);
        parent.children.splice(previousIndex + 1, index - previousIndex);
        index = previousIndex;
      }
    }
    walk(tree);
  };
}

export function BlogMarkdown({ children }: { children: string }) {
  return (
    <div className="blog-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[inlineBots]}
        skipHtml
        components={{
          span: ({ node, children, ...props }) => node?.properties.dataBot ? <AnimatedBot /> : <span {...props}>{children}</span>,
          p: ({ node, children }) => {
            const nodes = node?.children.filter((child) => child.type !== "text" || child.value.trim());
            const link = nodes?.length === 1 ? nodes[0] : undefined;
            const href = link?.type === "element" && link.tagName === "a" ? link.properties.href : undefined;
            const id = typeof href === "string" ? tweetId(href) : null;
            return id ? <TweetEmbed id={id} /> : <p>{children}</p>;
          },
          h1: ({ children }) => <h2>{children}</h2>,
          img: ({ src, alt, title }) => (
            <span role="figure" aria-label={title || alt || "Image"} className="blog-image">
              <img src={src} alt={alt || ""} loading="lazy" />
              {title && <span className="image-caption">{title}</span>}
            </span>
          ),
          a: ({ href, children, title }) =>
            title === "audio" && href ? (
              <AudioPlayer
                key={href}
                src={href}
                label={
                  typeof children === "string" ? children : "Audio recording"
                }
              />
            ) : (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
