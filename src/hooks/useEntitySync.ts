import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth.store";
import { useSyncStore } from "@/stores/sync.store";
import { useEntityStore } from "@/stores/entity.store";
import { attachSyncListeners } from "@/matrix/sync";

export function useEntitySync() {
  const client = useAuthStore((s) => s.client);
  const isReady = useSyncStore((s) => s.isReady);
  const indices = useEntityStore((s) => s.indices);

  useEffect(() => {
    if (!client) return;
    const cleanup = attachSyncListeners(client);
    return cleanup;
  }, [client]);

  return { isReady, indices };
}
