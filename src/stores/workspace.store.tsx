import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { SimulationCase } from "../features/cases/case.types";
import type { ProjectSummary } from "../features/projects/project.types";

interface WorkspaceContextValue {
  project: ProjectSummary | null;
  activeCaseId: string | null;
  activeCase: SimulationCase | null;
  setProject: (project: ProjectSummary | null) => void;
  selectCase: (caseId: string | null) => void;
  addCase: (simulationCase: SimulationCase) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [project, setProjectState] = useState<ProjectSummary | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);

  const setProject = useCallback((nextProject: ProjectSummary | null) => {
    setProjectState(nextProject);
    setActiveCaseId(nextProject?.cases[0]?.id ?? null);
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

  const activeCase = project?.cases.find(({ id }) => id === activeCaseId) ?? null;
  const value = useMemo(
    () => ({ project, activeCaseId, activeCase, setProject, selectCase: setActiveCaseId, addCase }),
    [project, activeCaseId, activeCase, setProject, addCase],
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
