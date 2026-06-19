import ReactMarkdown from "react-markdown";
import type { Comment } from "@/schemas/comment.schema";

interface Props {
  comment: Comment;
}

export function CommentItem({ comment }: Props) {
  return (
    <li className="py-2 border-b border-gray-100 last:border-0">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-xs font-medium text-gray-800 font-mono">
          {comment.authorId}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(comment.createdAt).toLocaleString()}
        </span>
      </div>
      <div className="text-sm text-gray-700">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
            a: ({ href, children }) => (
              <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
            code: ({ children }) => (
              <code className="bg-gray-100 px-1 rounded text-xs font-mono">{children}</code>
            ),
            pre: ({ children }) => (
              <pre className="bg-gray-100 p-2 rounded text-xs font-mono overflow-x-auto my-1">{children}</pre>
            ),
            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-gray-300 pl-3 text-gray-500 my-1">{children}</blockquote>
            ),
          }}
        >
          {comment.body}
        </ReactMarkdown>
      </div>
    </li>
  );
}
