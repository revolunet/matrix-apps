// Implements Matrix's encrypted-attachment scheme (AES-256-CTR + SHA-256
// integrity hash): https://spec.matrix.org/latest/client-server-api/#sending-encrypted-attachments
// The key/iv only ever travel inside the E2E-encrypted room event: the
// ciphertext uploaded to the (untrusted) media repo is meaningless without them.

export interface EncryptedFileInfo {
  v: "v2";
  key: { alg: string; ext: boolean; k: string; key_ops: string[]; kty: string };
  iv: string;
  hashes: { sha256: string };
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.byteLength; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function fromBase64(str: string): Uint8Array<ArrayBuffer> {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return fromBase64(padded + pad);
}

export async function encryptAttachment(
  data: ArrayBuffer,
): Promise<{ ciphertext: ArrayBuffer; info: EncryptedFileInfo }> {
  // Per spec: 16-byte counter block, only the top 8 bytes are random — the
  // bottom 8 stay zero as the initial CTR counter value.
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8));

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CTR" }, true, [
    "encrypt",
    "decrypt",
  ]);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-CTR", counter: iv, length: 64 },
    cryptoKey,
    data,
  );
  const digest = await crypto.subtle.digest("SHA-256", ciphertext);

  return {
    ciphertext,
    info: {
      v: "v2",
      key: {
        alg: "A256CTR",
        ext: true,
        k: toBase64Url(rawKey),
        key_ops: ["encrypt", "decrypt"],
        kty: "oct",
      },
      iv: toBase64(iv),
      hashes: { sha256: toBase64(new Uint8Array(digest)) },
    },
  };
}

export async function decryptAttachment(
  ciphertext: ArrayBuffer,
  info: EncryptedFileInfo,
): Promise<ArrayBuffer> {
  const digest = await crypto.subtle.digest("SHA-256", ciphertext);
  if (toBase64(new Uint8Array(digest)) !== info.hashes.sha256) {
    throw new Error("Attachment failed integrity check — ciphertext does not match its hash");
  }

  const rawKey = fromBase64Url(info.key.k);
  const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CTR" }, false, [
    "decrypt",
  ]);
  const iv = fromBase64(info.iv);

  return crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 64 }, cryptoKey, ciphertext);
}
