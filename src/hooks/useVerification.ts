import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth.store";

// CryptoEvent and VerifierEvent are not re-exported by the matrix-js-sdk main
// bundle — they live in the crypto-api submodule which Vite can't resolve when
// matrix-js-sdk is pre-bundled. Use the string literals directly instead.
const CRYPTO_EVENT_VERIFICATION_REQUEST = "crypto.verificationRequestReceived";
const VERIFIER_EVENT_SHOW_SAS = "show_sas";

// Local mirrors of the SDK verification types. We define them here to avoid
// fragile deep sub-path imports that vary across matrix-js-sdk minor versions.
interface VerificationRequestLike {
  otherUserId: string;
  otherDeviceId?: string;
  isSelfVerification: boolean;
  verifier?: VerifierLike;
  accept(): Promise<void>;
  cancel(opts?: { reason?: string; code?: string }): Promise<void>;
  startVerification(method: string): Promise<VerifierLike>;
}

interface VerifierLike {
  verify(): Promise<void>;
  cancel(err?: Error): void;
  on(event: string, listener: (data: unknown) => void): this;
  off(event: string, listener: (data: unknown) => void): this;
}

export interface SasData {
  emoji: Array<[string, string]> | undefined; // [emoji char, label]
  decimal: [number, number, number] | undefined;
  confirm(): Promise<void>;
  mismatch(): Promise<void>;
}

export type VerificationStep =
  | "requested"   // incoming request, waiting for user action
  | "accepting"   // calling accept() + starting verifier
  | "sas"         // showing emoji/decimal SAS to the user
  | "done"        // verification completed successfully
  | "cancelled";  // cancelled or error

export interface ActiveVerification {
  step: VerificationStep;
  otherUserId: string;
  otherDeviceId: string | undefined;
  isSelfVerification: boolean;
  sasData: SasData | null;
}

export function useVerification() {
  const client = useAuthStore((s) => s.client);
  const [verification, setVerification] = useState<ActiveVerification | null>(null);
  // Keep the raw request/verifier outside React state to avoid serialisation issues
  const [pendingRequest, setPendingRequest] =
    useState<VerificationRequestLike | null>(null);

  useEffect(() => {
    if (!client) return;

    const onRequest = (req: unknown) => {
      const r = req as VerificationRequestLike;
      setPendingRequest(r);
      setVerification({
        step: "requested",
        otherUserId: r.otherUserId,
        otherDeviceId: r.otherDeviceId,
        isSelfVerification: r.isSelfVerification,
        sasData: null,
      });
    };

    client.on(
      CRYPTO_EVENT_VERIFICATION_REQUEST as Parameters<typeof client.on>[0],
      onRequest,
    );
    return () =>
      client.off(
        CRYPTO_EVENT_VERIFICATION_REQUEST as Parameters<typeof client.on>[0],
        onRequest,
      );
  }, [client]);

  const accept = async () => {
    if (!pendingRequest) return;
    setVerification((v) => v && { ...v, step: "accepting" });

    try {
      await pendingRequest.accept();

      // The other side may have already started a verifier; prefer it over ours.
      let verifier: VerifierLike =
        pendingRequest.verifier ??
        (await pendingRequest.startVerification("m.sas.v1"));

      const onShowSas = (raw: unknown) => {
        const cb = raw as {
          sas: {
            emoji?: Array<[string, string]>;
            decimal?: [number, number, number];
          };
          confirm(): Promise<void>;
          mismatch(): Promise<void>;
        };
        setVerification((v) =>
          v
            ? {
                ...v,
                step: "sas",
                sasData: {
                  emoji: cb.sas.emoji,
                  decimal: cb.sas.decimal,
                  confirm: () => cb.confirm(),
                  mismatch: () => cb.mismatch(),
                },
              }
            : null,
        );
      };

      verifier.on(VERIFIER_EVENT_SHOW_SAS, onShowSas);

      verifier
        .verify()
        .then(() => {
          setVerification((v) => v && { ...v, step: "done", sasData: null });
          setTimeout(() => {
            setVerification(null);
            setPendingRequest(null);
          }, 4000);
        })
        .catch(() => {
          setVerification((v) => v && { ...v, step: "cancelled", sasData: null });
          setTimeout(() => {
            setVerification(null);
            setPendingRequest(null);
          }, 2000);
        });
    } catch (err) {
      console.error("[verification] accept error:", err);
      setVerification((v) => v && { ...v, step: "cancelled" });
      setTimeout(() => {
        setVerification(null);
        setPendingRequest(null);
      }, 2000);
    }
  };

  const decline = async () => {
    try {
      await pendingRequest?.cancel({ reason: "User declined" });
    } catch {
      // best-effort
    }
    setVerification(null);
    setPendingRequest(null);
  };

  const confirm = async () => {
    if (!verification?.sasData) return;
    await verification.sasData.confirm();
    // The verifier.verify() promise will resolve and set "done" automatically.
  };

  const mismatch = async () => {
    if (!verification?.sasData) return;
    await verification.sasData.mismatch();
    setVerification((v) => v && { ...v, step: "cancelled" });
    setTimeout(() => {
      setVerification(null);
      setPendingRequest(null);
    }, 2000);
  };

  return { verification, accept, decline, confirm, mismatch };
}
