import ReactMarkdown from "react-markdown";
import { clsx } from "clsx";
import type { Components } from "react-markdown";

interface MessageProps {
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

interface Props {
  message: MessageProps;
}

const markdownComponents: Components = {
  code({ className, children, ...rest }) {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="rounded-[4px] bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[12px] text-octo-accent/90"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className={clsx(
          "block overflow-x-auto rounded-lg bg-zinc-950/80 p-4 font-mono text-[12px] leading-relaxed text-zinc-300",
          className,
        )}
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <pre className="my-3 overflow-x-auto rounded-lg bg-zinc-950/80">{children}</pre>;
  },
  p({ children }) {
    return <p className="mb-3 leading-relaxed last:mb-0">{children}</p>;
  },
  ul({ children }) {
    return (
      <ul className="mb-3 ml-1 list-inside list-disc space-y-1.5 last:mb-0 marker:text-zinc-600">
        {children}
      </ul>
    );
  },
  ol({ children }) {
    return (
      <ol className="mb-3 ml-1 list-inside list-decimal space-y-1.5 last:mb-0 marker:text-zinc-500">
        {children}
      </ol>
    );
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },
  h1({ children }) {
    return (
      <h1 className="mb-3 mt-4 border-b border-octo-border/50 pb-1.5 text-base font-semibold text-zinc-100 first:mt-0">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="mb-2 mt-4 text-[13px] font-semibold uppercase tracking-wide text-octo-accent/80 first:mt-0">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="mb-1.5 mt-3 text-sm font-medium text-zinc-200 first:mt-0">
        {children}
      </h3>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-2 border-octo-accent/30 bg-octo-accent/5 py-1 pl-3 text-zinc-400">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-4 border-octo-border/50" />;
  },
  strong({ children }) {
    return <strong className="font-semibold text-zinc-100">{children}</strong>;
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        className="text-octo-accent underline decoration-octo-accent/30 underline-offset-2 hover:decoration-octo-accent/60"
        target="_blank"
        rel="noopener"
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-octo-border">
        <table className="w-full text-xs">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return (
      <th className="border-b border-octo-border bg-zinc-900/50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="border-b border-octo-border/50 px-3 py-2 text-zinc-300">
        {children}
      </td>
    );
  },
};

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function ChatMessage({ message }: Props) {
  const { role, content, model, inputTokens, outputTokens } = message;

  if (!content || !content.trim()) return null;

  if (role === "user") {
    return (
      <div className="flex justify-end" data-role="user">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-octo-accent/20 px-4 py-2.5 text-sm leading-relaxed text-zinc-200">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] flex-col gap-1">
        <div className="rounded-2xl rounded-bl-md border border-octo-border bg-octo-panel px-5 py-4 text-[13px] text-zinc-300">
          <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
        </div>
        {(model || inputTokens != null || outputTokens != null) && (
          <div className="px-1 text-[10px] text-zinc-600">
            {[
              model,
              inputTokens != null ? `${formatTokenCount(inputTokens)} in` : null,
              outputTokens != null ? `${formatTokenCount(outputTokens)} out` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}
