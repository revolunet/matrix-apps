import { useAuthStore } from "@/stores/auth.store";
import type { MatrixClient } from "matrix-js-sdk";

export function useMatrixClient(): MatrixClient {
  const client = useAuthStore((s) => s.client);
  if (!client) throw new Error("Matrix client not available");
  return client;
}
