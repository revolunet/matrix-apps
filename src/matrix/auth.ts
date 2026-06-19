import * as sdk from "matrix-js-sdk";
import { getHomeserverUrl } from "@/lib/constants";
import { createMatrixClient, startMatrixClient, clearBootstrapGuard } from "./client";
import type { MatrixClient } from "matrix-js-sdk";

const SESSION_KEY = "matrix_session";

interface StoredSession {
  accessToken: string;
  userId: string;
  deviceId: string;
}

export async function login(
  username: string,
  password: string,
): Promise<{ accessToken: string; userId: string; deviceId: string }> {
  // Temporary unauthenticated client just for login
  const tempClient = sdk.createClient({ baseUrl: getHomeserverUrl() });
  const resp = await tempClient.loginWithPassword(username, password);

  // Store password temporarily for cross-signing UIA bootstrap
  sessionStorage.setItem("matrix_login_password", password);

  const session: StoredSession = {
    accessToken: resp.access_token,
    userId: resp.user_id,
    deviceId: resp.device_id,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

  return session;
}

export async function register(
  username: string,
  password: string,
): Promise<{ accessToken: string; userId: string; deviceId: string }> {
  const tempClient = sdk.createClient({ baseUrl: getHomeserverUrl() });

  // Matrix registration requires two-step UIA on most homeservers:
  // 1. First call returns 401 with a session ID and required auth flows.
  // 2. Second call includes auth: { type: "m.login.dummy", session } to complete.
  type MatrixRegisterError = {
    httpStatus?: number;
    data?: { session?: string; error?: string; errcode?: string };
    message?: string;
  };

  let sessionId: string | null = null;

  try {
    await tempClient.register(username, password, null, null);
  } catch (err) {
    const e = err as MatrixRegisterError;
    if (e.httpStatus === 401 && e.data?.session) {
      sessionId = e.data.session;
    } else {
      throw new Error(e.data?.error ?? e.message ?? "Registration failed");
    }
  }

  let resp;
  try {
    resp = await tempClient.register(
      username,
      password,
      sessionId,
      sessionId ? { type: "m.login.dummy", session: sessionId } : null,
    );
  } catch (err) {
    const e = err as MatrixRegisterError;
    throw new Error(e.data?.error ?? e.message ?? "Registration failed");
  }

  if (!resp.access_token || !resp.device_id) {
    throw new Error("Homeserver did not return credentials after registration");
  }

  const session: StoredSession = {
    accessToken: resp.access_token,
    userId: resp.user_id,
    deviceId: resp.device_id,
  };
  sessionStorage.setItem("matrix_login_password", password);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function loadSession(): StoredSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export async function logout(client: MatrixClient): Promise<void> {
  const userId = client.getUserId() ?? "";
  const deviceId = client.getDeviceId() ?? "";
  try {
    await client.logout(true);
  } catch {
    // Best-effort
  }
  client.stopClient();
  clearBootstrapGuard(userId, deviceId);
  sessionStorage.clear();
}

export async function initializeSession(): Promise<MatrixClient | null> {
  const session = loadSession();
  if (!session) return null;

  const client = await createMatrixClient(session);
  await startMatrixClient(client);
  return client;
}
