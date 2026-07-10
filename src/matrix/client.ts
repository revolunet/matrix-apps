import * as sdk from "matrix-js-sdk";
import { ClientEvent } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";
import { getHomeserverUrl } from "@/lib/constants";
import {
  SESSION_KEY,
  RECOVERY_KEY,
  LOGIN_PASSWORD_KEY,
  clearMatrixStorage,
} from "./storage";

// Pre-warm: start WASM download immediately at module load so it's ready
// (or nearly ready) by the time initRustCrypto() is called.
import("@matrix-org/matrix-sdk-crypto-wasm").then((m) =>
  m.initAsync().catch(() => {}),
);

let _client: MatrixClient | null = null;

export function getMatrixClient(): MatrixClient {
  if (!_client) throw new Error("Matrix client not initialized");
  return _client;
}

export function hasMatrixClient(): boolean {
  return _client !== null;
}

interface CreateClientOptions {
  accessToken: string;
  userId: string;
  deviceId: string;
}

// Decode the recovery key we previously stored in localStorage and return
// it in the format the SDK expects: [keyId, privateKey].
// Returns null if the key isn't available — the SDK will then fall through to
// createSecretStorageKey (if provided) or error if neither is available.
function getSecretStorageKeyFromStorage(
  keys: Record<string, unknown>,
): [string, Uint8Array<ArrayBuffer>] | null {
  const encoded = localStorage.getItem(RECOVERY_KEY);
  if (!encoded) return null;
  try {
    const binary = atob(encoded);
    const privateKey = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) {
      privateKey[i] = binary.charCodeAt(i);
    }
    const keyId = Object.keys(keys)[0];
    if (!keyId) return null;
    return [keyId, privateKey];
  } catch {
    return null;
  }
}

/**
 * Returns true if the Rust crypto IndexedDB store already exists on disk.
 * When false during a session restore it means the store was wiped while the
 * localStorage session survived — uploading fresh OTKs would then collide
 * with the old ones still registered on the server.
 *
 * Falls back to `true` on browsers that don't support `indexedDB.databases()`
 * (Safari < 16.4) so we don't incorrectly force a re-login there.
 */
async function cryptoStoreExists(storeName: string): Promise<boolean> {
  if (!("databases" in indexedDB)) return true;
  const dbs = await (indexedDB as IDBFactory & { databases(): Promise<IDBDatabaseInfo[]> }).databases();
  // The rust crypto SDK names its IndexedDB databases "<prefix>::matrix-sdk-crypto"
  // and "<prefix>::matrix-sdk-crypto-meta" (see cryptoDatabasePrefix passed to
  // initRustCrypto below) — not the bare prefix itself.
  return dbs.some(
    (db) =>
      db.name === `${storeName}::matrix-sdk-crypto` ||
      db.name === `${storeName}::matrix-sdk-crypto-meta`,
  );
}

async function deleteIndexedDBStores(storeName: string): Promise<void> {
  const candidates = [storeName, `idb_${storeName}`, "matrix-sdk-crypto"];

  if ("databases" in indexedDB) {
    const all = await indexedDB.databases();
    for (const db of all) {
      if (!db.name) continue;
      if (
        candidates.some((c) => db.name!.includes(c)) ||
        db.name.startsWith("matrix-sdk-crypto")
      ) {
        candidates.push(db.name);
      }
    }
  }

  await Promise.all(
    [...new Set(candidates)].map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        }),
    ),
  );
}

const bootstrapKey = (userId: string, deviceId: string) =>
  `matrix_crypto_bootstrapped:${userId}:${deviceId}`;

// Remove the bootstrap guard for this device (called on logout so that a
// re-login with the same deviceId triggers bootstrap again if needed).
export function clearBootstrapGuard(userId: string, deviceId: string): void {
  localStorage.removeItem(bootstrapKey(userId, deviceId));
}

// Runs after the client has started and reached PREPARED/SYNCING.
// Called fire-and-forget — failures are non-fatal for the prototype.
async function bootstrapCrypto(client: MatrixClient): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) return;

  // Runs on every session start, not just first bootstrap. Without a local
  // copy of the backup decryption key, a device that never received a given
  // Megolm session (e.g. a message from another user's device, or a session
  // lost when this device's IndexedDB store was reset) can never decrypt
  // that event — there is no other recovery path. Loading the key here is
  // what makes the rust crypto engine auto-restore individual missing
  // session keys from the server backup on decryption failure.
  try {
    await crypto.checkKeyBackupAndEnable();
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
  } catch {
    // No backup yet, or secret storage isn't set up — bootstrap below
    // creates both for a brand-new account.
  }

  const key = bootstrapKey(client.getUserId()!, client.getDeviceId()!);
  // Use localStorage (not sessionStorage) so the guard survives tab close.
  // Without this, bootstrap runs on every new session even when secret
  // storage and cross-signing are already fully configured.
  if (localStorage.getItem(key)) return;

  try {
    // Check whether secret storage is already configured on this account.
    // If it is, we don't try to overwrite it — we'd need the existing key to
    // do so safely, and that key may belong to another client (e.g. Element).
    const isReady = await crypto.isSecretStorageReady();
    if (!isReady) {
      await crypto.bootstrapSecretStorage({
        createSecretStorageKey: async () => {
          const { keyInfo, privateKey } =
            await crypto.createRecoveryKeyFromPassphrase();
          const encoded = btoa(String.fromCharCode(...privateKey));
          localStorage.setItem(RECOVERY_KEY, encoded);
          return { keyInfo, privateKey };
        },
        // Creates a fresh server-side key backup so Megolm session keys are
        // recoverable if this device's local store is ever lost, and so
        // other devices/sessions can decrypt this device's historical
        // messages. Costs some /room_keys/keys/* traffic on startup — an
        // acceptable trade-off for not silently losing document content.
        setupNewKeyBackup: true,
      });
      // Backup now exists — start using it in this session immediately
      // rather than waiting for the next reload.
      await crypto.checkKeyBackupAndEnable().catch(() => {});
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage().catch(() => {});
    }
  } catch (err) {
    console.warn("[matrix] bootstrapSecretStorage failed (non-fatal):", err);
  }

  try {
    await crypto.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: async (makeRequest) => {
        const password = sessionStorage.getItem(LOGIN_PASSWORD_KEY) ?? "";
        try {
          await makeRequest({ type: "m.login.password", password });
        } catch {
          // UIA may not be required on all homeservers
        }
      },
    });
  } catch (err) {
    console.warn("[matrix] bootstrapCrossSigning failed (non-fatal):", err);
  }

  localStorage.setItem(key, "1");
}

export async function createMatrixClient(
  { accessToken, userId, deviceId }: CreateClientOptions,
  { isSessionRestore = false }: { isSessionRestore?: boolean } = {},
): Promise<MatrixClient> {
  if (_client) {
    _client.stopClient();
    _client = null;
  }

  const storeName = `${userId}:${deviceId}`;

  // During a session restore, verify the crypto store still exists on disk.
  // If it was wiped (e.g. browser cleared site data) while the localStorage
  // session survived, `initRustCrypto` would silently create a fresh store and
  // generate new OTKs starting from index 0 — colliding with the old OTKs
  // already registered on the homeserver for this deviceId.
  if (isSessionRestore && !(await cryptoStoreExists(storeName))) {
    try {
      const tempClient = sdk.createClient({ baseUrl: getHomeserverUrl(), accessToken, userId, deviceId });
      await tempClient.logout(false);
    } catch {
      // Best-effort server logout — carry on even if it fails
    }
    clearMatrixStorage();
    throw new Error("Crypto store was cleared — session reset, please log in again.");
  }

  const client = sdk.createClient({
    baseUrl: getHomeserverUrl(),
    accessToken,
    userId,
    deviceId,
    // getSecretStorageKey is called by the SDK whenever it needs to access
    // secret storage (key backup, cross-signing private keys, etc.).
    // Without this, bootstrapSecretStorage throws "No getSecretStorageKey
    // callback supplied" when existing secret storage is already on the account.
    cryptoCallbacks: {
      getSecretStorageKey: async ({ keys }) =>
        getSecretStorageKeyFromStorage(keys),
    },
  });

  // Each device gets its own IndexedDB store keyed by userId:deviceId.
  // Without this, a second login (new device ID) conflicts with the store
  // written for the previous device ID → "account in the store doesn't match".
  try {
    await client.initRustCrypto({ cryptoDatabasePrefix: storeName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("doesn't match the account in the constructor")) {
      // The local crypto store belongs to a different session. Wiping it and
      // re-initialising with the same deviceId would cause "one time key
      // already exists" errors: the new store generates OTKs starting at
      // index 0, but the server still has those key IDs from the old store.
      //
      // Fix: log the stale device out of the server (which purges its OTKs),
      // wipe the local store, clear the session, and let the auth flow
      // redirect to /login — the next login will obtain a fresh deviceId.
      await deleteIndexedDBStores(storeName);

      const rawSession = localStorage.getItem(SESSION_KEY);
      if (rawSession) {
        try {
          const s = JSON.parse(rawSession) as {
            accessToken: string;
            userId: string;
            deviceId: string;
          };
          // Unauthenticated-style client just to send the logout
          const tempClient = sdk.createClient({
            baseUrl: getHomeserverUrl(),
            accessToken: s.accessToken,
            userId: s.userId,
            deviceId: s.deviceId,
          });
          await tempClient.logout(false);
        } catch {
          // Best-effort — proceed even if the logout request fails
        }
      }

      clearMatrixStorage();
      throw new Error(
        "Crypto store mismatch — session cleared. Please log in again.",
      );
    } else {
      throw err;
    }
  }

  _client = client;

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      _client?.stopClient();
      _client = null;
    });
  }

  return client;
}

export async function startMatrixClient(client: MatrixClient): Promise<void> {
  await client.startClient({ initialSyncLimit: 20 });

  // Wait for the first PREPARED or SYNCING state before running crypto
  // bootstrap. bootstrapSecretStorage and bootstrapCrossSigning require an
  // active sync connection to upload keys to the homeserver — calling them
  // before startClient causes them to hang indefinitely.
  await new Promise<void>((resolve) => {
    const onSync = (state: string) => {
      if (state === "PREPARED" || state === "SYNCING") {
        client.off(ClientEvent.Sync, onSync);
        resolve();
      }
    };
    client.on(ClientEvent.Sync, onSync);
  });

  // Run bootstrap in the background — non-blocking for the login flow.
  bootstrapCrypto(client).catch((err) =>
    console.warn("[matrix] crypto bootstrap error:", err),
  );
}
