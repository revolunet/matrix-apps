import { create } from "zustand";
import type { MatrixClient } from "matrix-js-sdk";

export type LoginState =
  | "idle"
  | "loading"
  | "authenticated"
  | "error"
  | "unauthenticated";

interface AuthState {
  client: MatrixClient | null;
  userId: string | null;
  deviceId: string | null;
  loginState: LoginState;
  setClient: (
    client: MatrixClient,
    userId: string,
    deviceId: string,
  ) => void;
  setLoginState: (state: LoginState) => void;
  clearAuth: () => void;
}

// Synchronously check for a saved session before the first render so that
// AppLayout can make the right decision immediately:
//   • session found  → "idle"            (SessionLoader will restore it; AppLayout shows spinner)
//   • no session     → "unauthenticated" (AppLayout redirects to /login with no spinner flash)
// The key must match SESSION_KEY in src/matrix/storage.ts ("matrix_session").
function initialLoginState(): LoginState {
  try {
    return localStorage.getItem("matrix_session") !== null
      ? "idle"
      : "unauthenticated";
  } catch {
    // localStorage blocked (e.g. private-browsing restrictions) — let
    // SessionLoader discover there is no usable session.
    return "idle";
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  client: null,
  userId: null,
  deviceId: null,
  loginState: initialLoginState(),

  setClient: (client, userId, deviceId) =>
    set({ client, userId, deviceId, loginState: "authenticated" }),

  setLoginState: (loginState) => set({ loginState }),

  clearAuth: () =>
    set({ client: null, userId: null, deviceId: null, loginState: "unauthenticated" }),
}));
