import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body text-[15px] leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-4 mt-6 font-display text-2xl font-semibold tracking-tight first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-3 mt-6 font-display text-xl font-semibold tracking-tight first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-5 font-display text-lg font-semibold first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1.5 pl-6">{children}</ol>,
          li: ({ children }) => <li className="marker:text-accent">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent underline decoration-indigo-200 underline-offset-2 transition hover:text-accent-deep hover:decoration-indigo-400"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="mb-4 border-l-4 border-indigo-200 bg-indigo-50/50 py-2 pl-4 pr-3 italic text-ink-soft">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.88em] font-medium text-indigo-700">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-4 overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-slate-100">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-6 border-slate-200" />,
          br: () => <br />,
          mark: ({ children }) => (
            <mark className="rounded-[3px] bg-indigo-100/80 px-0.5 py-px text-indigo-900 box-decoration-clone">
              {children}
            </mark>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
