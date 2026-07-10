interface Props {
  open: boolean;
  hasUnseen: boolean;
  onClick: () => void;
}

/** Header button that opens/closes the CommentsSidebar, with a ping badge for unseen comments. */
export function CommentsToggleButton({ open, hasUnseen, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`relative text-sm px-3 py-1.5 rounded-lg border transition-colors ${
        open
          ? "border-blue-300 bg-blue-50 text-blue-700"
          : "border-gray-200 text-gray-600 hover:border-gray-400"
      }`}
    >
      💬 Comments
      {hasUnseen && (
        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
        </span>
      )}
    </button>
  );
}
