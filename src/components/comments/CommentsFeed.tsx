import { useEffect, useRef } from "react";
import type { Comment } from "@/schemas/comment.schema";
import { CommentItem } from "./CommentItem";
import { CommentInput } from "./CommentInput";

interface Props {
  comments: Comment[];
  onPostComment: (body: string) => Promise<void>;
}

export function CommentsFeed({ comments, onPostComment }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Comments</h3>
      <ul className="flex-1 overflow-y-auto border border-gray-200 rounded p-2 min-h-32 max-h-64">
        {comments.length === 0 ? (
          <li className="text-xs text-gray-400 text-center py-4">
            No comments yet
          </li>
        ) : (
          comments.map((c) => <CommentItem key={c.id} comment={c} />)
        )}
        <div ref={bottomRef} />
      </ul>
      <CommentInput onSubmit={onPostComment} />
    </div>
  );
}
