import { useState } from "react";

interface Props {
  onSubmit: (body: string) => Promise<void>;
}

export function CommentInput({ onSubmit }: Props) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setBody("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex gap-2 pt-3 border-t border-gray-200">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Write a comment..."
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
        }}
        className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500"
      />
      <button
        onClick={handleSubmit}
        disabled={submitting || !body.trim()}
        className="self-end bg-black text-white text-sm px-3 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? "..." : "Post"}
      </button>
    </div>
  );
}
