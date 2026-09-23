import { useCallback, useEffect, useState } from "react";
import appIconUrl from "../../../src-tauri/icons/app-icon.svg";
import { NewCaseDialog } from "../../features/cases/components/NewCaseDialog";
import { CaseWorkspace } from "../../features/cases/components/CaseWorkspace";
import { getSimulationLog } from "../../features/cases/case.api";
import type { SimulationJob, SimulationLog } from "../../features/cases/case.types";
import {
  chooseGeometryFile,
  importGeometry,
  removeGeometry,
} from "../../features/geometry/geometry.api";
import { ProjectOverview } from "../../features/projects/components/ProjectOverview";
import {
  closeProject,
  saveProject,
  updateProjectSettings,
} from "../../features/projects/project.api";
import type { UpAxis } from "../../features/projects/project.types";
import { toUserMessage } from "../../lib/errors/app-error";
import { useWorkspace } from "../../stores/workspace.store";
import { Button } from "../common/Button";
import { StatusBar } from "../common/StatusBar";
import { Modal } from "../dialogs/Modal";

export function WorkspaceShell() {
  const { project, activeCaseId, activeCase, selectCase, setProject, syncProject } = useWorkspace();
  const [showNewCase, setShowNewCase] = useState(false);
  const [variantOfCaseId, setVariantOfCaseId] = useState<string | null>(null);
  const [selectedGeometryId, setSelectedGeometryId] = useState<string | null>(
    project?.geometries[0]?.id ?? null,
  );
  const [selectedTreeId, setSelectedTreeId] = useState("geometry");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Project ready");
  const [statusError, setStatusError] = useState(false);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const [simulationJob, setSimulationJob] = useState<SimulationJob | null>(null);
  const [showSimulationLog, setShowSimulationLog] = useState(false);
  const [simulationLog, setSimulationLog] = useState<SimulationLog | null>(null);

  const reportSimulation = useCallback((job: SimulationJob | null) => {
    setSimulationJob(job);
  }, []);

  useEffect(() => {
    if (!project) return;
    if (!project.geometries.some(({ id }) => id === selectedGeometryId)) {
      setSelectedGeometryId(project.geometries[0]?.id ?? null);
    }
  }, [project, selectedGeometryId]);

  useEffect(() => {
    if (!showSimulationLog || !simulationJob) return;
    let disposed = false;
    const refresh = () => {
      void getSimulationLog()
        .then((log) => {
          if (!disposed) setSimulationLog(log);
        })
        .catch((error) => {
          if (!disposed) setSimulationLog({ stdout: "", stderr: toUserMessage(error) });
        });
    };
    refresh();
    const active = ["Starting", "Running", "Cancelling"].includes(simulationJob.status);
    const interval = active ? window.setInterval(refresh, 1000) : undefined;
    return () => {
      disposed = true;
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [showSimulationLog, simulationJob]);

  if (!project) return null;
  const projectId = project.id;
  const projectSettings = project.settings;
  const selectedGeometry =
    project.geometries.find(({ id }) => id === selectedGeometryId) ?? project.geometries[0];
  const currentViewName = activeCase ? `Case / ${activeCase.name}` : "Geometry";

  function reportStatus(message: string, isError = false) {
    const displayMessage = message.replace(/&#x20;|&#32;/gi, " ").trim();
    setStatus(isError ? (displayMessage.split(/\r?\n/, 1)[0] ?? displayMessage) : displayMessage);
    setStatusError(isError);
    if (isError) setErrorDialog(displayMessage);
  }

  function openGeometry(geometryId?: string) {
    if (geometryId) setSelectedGeometryId(geometryId);
    setSelectedTreeId(geometryId ? `geometry:${geometryId}` : "geometry");
    selectCase(null);
  }

  function openCase(caseId: string) {
    setSelectedTreeId(`case:${caseId}`);
    selectCase(caseId);
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

  async function handleUpAxisChange(upAxis: UpAxis) {
    reportStatus(`Setting ${upAxis} as the project up axis…`);
    try {
      syncProject(
        await updateProjectSettings({
          projectId,
          settings: { ...projectSettings, upAxis },
        }),
      );
      reportStatus(`${upAxis}-up saved in project settings.`);
    } catch (error) {
      reportStatus(toUserMessage(error), true);
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

  async function handleAddGeometry() {
    const sourcePath = await chooseGeometryFile();
    if (typeof sourcePath !== "string") return;
    setBusy(true);
    reportStatus("Importing geometry…");
    try {
      const updated = await importGeometry({ projectId, sourcePath });
      syncProject(updated);
      const imported = updated.geometries.at(-1);
      if (imported) openGeometry(imported.id);
      reportStatus(`Imported “${imported?.name ?? "geometry"}”.`);
    } catch (error) {
      reportStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveGeometry() {
    if (!selectedGeometry) return;
    const assignedCases = (project?.cases ?? []).filter(
      ({ geometryId }) => geometryId === selectedGeometry.id,
    );
    const assignmentWarning = assignedCases.length
      ? ` It will also be unassigned from ${assignedCases.length} case${assignedCases.length === 1 ? "" : "s"}.`
      : "";
    if (
      !window.confirm(`Remove “${selectedGeometry.name}” from this project?${assignmentWarning}`)
    ) {
      return;
    }

    setBusy(true);
    reportStatus(`Removing “${selectedGeometry.name}”…`);
    try {
      const updated = await removeGeometry(projectId, selectedGeometry.id);
      syncProject(updated);
      setSelectedGeometryId(updated.geometries[0]?.id ?? null);
      reportStatus(`Removed “${selectedGeometry.name}”.`);
    } catch (error) {
      reportStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  function startNewCase(variantId: string | null = null) {
    setVariantOfCaseId(variantId);
    setShowNewCase(true);
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar__brand">
          <img src={appIconUrl} alt="" className="titlebar__icon" />
          <strong>TesRig</strong>
        </div>
        <div className="titlebar__context" title={project.archivePath}>
          <span>{project.name}</span>
          <span className="titlebar__separator">/</span>
          <strong>{currentViewName}</strong>
        </div>
        <div className="titlebar__project-path">{project.archivePath}</div>
      </header>

      <nav className="command-bar" aria-label="Workspace commands">
        <div className="command-group">
          <span className="command-group__label">Project</span>
          <Button variant="ghost" onClick={handleSave} disabled={busy}>
            <span className="command-icon" aria-hidden="true">
              ▣
            </span>
            {busy ? "Working…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            <span className="command-icon" aria-hidden="true">
              ×
            </span>
            Close
          </Button>
        </div>
        <div className={`command-group ${!activeCase ? "is-context" : ""}`}>
          <span className="command-group__label">Geometry</span>
          <Button variant="ghost" onClick={handleAddGeometry} disabled={busy}>
            <span className="command-icon" aria-hidden="true">
              ＋
            </span>
            Add geometry
          </Button>
          <Button
            variant="ghost"
            onClick={handleRemoveGeometry}
            disabled={busy || !selectedGeometry || activeCaseId !== null}
          >
            <span className="command-icon" aria-hidden="true">
              −
            </span>
            Remove
          </Button>
          <Button variant="ghost" disabled title="Mates will be available in a future release">
            <span className="command-icon" aria-hidden="true">
              ⌁
            </span>
            Add mate
          </Button>
        </div>
        <div className={`command-group ${activeCase ? "is-context" : ""}`}>
          <span className="command-group__label">Case</span>
          <Button variant="ghost" onClick={() => startNewCase()} disabled={busy}>
            <span className="command-icon" aria-hidden="true">
              ＋
            </span>
            New case
          </Button>
          {activeCase && (
            <Button variant="ghost" onClick={() => startNewCase(activeCase.id)} disabled={busy}>
              <span className="command-icon" aria-hidden="true">
                ◇
              </span>
              Create variant
            </Button>
          )}
        </div>
        <div className="command-bar__view">
          <span>Current view</span>
          <strong>{currentViewName}</strong>
        </div>
      </nav>

      <div className={`app-shell__body ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
        <aside className="sidebar" aria-label="Project navigator">
          <div className="sidebar__header">
            {!sidebarCollapsed && <span>Project navigator</span>}
            <button
              className="sidebar__collapse"
              type="button"
              aria-label={
                sidebarCollapsed ? "Expand project navigator" : "Collapse project navigator"
              }
              title={sidebarCollapsed ? "Expand project navigator" : "Collapse project navigator"}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
          </div>

          {sidebarCollapsed ? (
            <div className="sidebar__rail" aria-hidden="true">
              <span>◇</span>
              <span>▤</span>
            </div>
          ) : (
            <div className="project-tree">
              <p className="project-tree__hint">Double-click an item to open its view</p>
              <details className="project-tree__branch project-tree__root" open>
                <summary onDoubleClick={() => openGeometry()}>
                  <span className="tree-icon tree-icon--project">T</span>
                  <span>{project.name}</span>
                </summary>

                <details className="project-tree__branch" open>
                  <summary
                    className={activeCaseId === null ? "is-active" : ""}
                    onClick={() => setSelectedTreeId("geometry")}
                    onDoubleClick={() => openGeometry()}
                  >
                    <span className="tree-icon">◇</span>
                    <span>Geometry</span>
                    <small>{project.geometries.length}</small>
                  </summary>
                  {project.geometries.length === 0 ? (
                    <span className="project-tree__empty">No geometry</span>
                  ) : (
                    project.geometries.map((geometry) => (
                      <button
                        key={geometry.id}
                        type="button"
                        className={`project-tree__leaf ${selectedTreeId === `geometry:${geometry.id}` || (activeCaseId === null && selectedGeometry?.id === geometry.id) ? "is-selected" : ""}`}
                        onClick={() => {
                          setSelectedTreeId(`geometry:${geometry.id}`);
                          setSelectedGeometryId(geometry.id);
                        }}
                        onDoubleClick={() => openGeometry(geometry.id)}
                      >
                        <span className="tree-icon tree-icon--file">◆</span>
                        <span>{geometry.name}</span>
                        <small>{geometry.format}</small>
                      </button>
                    ))
                  )}
                </details>

                <details className="project-tree__branch" open>
                  <summary>
                    <span className="tree-icon">▤</span>
                    <span>Cases</span>
                    <small>{project.cases.length}</small>
                  </summary>
                  {project.cases.length === 0 ? (
                    <span className="project-tree__empty">No cases</span>
                  ) : (
                    project.cases.map((simulationCase) => (
                      <details
                        className="project-tree__branch project-tree__case"
                        key={simulationCase.id}
                      >
                        <summary
                          className={activeCaseId === simulationCase.id ? "is-active" : ""}
                          onClick={() => setSelectedTreeId(`case:${simulationCase.id}`)}
                          onDoubleClick={() => openCase(simulationCase.id)}
                        >
                          <span className="tree-icon tree-icon--case">C</span>
                          <span>{simulationCase.name}</span>
                          <small>{simulationCase.status}</small>
                        </summary>
                        {["Geometry", "Setup", "Analyze", "Results"].map((stage) => (
                          <button
                            key={stage}
                            type="button"
                            className="project-tree__leaf project-tree__stage"
                            onDoubleClick={() => openCase(simulationCase.id)}
                          >
                            <span className="tree-icon">·</span>
                            <span>{stage}</span>
                          </button>
                        ))}
                      </details>
                    ))
                  )}
                </details>
              </details>
            </div>
          )}
        </aside>

        <main className="main-workspace">
          {activeCase ? (
            <CaseWorkspace
              simulationCase={activeCase}
              onStatus={reportStatus}
              onSimulationChange={reportSimulation}
              onCreateVariant={(caseId) => startNewCase(caseId)}
              onUpAxisChange={handleUpAxisChange}
            />
          ) : (
            <ProjectOverview
              project={project}
              selectedGeometryId={selectedGeometry?.id ?? null}
              onGeometryChange={setSelectedGeometryId}
              onAddGeometry={handleAddGeometry}
              onUpAxisChange={handleUpAxisChange}
              busy={busy}
            />
          )}
        </main>
      </div>

      <StatusBar
        message={status}
        tone={statusError ? "error" : "neutral"}
        simulation={simulationJob}
        onViewLogs={() => setShowSimulationLog(true)}
      />
      {showSimulationLog && (
        <Modal title="OpenFOAM logs" onClose={() => setShowSimulationLog(false)}>
          <div className="modal__body simulation-log-viewer">
            <div className="simulation-log-viewer__heading">
              <strong>{simulationJob?.stage ?? "Simulation"}</strong>
              <span>{Math.round(simulationJob?.progress ?? 0)}%</span>
            </div>
            <pre>{simulationLog?.stdout || "Waiting for OpenFOAM output…"}</pre>
            {simulationLog?.stderr && (
              <>
                <strong className="simulation-log-viewer__stderr-title">Errors and warnings</strong>
                <pre className="simulation-log-viewer__stderr">{simulationLog.stderr}</pre>
              </>
            )}
          </div>
          <footer className="modal__actions">
            <Button variant="primary" onClick={() => setShowSimulationLog(false)}>
              Close
            </Button>
          </footer>
        </Modal>
      )}
      {errorDialog && (
        <Modal title="TesRig couldn’t complete that action" onClose={() => setErrorDialog(null)}>
          <div className="modal__body error-dialog__body">
            <span className="error-dialog__icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>What went wrong</strong>
              <p>{errorDialog}</p>
            </div>
          </div>
          <footer className="modal__actions">
            <Button variant="primary" onClick={() => setErrorDialog(null)} autoFocus>
              OK
            </Button>
          </footer>
        </Modal>
      )}
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
