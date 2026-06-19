import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store";
import { useContactSync } from "@/hooks/useContactSync";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { VerificationBanner } from "@/components/verification/VerificationBanner";

export function AppLayout() {
  const loginState = useAuthStore((s) => s.loginState);
  useContactSync();

  // While the SessionLoader in App.tsx is restoring a saved session
  // ("idle" → async init → "authenticated"), render a spinner instead of
  // redirecting. Redirecting on "idle" sends the user to /login before the
  // async restore has a chance to run, because React effects fire after paint.
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
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
      <VerificationBanner />
    </div>
  );
}
