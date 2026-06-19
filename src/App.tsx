// Register all entities at startup (import order matters for registry)
import "@/entities/contact/config";
import "@/entities/company/config";
import "@/entities/training/config";

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { EntityLayout } from "@/components/layout/EntityLayout";
import { LoginPage } from "@/pages/LoginPage";
import { EntityListPage } from "@/pages/EntityListPage";
import { NewEntityPage } from "@/pages/NewEntityPage";
import { EntityDetailPage } from "@/pages/EntityDetailPage";
import { useEffect } from "react";
import { initializeSession } from "@/matrix/auth";
import { useAuthStore } from "@/stores/auth.store";

function SessionLoader() {
  const { setClient, setLoginState, loginState } = useAuthStore();

  useEffect(() => {
    if (loginState !== "idle") return;
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
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/contacts" replace />} />
          <Route path="/:entityType" element={<EntityLayout />}>
            <Route index element={<EntityListPage />} />
            <Route path="new" element={<NewEntityPage />} />
            <Route path=":entityId" element={<EntityDetailPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/contacts" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
