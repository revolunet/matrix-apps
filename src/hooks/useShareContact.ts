import { useState } from "react";
import { useMatrixClient } from "./useMatrixClient";

export function useShareContact(dataRoomId?: string, commentsRoomId?: string) {
  const client = useMatrixClient();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareWith = async (matrixUserId: string) => {
    if (!dataRoomId || !commentsRoomId) {
      setError("Room IDs not available");
      return;
    }

    setSharing(true);
    setError(null);
    try {
      await Promise.all([
        client.invite(dataRoomId, matrixUserId),
        client.invite(commentsRoomId, matrixUserId),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharing(false);
    }
  };

  return { shareWith, sharing, error };
}
