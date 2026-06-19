import * as sdk from "matrix-js-sdk";
import { ClientEvent } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";
import { getHomeserverUrl } from "@/lib/constants";

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

// Decode the recovery key we previously stored in sessionStorage and return
// it in the format the SDK expects: [keyId, privateKey].
// Returns null if the key isn't available — the SDK will then fall through to
// createSecretStorageKey (if provided) or error if neither is available.
function getSecretStorageKeyFromSession(
  keys: Record<string, unknown>,
): [string, Uint8Array] | null {
  const encoded = sessionStorage.getItem("matrix_recovery_key");
  if (!encoded) return null;
  try {
    const binary = atob(encoded);
    const privateKey = new Uint8Array(binary.length);
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
  const key = bootstrapKey(client.getUserId()!, client.getDeviceId()!);
  // Use localStorage (not sessionStorage) so the guard survives tab close.
  // Without this, bootstrap runs on every new session even when secret
  // storage and cross-signing are already fully configured.
  if (localStorage.getItem(key)) return;

  const crypto = client.getCrypto();
  if (!crypto) return;

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
          sessionStorage.setItem("matrix_recovery_key", encoded);
          return { keyInfo, privateKey };
        },
        setupNewKeyBackup: true,
      });
    }
  } catch (err) {
    console.warn("[matrix] bootstrapSecretStorage failed (non-fatal):", err);
  }

  try {
    await crypto.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: async (makeRequest) => {
        const password = sessionStorage.getItem("matrix_login_password") ?? "";
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

export async function createMatrixClient({
  accessToken,
  userId,
  deviceId,
}: CreateClientOptions): Promise<MatrixClient> {
  if (_client) {
    _client.stopClient();
    _client = null;
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
        getSecretStorageKeyFromSession(keys),
    },
  });

  // Each device gets its own IndexedDB store keyed by userId:deviceId.
  // Without this, a second login (new device ID) conflicts with the store
  // written for the previous device ID → "account in the store doesn't match".
  const storeName = `${userId}:${deviceId}`;
  try {
    await client.initRustCrypto({ storeName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("doesn't match the account in the constructor")) {
      await deleteIndexedDBStores(storeName);
      await client.initRustCrypto({ storeName });
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
