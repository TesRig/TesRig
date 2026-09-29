import { createContext, createElement, useContext, type ReactNode } from "react";

export interface BoundaryBoxControls {
  geometryReady: boolean;
  isEditing: boolean;
  createSetupBox: () => void;
  optimizeBox: () => void;
  setEditing: (editing: boolean) => void;
}

const BoundaryBoxControlsContext = createContext<BoundaryBoxControls | null>(null);

export function BoundaryBoxControlsProvider({
  value,
  children,
}: {
  value: BoundaryBoxControls;
  children: ReactNode;
}) {
  return createElement(BoundaryBoxControlsContext.Provider, { value }, children);
}

export function useBoundaryBoxControls() {
  return useContext(BoundaryBoxControlsContext);
}
