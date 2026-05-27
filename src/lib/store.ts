import { create } from "zustand";

// UI state that's purely client-side (open menus, focused panels, etc.).
// Server data lives in tRPC / React Query; don't put it here.

type UiState = {
  sidebarMobileOpen: boolean;
  setSidebarMobileOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  sidebarMobileOpen: false,
  setSidebarMobileOpen: (open) => set({ sidebarMobileOpen: open }),
}));
