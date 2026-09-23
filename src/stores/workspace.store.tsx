import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  type PropsWithChildren,
} from "react";
import type { SimulationCase } from "../features/cases/case.types";
import type { ProjectSummary } from "../features/projects/project.types";
import { getCurrentProject } from "../features/projects/project.api";

interface WorkspaceContextValue {
  project: ProjectSummary | null;
  workspaceReady: boolean;
  activeCaseId: string | null;
  activeCase: SimulationCase | null;
  setProject: (project: ProjectSummary | null) => void;
  selectCase: (caseId: string | null) => void;
  addCase: (simulationCase: SimulationCase) => void;
  syncProject: (project: ProjectSummary) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [project, setProjectState] = useState<ProjectSummary | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    void getCurrentProject()
      .then((current) => {
        if (disposed || !current) return;
        setProjectState(current);
        setActiveCaseId(current.cases[0]?.id ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setWorkspaceReady(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const setProject = useCallback((nextProject: ProjectSummary | null) => {
    setProjectState(nextProject);
    // Opening or creating a project always returns to the project geometry
    // workspace. Cases are selected explicitly from the navigator.
    setActiveCaseId(null);
  }, []);

  const addCase = useCallback((simulationCase: SimulationCase) => {
    setProjectState((current) =>
      current
        ? {
            ...current,
            updatedAt: simulationCase.updatedAt,
            cases: [...current.cases, simulationCase],
          }
        : current,
    );
    setActiveCaseId(simulationCase.id);
  }, []);

  const syncProject = useCallback((nextProject: ProjectSummary) => {
    setProjectState(nextProject);
    setActiveCaseId((current) =>
      current && nextProject.cases.some(({ id }) => id === current) ? current : null,
    );
  }, []);

  const activeCase = project?.cases.find(({ id }) => id === activeCaseId) ?? null;
  const value = useMemo(
    () => ({
      project,
      workspaceReady,
      activeCaseId,
      activeCase,
      setProject,
      selectCase: setActiveCaseId,
      addCase,
      syncProject,
    }),
    [project, workspaceReady, activeCaseId, activeCase, setProject, addCase, syncProject],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

// This hook intentionally shares the context module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return value;
}
