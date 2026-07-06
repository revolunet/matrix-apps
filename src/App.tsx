// Register all entities at startup (import order matters for registry)
import "@/entities/contact/config";
import "@/entities/company/config";
import "@/entities/training/config";

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { EntityLayout } from "@/components/layout/EntityLayout";
import { LoginPage } from "@/pages/LoginPage";
import { HomePage } from "@/pages/HomePage";
import { EntityListPage } from "@/pages/EntityListPage";
import { NewEntityPage } from "@/pages/NewEntityPage";
import { EntityDetailPage } from "@/pages/EntityDetailPage";
import { DocsLayout } from "@/features/docs/DocsLayout";
import { DocsHomePage } from "@/features/docs/DocsHomePage";
import { DocEditorPage } from "@/features/docs/DocEditorPage";
import { useEffect, useRef } from "react";
import { initializeSession } from "@/matrix/auth";
import { useAuthStore } from "@/stores/auth.store";

function SessionLoader() {
  const { setClient, setLoginState, loginState } = useAuthStore();
  // React 18 StrictMode (dev only) fires this effect twice in a row on
  // mount. Without this guard, two concurrent initializeSession() calls
  // race on the same IndexedDB crypto store — initRustCrypto sees the store
  // being written by the other call and throws "account in the store
  // doesn't match", which force-clears the session. The ref (unlike a
  // module/state var) survives the double-invoke since the component isn't
  // actually remounted, so the second invocation is a no-op.
  const startedRef = useRef(false);

  useEffect(() => {
    if (loginState !== "idle" || startedRef.current) return;
    startedRef.current = true;
    setLoginState("loading");
    initializeSession()
      .then((client) => {
        if (client) {
          const userId = client.getUserId() ?? "";
          const deviceId = client.getDeviceId() ?? "";
          setClient(client, userId, deviceId);
        } else {
          setLoginState("unauthenticated");
        }
      })
      .catch(() => setLoginState("unauthenticated"));
  }, [loginState, setClient, setLoginState]);

  return null;
}

function App() {
  return (
    <BrowserRouter>
      <SessionLoader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/docs" element={<DocsLayout />}>
            <Route index element={<DocsHomePage />} />
            <Route path=":docId" element={<DocEditorPage />} />
          </Route>
          <Route path="/:entityType" element={<EntityLayout />}>
            <Route index element={<EntityListPage />} />
            <Route path="new" element={<NewEntityPage />} />
            <Route path=":entityId" element={<EntityDetailPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
