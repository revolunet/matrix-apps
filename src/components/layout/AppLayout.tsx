import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store";
import { useEntitySync } from "@/hooks/useEntitySync";
import { useVerification } from "@/hooks/useVerification";
import { startGlobalDocResyncResponder } from "@/matrix/global-doc-resync";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { VerificationBanner } from "@/components/verification/VerificationBanner";

export function AppLayout() {
  const loginState = useAuthStore((s) => s.loginState);
  const client = useAuthStore((s) => s.client);
  useEntitySync();
  // Single instance shared between Header (which can *start* a request) and
  // VerificationBanner (which displays/drives it) — each calling
  // useVerification() separately would give them independent state and the
  // banner would never see a request Header initiated.
  const verificationState = useVerification();

  // Mounted once for the whole session (not per-document, unlike
  // MatrixYjsProvider) so this account can answer a resync request for any
  // of its documents, not just whichever one happens to be open right now
  // — see global-doc-resync.ts.
  useEffect(() => {
    if (!client) return;
    return startGlobalDocResyncResponder(client);
  }, [client]);

  if (loginState === "idle" || loginState === "loading") {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-400">
        Connecting to Matrix...
      </div>
    );
  }

  if (loginState === "unauthenticated" || loginState === "error") {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Header
          hasActiveVerification={verificationState.verification !== null}
          requestSelfVerification={verificationState.requestSelfVerification}
        />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <VerificationBanner {...verificationState} />
    </div>
  );
}
