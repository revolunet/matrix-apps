import { useState } from "react";

/**
 * Shared open/unseen-count state for a CommentsSidebar + CommentsToggleButton
 * pair. `commentCount` is the live count of comments for whatever room the
 * caller is watching; unseen comments are ones that arrived after the panel
 * was last opened (or since mount, if never opened).
 */
export function useCommentsPanel(commentCount: number) {
  const [open, setOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(commentCount);
  const hasUnseen = !open && commentCount > seenCount;

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next) setSeenCount(commentCount);
      return next;
    });
  };

  const close = () => setOpen(false);

  return { open, hasUnseen, toggle, close };
}
