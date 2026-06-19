import { useAuthStore } from "@/stores/auth.store";
import { useSyncStore } from "@/stores/sync.store";
import { logout } from "@/matrix/auth";

export function Header() {
  const { client, userId, clearAuth } = useAuthStore();
  const syncState = useSyncStore((s) => s.syncState);
  const resetSync = useSyncStore((s) => s.reset);

  const dotColor =
    syncState === "SYNCING" || syncState === "PREPARED"
      ? "bg-green-500"
      : syncState === "RECONNECTING" || syncState === "CATCHUP"
        ? "bg-yellow-400"
        : "bg-red-500";

  const handleLogout = async () => {
    if (!client) return;
    await logout(client);
    resetSync();
    clearAuth();
  };

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${dotColor}`}
          title={syncState}
        />
        <span className="text-xs text-gray-500">{syncState}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-700 font-mono">{userId}</span>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-black"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
