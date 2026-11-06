import { WorkspaceShell } from "../components/layout/WorkspaceShell";
import { WelcomeScreen } from "../features/projects/components/WelcomeScreen";
import { useWorkspace } from "../stores/workspace.store";

export function AppRouter() {
  const { project, workspaceReady } = useWorkspace();
  return workspaceReady && project ? <WorkspaceShell /> : <WelcomeScreen />;
}
