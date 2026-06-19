import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { ContactsPage } from "@/pages/ContactsPage";
import { NewContactPage } from "@/pages/NewContactPage";
import { ContactDetailPage } from "@/pages/ContactDetailPage";
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
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/new" element={<NewContactPage />} />
          <Route path="/contacts/:contactId" element={<ContactDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/contacts" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
