// Shared ReactMarkdown component overrides for rendering comment bodies,
// used by both CRM and Docs comments so the two don't drift in styling.
export const commentMarkdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 last:mb-0">{children}</p>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="bg-gray-100 px-1 rounded text-xs font-mono">{children}</code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="bg-gray-100 p-2 rounded text-xs font-mono overflow-x-auto my-1">{children}</pre>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-gray-300 pl-3 text-gray-500 my-1">{children}</blockquote>
  ),
};
