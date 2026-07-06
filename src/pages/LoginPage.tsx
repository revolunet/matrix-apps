import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register, getLastUsername } from "@/matrix/auth";
import { createMatrixClient, startMatrixClient } from "@/matrix/client";
import { useAuthStore } from "@/stores/auth.store";
import { getHomeserverUrl, setHomeserverUrl } from "@/lib/constants";

type Mode = "login" | "register";

export function LoginPage() {
  const navigate = useNavigate();
  const { setClient, setLoginState, loginState } = useAuthStore();

  // If SessionLoader restores a session while we're sitting on /login
  // (e.g. the user navigated here manually while already authenticated),
  // forward them straight to /contacts.
  useEffect(() => {
    if (loginState === "authenticated") navigate("/contacts", { replace: true });
  }, [loginState, navigate]);

  const [mode, setMode] = useState<Mode>("login");

  // Login / Register fields
  const [username, setUsername] = useState(getLastUsername);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Homeserver editing
  const [homeserver, setHomeserver] = useState(getHomeserverUrl());
  const [editingHomeserver, setEditingHomeserver] = useState(false);
  const [homeserverDraft, setHomeserverDraft] = useState("");

  const openHomeserverEditor = () => {
    setHomeserverDraft(homeserver);
    setEditingHomeserver(true);
  };

  const saveHomeserver = () => {
    const trimmed = homeserverDraft.trim().replace(/\/$/, "");
    if (!trimmed) return;
    setHomeserverUrl(trimmed);
    setHomeserver(trimmed);
    setEditingHomeserver(false);
  };

  const cancelHomeserverEdit = () => {
    setEditingHomeserver(false);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setConfirmPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoginState("loading");

    try {
      let session;
      if (mode === "login") {
        session = await login(username, password);
      } else {
        session = await register(username, password);
      }
      const client = await createMatrixClient(session);
      await startMatrixClient(client);
      setClient(client, session.userId, session.deviceId);
      navigate("/contacts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setLoginState("error");
    }
  };

  const loading = loginState === "loading";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white border border-gray-200 rounded-lg p-8 w-full max-w-sm shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">Matrix CMS</h1>

        {/* Mode tabs */}
        <div className="flex border border-gray-200 rounded mb-6 overflow-hidden">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`flex-1 text-sm py-2 transition-colors ${
              mode === "login"
                ? "bg-black text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 text-sm py-2 transition-colors ${
              mode === "register"
                ? "bg-black text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={
                mode === "login" ? "@user:matrix.org" : "alice"
              }
              required
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white text-sm px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {loading
              ? mode === "login"
                ? "Connecting..."
                : "Registering..."
              : mode === "login"
              ? "Login"
              : "Create account"}
          </button>
        </form>

        {/* Homeserver section */}
        <div className="mt-5 pt-4 border-t border-gray-100">
          {editingHomeserver ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-600">
                Homeserver URL
              </label>
              <input
                type="url"
                value={homeserverDraft}
                onChange={(e) => setHomeserverDraft(e.target.value)}
                placeholder="https://matrix.org"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveHomeserver}
                  className="flex-1 bg-black text-white text-xs px-3 py-1.5 rounded hover:bg-gray-800"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelHomeserverEdit}
                  className="flex-1 border border-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 truncate max-w-[200px]">
                {homeserver}
              </span>
              <button
                type="button"
                onClick={openHomeserverEditor}
                className="text-xs text-blue-500 hover:text-blue-700 shrink-0 ml-2"
              >
                Change
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
