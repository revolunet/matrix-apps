import ReactMarkdown from "react-markdown";
import { commentMarkdownComponents } from "./commentMarkdown";

export interface CommentLike {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

interface Props {
  comment: CommentLike;
  currentUserId?: string | null;
}

export function CommentItem({ comment, currentUserId }: Props) {
  const authorLabel =
    comment.authorId === currentUserId
      ? "You"
      : comment.authorId.split(":")[0].replace("@", "");

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-gray-700 truncate">
          {authorLabel}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(comment.createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="text-sm text-gray-700">
        <ReactMarkdown components={commentMarkdownComponents}>
          {comment.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}
