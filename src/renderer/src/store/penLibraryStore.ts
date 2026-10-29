import { create } from "zustand";
import { persist } from "zustand/middleware";
import { parsePenProfile, readPenLibrary, type PenProfile } from "../../../types/pens";

interface PenLibraryState {
  pens: PenProfile[];
  savePen: (pen: PenProfile) => void;
  removePen: (id: string) => void;
}

/** User library outlives canvas layouts; layout profiles are detached snapshots. */
export const usePenLibraryStore = create<PenLibraryState>()(persist((set, get) => ({
  pens: [],
  savePen: (value) => {
    const pen = parsePenProfile(value);
    if (!get().pens.some((entry) => entry.id === pen.id) && get().pens.length >= 500) throw new Error("The pen library can hold up to 500 pens.");
    set((state) => ({ pens: [...state.pens.filter((entry) => entry.id !== pen.id), pen] }));
  },
  removePen: (id) => set((state) => ({ pens: state.pens.filter((pen) => pen.id !== id) })),
}), {
  name: "terraforge-pen-library",
  version: 1,
  partialize: (state) => ({ pens: state.pens }),
  merge: (persisted, current) => ({
    ...current, pens: readPenLibrary(persisted && typeof persisted === "object" ? (persisted as { pens?: unknown }).pens : undefined),
  }),
}));
