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
      <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.body}</p>
    </li>
  );
}
