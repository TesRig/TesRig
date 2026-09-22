import type { PropsWithChildren } from "react";
import { WorkspaceProvider } from "../stores/workspace.store";

export function AppProviders({ children }: PropsWithChildren) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
