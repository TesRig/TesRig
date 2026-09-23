import { WorkspaceShell } from "../components/layout/WorkspaceShell";
import { WelcomeScreen } from "../features/projects/components/WelcomeScreen";
import { useWorkspace } from "../stores/workspace.store";

export function AppRouter() {
  const { project, workspaceReady } = useWorkspace();
  if (!workspaceReady) return null;
  return project ? <WorkspaceShell /> : <WelcomeScreen />;
}
