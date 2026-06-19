import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth.store";
import { useSyncStore } from "@/stores/sync.store";
import { useContactsStore } from "@/stores/contacts.store";
import { attachSyncListeners } from "@/matrix/sync";

export function useContactSync() {
  const client = useAuthStore((s) => s.client);
  const isReady = useSyncStore((s) => s.isReady);
  const contacts = useContactsStore((s) => s.contacts);
  const indexEntries = useContactsStore((s) => s.indexEntries);

  useEffect(() => {
    if (!client) return;
    const cleanup = attachSyncListeners(client);
    return cleanup;
  }, [client]);

  return { isReady, contacts, indexEntries };
}
