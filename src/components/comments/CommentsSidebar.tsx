import { CommentItem, type CommentLike } from "./CommentItem";
import { CommentComposer } from "./CommentComposer";

interface Props {
  comments: CommentLike[];
  onSubmit: (body: string) => Promise<void>;
  onClose: () => void;
  currentUserId?: string | null;
  title?: string;
}

/** Right-column comments panel shared by Docs and the CRM entity detail page. */
export function CommentsSidebar({
  comments,
  onSubmit,
  onClose,
  currentUserId,
  title = "Comments",
}: Props) {
  return (
    <div className="flex flex-col h-full border-l border-gray-200 bg-white w-72 flex-none">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-none">
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 text-lg"
          aria-label="Close comments"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {comments.length === 0 ? (
          <p className="text-xs text-gray-400 text-center mt-8">
            No comments yet
          </p>
        ) : (
          comments.map((c) => (
            <CommentItem key={c.id} comment={c} currentUserId={currentUserId} />
          ))
        )}
      </div>

      <CommentComposer onSubmit={onSubmit} />
    </div>
  );
}
