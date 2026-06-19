import { useState } from "react";
import { useContactsStore } from "@/stores/contacts.store";
import { useMatrixClient } from "./useMatrixClient";

export function useShareContact(contactId: string) {
  const client = useMatrixClient();
  const indexEntries = useContactsStore((s) => s.indexEntries);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareWith = async (matrixUserId: string) => {
    const entry = indexEntries.find((e) => e.contactId === contactId);
    if (!entry) {
      setError("Contact not found in index");
      return;
    }

    setSharing(true);
    setError(null);
    try {
      await Promise.all([
        client.invite(entry.dataRoomId, matrixUserId),
        client.invite(entry.commentsRoomId, matrixUserId),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharing(false);
    }
  };

  return { shareWith, sharing, error };
}
