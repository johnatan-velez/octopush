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
          className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-zinc-300"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className={clsx("block overflow-x-auto rounded-lg bg-zinc-900 p-3 font-mono text-xs leading-relaxed", className)}
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <pre className="my-2 overflow-x-auto rounded-lg bg-zinc-900">{children}</pre>;
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>;
  },
  ul({ children }) {
    return <ul className="mb-2 list-inside list-disc space-y-0.5 last:mb-0">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-2 list-inside list-decimal space-y-0.5 last:mb-0">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-sm">{children}</li>;
  },
  h1({ children }) {
    return <h1 className="mb-2 text-base font-semibold">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-1.5 text-sm font-semibold">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mb-1 text-sm font-medium">{children}</h3>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-zinc-600 pl-3 text-zinc-400">
        {children}
      </blockquote>
    );
  },
};

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function ChatMessage({ message }: Props) {
  const { role, content, model, inputTokens, outputTokens } = message;

  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-octo-accent/20 px-4 py-2.5 text-sm text-zinc-200">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[80%] flex-col gap-1">
        <div className="rounded-2xl rounded-bl-md border border-octo-border bg-octo-panel px-4 py-3 text-sm text-zinc-200">
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
