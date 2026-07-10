import { useState } from "react";

interface Props {
  onSubmit: (body: string) => Promise<void>;
}

/** Enter sends the comment; Shift+Enter inserts a newline. */
export function CommentComposer({ onSubmit }: Props) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await onSubmit(trimmed);
      setBody("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-3 border-t border-gray-100 flex-none">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder="Add a comment…"
        rows={3}
        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg resize-none outline-none focus:border-blue-400"
      />
      <button
        onClick={handleSend}
        disabled={!body.trim() || sending}
        className="mt-2 w-full text-sm py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {sending ? "Sending…" : "Comment"}
      </button>
    </div>
  );
}
