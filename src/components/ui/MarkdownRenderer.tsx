import React from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Format inline Markdown elements: **bold**, *italic*, `code`, [link](url), etc.
 */
function renderInline(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  // Match inline code `...`, bold **...**, italic *...*, link [...](...)
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before the match
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith("`") && token.endsWith("`")) {
      // Inline code
      elements.push(
        <code
          key={key}
          className="px-1.5 py-0.5 mx-0.5 rounded-md bg-muted text-primary font-mono text-xs font-medium border border-border/50"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      // Bold
      elements.push(
        <strong key={key} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      // Italic
      elements.push(
        <em key={key} className="italic text-foreground/90">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith("[") && token.includes("](")) {
      // Link
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const linkText = linkMatch[1];
        const linkHref = linkMatch[2];
        elements.push(
          <a
            key={key}
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={async (e) => {
              e.preventDefault();
              if (linkHref.startsWith("https://") && linkHref.includes("monash.edu")) {
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  await invoke("open_in_app_webview", { url: linkHref, title: linkText || "Monash" });
                  return;
                } catch { /* Fall back to the external browser */ }
              }
              try {
                const { openUrl } = await import("@tauri-apps/plugin-opener");
                await openUrl(linkHref);
              } catch { /* Silent */ }
            }}
            className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer"
          >
            {linkText}
          </a>
        );
      } else {
        elements.push(token);
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

/**
 * Production-grade lightweight Markdown renderer with rich styling for headings, lists, code blocks, blockquotes, bold, etc.
 */
export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  if (!content) return null;

  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  let inList = false;
  let listItems: React.ReactNode[] = [];
  let isOrderedList = false;

  const flushList = (keyPrefix: number) => {
    if (inList && listItems.length > 0) {
      if (isOrderedList) {
        blocks.push(
          <ol
            key={`ol-${keyPrefix}`}
            className="list-decimal list-outside ml-5 space-y-1.5 my-2 text-foreground/90 leading-relaxed"
          >
            {listItems}
          </ol>
        );
      } else {
        blocks.push(
          <ul
            key={`ul-${keyPrefix}`}
            className="list-disc list-outside ml-5 space-y-1.5 my-2 text-foreground/90 leading-relaxed"
          >
            {listItems}
          </ul>
        );
      }
      listItems = [];
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Code block ``` handling
    if (trimmed.startsWith("```")) {
      flushList(i);
      if (inCodeBlock) {
        // End of code block
        blocks.push(
          <div
            key={`code-${i}`}
            className="my-3 rounded-xl bg-muted/80 p-3.5 border border-border/60 overflow-x-auto text-xs font-mono text-foreground"
          >
            {codeBlockLang && (
              <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1.5 pb-1 border-b border-border/40">
                {codeBlockLang}
              </div>
            )}
            <pre className="leading-relaxed">
              <code>{codeBlockLines.join("\n")}</code>
            </pre>
          </div>
        );
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = "";
      } else {
        // Start of code block
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      continue;
    }

    // 2. Blank line
    if (trimmed === "") {
      flushList(i);
      continue;
    }

    // 3. Horizontal rule --- or ***
    if (/^(\-{3,}|\*{3,})$/.test(trimmed)) {
      flushList(i);
      blocks.push(<hr key={`hr-${i}`} className="my-4 border-border/60" />);
      continue;
    }

    // 4. Headings # ~ ####
    if (trimmed.startsWith("#")) {
      flushList(i);
      const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        if (level === 1) {
          blocks.push(
            <h3
              key={`h1-${i}`}
              className="text-base font-bold text-foreground mt-4 mb-2 pb-1 border-b border-border/50 flex items-center gap-2"
            >
              {renderInline(text)}
            </h3>
          );
        } else if (level === 2) {
          blocks.push(
            <h4
              key={`h2-${i}`}
              className="text-sm font-semibold text-foreground mt-3.5 mb-1.5 flex items-center gap-1.5"
            >
              {renderInline(text)}
            </h4>
          );
        } else {
          blocks.push(
            <h5
              key={`h3-${i}`}
              className="text-xs font-semibold text-foreground/90 uppercase tracking-wide mt-2.5 mb-1"
            >
              {renderInline(text)}
            </h5>
          );
        }
        continue;
      }
    }

    // 5. Blockquote >
    if (trimmed.startsWith(">")) {
      flushList(i);
      const quoteText = trimmed.replace(/^>\s?/, "");
      blocks.push(
        <div
          key={`quote-${i}`}
          className="my-2.5 pl-3.5 py-1.5 border-l-3 border-primary/70 bg-primary/5 rounded-r-lg text-xs italic text-muted-foreground leading-relaxed"
        >
          {renderInline(quoteText)}
        </div>
      );
      continue;
    }

    // 6. Unordered list - or *
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      if (!inList || isOrderedList) {
        flushList(i);
        inList = true;
        isOrderedList = false;
      }
      listItems.push(
        <li key={`li-${i}`} className="pl-1">
          {renderInline(bulletMatch[1])}
        </li>
      );
      continue;
    }

    // 7. Ordered list 1. 2. etc.
    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      if (!inList || !isOrderedList) {
        flushList(i);
        inList = true;
        isOrderedList = true;
      }
      listItems.push(
        <li key={`oli-${i}`} className="pl-1">
          {renderInline(orderedMatch[2])}
        </li>
      );
      continue;
    }

    // 8. Plain paragraph
    flushList(i);
    blocks.push(
      <p key={`p-${i}`} className="my-1.5 text-foreground/90 leading-relaxed">
        {renderInline(trimmed)}
      </p>
    );
  }

  // Flush any unclosed list at the end
  flushList(lines.length);

  return (
    <div className={`markdown-body text-sm leading-relaxed space-y-1 ${className}`}>
      {blocks}
    </div>
  );
}
