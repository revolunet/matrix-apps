import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store";
import { useEntitySync } from "@/hooks/useEntitySync";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { VerificationBanner } from "@/components/verification/VerificationBanner";

export function AppLayout() {
  const loginState = useAuthStore((s) => s.loginState);
  useEntitySync();

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
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <VerificationBanner />
    </div>
  );
}
