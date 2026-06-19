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

export const useAuthStore = create<AuthState>((set) => ({
  client: null,
  userId: null,
  deviceId: null,
  loginState: "idle",

  setClient: (client, userId, deviceId) =>
    set({ client, userId, deviceId, loginState: "authenticated" }),

  setLoginState: (loginState) => set({ loginState }),

  clearAuth: () =>
    set({ client: null, userId: null, deviceId: null, loginState: "unauthenticated" }),
}));
