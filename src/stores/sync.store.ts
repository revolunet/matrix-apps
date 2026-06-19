import { create } from "zustand";

interface SyncState {
  syncState: string;
  isReady: boolean;
  setSyncState: (state: string) => void;
  setReady: (ready: boolean) => void;
  reset: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  syncState: "STOPPED",
  isReady: false,
  setSyncState: (syncState) => set({ syncState }),
  setReady: (isReady) => set({ isReady }),
  reset: () => set({ syncState: "STOPPED", isReady: false }),
}));
