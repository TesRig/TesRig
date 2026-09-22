import { useState } from "react";
import { NewCaseDialog } from "../../features/cases/components/NewCaseDialog";
import { CaseWorkspace } from "../../features/cases/components/CaseWorkspace";
import { ProjectOverview } from "../../features/projects/components/ProjectOverview";
import { closeProject, saveProject } from "../../features/projects/project.api";
import { toUserMessage } from "../../lib/errors/app-error";
import { useWorkspace } from "../../stores/workspace.store";
import { Button } from "../common/Button";
import { StatusBar } from "../common/StatusBar";

export function WorkspaceShell() {
  const { project, activeCaseId, activeCase, selectCase, setProject, syncProject } = useWorkspace();
  const [showNewCase, setShowNewCase] = useState(false);
  const [variantOfCaseId, setVariantOfCaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Project ready");
  const [statusError, setStatusError] = useState(false);

  if (!project) return null;
  const projectId = project.id;

  function reportStatus(message: string, isError = false) {
    setStatus(message);
    setStatusError(isError);
  }

  async function handleSave() {
    setBusy(true);
    reportStatus("Saving project…");
    try {
      syncProject(await saveProject({ projectId }));
      reportStatus("Project saved.");
    } catch (error) {
      reportStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    setBusy(true);
    reportStatus("Closing project…");
    try {
      await closeProject();
      setProject(null);
    } catch (error) {
      reportStatus(toUserMessage(error), true);
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <button className="wordmark" onClick={() => selectCase(null)}>
          <span className="wordmark__mark">T</span>
          TesRig
        </button>
        <div className="titlebar__project">
          <span>{project.name}</span>
          <span className="titlebar__path" title={project.archivePath}>
            {project.archivePath}
          </span>
        </div>
        <div className="titlebar__actions">
          <Button variant="ghost" onClick={handleSave} disabled={busy}>
            {busy ? "Working…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Close
          </Button>
        </div>
      </header>

      <div className="app-shell__body">
        <aside className="sidebar">
          <button
            className={`sidebar__project ${activeCaseId === null ? "is-active" : ""}`}
            onClick={() => selectCase(null)}
          >
            <span className="sidebar__label">Project</span>
            <strong>{project.name}</strong>
          </button>
          <div className="sidebar__section-heading">
            <span>Cases</span>
            <span className="count-badge">{project.cases.length}</span>
          </div>
          <nav className="case-list" aria-label="Project cases">
            {project.cases.length === 0 && <p className="case-list__empty">No cases created</p>}
            {project.cases.map((simulationCase) => (
              <button
                key={simulationCase.id}
                className={`case-list__item ${activeCaseId === simulationCase.id ? "is-active" : ""}`}
                onClick={() => selectCase(simulationCase.id)}
              >
                <span className="case-list__icon">◇</span>
                <span>
                  <strong>{simulationCase.name}</strong>
                  <small>{simulationCase.status}</small>
                </span>
              </button>
            ))}
          </nav>
          <Button
            className="sidebar__new-case"
            onClick={() => {
              setVariantOfCaseId(null);
              setShowNewCase(true);
            }}
            disabled={busy}
          >
            + New Case
          </Button>
        </aside>

        <main className="main-workspace">
          {activeCase ? (
            <CaseWorkspace
              simulationCase={activeCase}
              onStatus={reportStatus}
              onCreateVariant={(caseId) => {
                setVariantOfCaseId(caseId);
                setShowNewCase(true);
              }}
            />
          ) : (
            <ProjectOverview project={project} onStatus={reportStatus} />
          )}
        </main>
      </div>

      <StatusBar message={status} tone={statusError ? "error" : "neutral"} />
      {showNewCase && (
        <NewCaseDialog
          variantOfCaseId={variantOfCaseId}
          onClose={() => {
            setShowNewCase(false);
            setVariantOfCaseId(null);
          }}
          onStatus={reportStatus}
        />
      )}
    </div>
  );
}
