import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/common/Button";
import { toUserMessage } from "../../../lib/errors/app-error";
import { useWorkspace } from "../../../stores/workspace.store";
import { GeometryViewer } from "../../geometry/components/GeometryViewer";
import { assignGeometry, chooseGeometryFile, importGeometry } from "../../geometry/geometry.api";
import { ensureGeometryTriangulated } from "../../geometry/step-geometry";
import type { UpAxis } from "../../projects/project.types";
import type { SimulationCase } from "../case.types";
import { resolveFlowDirection } from "../flow-direction";
import {
  chooseCaseExportDirectory,
  cancelSimulation,
  exportOpenFoamCase,
  getFlowSnapshot,
  getOpenFoamRuntime,
  getSimulationStatus,
  startSimulation,
  updateCaseSetup,
  validateCase,
} from "../case.api";
import { CfdSetupPanel } from "./CfdSetupPanel";
import type {
  FlowSnapshot,
  OpenFoamRuntimeStatus,
  SimulationJob,
  SimulationLog,
} from "../case.types";
import { FlowResultsViewer } from "./FlowResultsViewer";
import { OpenFoamGeometryInspector } from "./OpenFoamGeometryInspector";
import { ProcessingScriptsPanel } from "./ProcessingScriptsDialog";

const FLOW_SNAPSHOT_REFRESH_MS = 3000;

function generatedCaseStatus(warnings: string[]) {
  if (warnings.length === 0) return "OpenFOAM case generated and ready for ParaView.";
  const firstWarning = warnings[0]
    .replace(
      "No geometry surfaces have explicit boundary conditions; the geometry defaults to a no-slip wall.",
      "Geometry surfaces use the default no-slip wall condition.",
    )
    .replace(
      "Create a boundary box to control the external flow domain and its faces.",
      "Create a boundary box before running the external-flow case.",
    );
  const remainder = warnings.length - 1;
  return `OpenFOAM case generated with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}. ${firstWarning}${remainder > 0 ? ` (+${remainder} more)` : ""}`;
}

interface CaseWorkspaceProps {
  simulationCase: SimulationCase;
  onCreateVariant: (caseId: string) => void;
  onStatus: (message: string, isError?: boolean) => void;
  onUpAxisChange: (upAxis: UpAxis) => void;
  onSimulationChange: (job: SimulationJob | null) => void;
  onIoBusyChange: (busy: boolean) => void;
  simulationLog: SimulationLog | null;
  addProbeRequest: number;
  onProbeCountChange: (count: number) => void;
  processingScriptsOpen: boolean;
  showOpenFoamGeometry: boolean;
  resultsRequest: { id: number; snapshot: FlowSnapshot } | null;
}

export function CaseWorkspace({
  simulationCase,
  onCreateVariant,
  onStatus,
  onUpAxisChange,
  onSimulationChange,
  onIoBusyChange,
  simulationLog,
  addProbeRequest,
  onProbeCountChange,
  processingScriptsOpen,
  showOpenFoamGeometry,
  resultsRequest,
}: CaseWorkspaceProps) {
  const { project, syncProject } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(simulationCase.geometryId ?? "");
  const [setup, setSetup] = useState(simulationCase.cfdSetup);
  const [selectedSurface, setSelectedSurface] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<OpenFoamRuntimeStatus | null>(null);
  const [job, setJob] = useState<SimulationJob | null>(null);
  const [flowSnapshot, setFlowSnapshot] = useState<FlowSnapshot | null>(null);
  const [flowSnapshotSyncing, setFlowSnapshotSyncing] = useState(false);
  const [showFlowView, setShowFlowView] = useState(false);
  const resultsRequestRef = useRef(resultsRequest);
  resultsRequestRef.current = resultsRequest;
  const geometry = project?.geometries.find(({ id }) => id === simulationCase.geometryId);
  const sourceCase = project?.cases.find(({ id }) => id === simulationCase.variantOfCaseId);
  const jobId = job?.id;
  const jobStatus = job?.status;
  const simulationActive = Boolean(
    jobStatus && ["Starting", "Running", "Cancelling"].includes(jobStatus),
  );

  useEffect(() => setSelection(simulationCase.geometryId ?? ""), [simulationCase.geometryId]);
  useEffect(() => setSelectedSurface(null), [simulationCase.geometryId]);
  useEffect(() => setSetup(simulationCase.cfdSetup), [simulationCase.cfdSetup]);
  useEffect(() => {
    const clearSurfaceSelection = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedSurface(null);
    };
    window.addEventListener("keydown", clearSurfaceSelection);
    return () => window.removeEventListener("keydown", clearSurfaceSelection);
  }, []);
  useEffect(() => {
    setFlowSnapshot(null);
    setShowFlowView(false);
  }, [simulationCase.id]);
  useEffect(() => {
    if (!resultsRequest) return;
    setFlowSnapshot(resultsRequest.snapshot);
    setShowFlowView(true);
  }, [resultsRequest]);
  useEffect(() => onSimulationChange(job), [job, onSimulationChange]);
  useEffect(() => onIoBusyChange(busy), [busy, onIoBusyChange]);
  useEffect(() => () => onIoBusyChange(false), [onIoBusyChange]);
  useEffect(() => {
    let disposed = false;
    async function initializeRunState() {
      try {
        const [nextRuntime, currentJob] = await Promise.all([
          getOpenFoamRuntime(),
          getSimulationStatus(),
        ]);
        if (disposed) return;
        setRuntime(nextRuntime);
        const caseJob = currentJob?.caseId === simulationCase.id ? currentJob : null;
        setJob(caseJob);
        const requestedResults = resultsRequestRef.current;
        if (requestedResults) setFlowSnapshot(requestedResults.snapshot);
        setShowFlowView(
          Boolean(
            requestedResults ||
            (caseJob && ["Starting", "Running", "Completed"].includes(caseJob.status)),
          ),
        );

        const autoRun = import.meta.env.DEV && import.meta.env.VITE_TESRIG_DEV_AUTORUN === "1";
        if (!autoRun || currentJob || !nextRuntime.runtimeReady || !project || !geometry) return;

        setBusy(true);
        onStatus("Preparing the automatic OpenFOAM smoke test…");
        if (geometry.format === "STEP") {
          await ensureGeometryTriangulated(project.id, geometry);
        }
        const updated = await updateCaseSetup(
          project.id,
          simulationCase.id,
          simulationCase.cfdSetup,
        );
        syncProject(updated);
        const started = await startSimulation(project.id, simulationCase.id);
        if (!disposed) {
          setJob(started);
          setShowFlowView(true);
          onStatus("Simulation running.");
        }
      } catch (error) {
        if (!disposed) onStatus(toUserMessage(error), true);
      } finally {
        if (!disposed) setBusy(false);
      }
    }
    void initializeRunState();
    return () => {
      disposed = true;
    };
    // The auto-run bootstrap is intentionally tied to mounting a selected test case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!jobId || !jobStatus || !["Starting", "Running", "Cancelling"].includes(jobStatus)) return;
    const interval = window.setInterval(() => {
      void getSimulationStatus()
        .then((nextJob) => {
          setJob(nextJob);
          if (nextJob?.status === "Completed") {
            onStatus("OpenFOAM simulation completed.");
          } else if (nextJob?.status === "Failed") {
            setShowFlowView(false);
            onStatus(nextJob.error ?? "OpenFOAM simulation failed.", true);
          } else if (nextJob?.status === "Cancelled") {
            setShowFlowView(false);
            onStatus("Simulation cancelled.");
          }
        })
        .catch((error) => onStatus(toUserMessage(error), true));
    }, 500);
    return () => window.clearInterval(interval);
  }, [jobId, jobStatus, onStatus]);
  useEffect(() => {
    if (!showFlowView || !jobId || !jobStatus) return;
    let disposed = false;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await getFlowSnapshot();
        if (!disposed && next) setFlowSnapshot(next);
      } catch {
        // Keep the last complete frame if OpenFOAM is currently replacing a field file.
      } finally {
        loading = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), FLOW_SNAPSHOT_REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [jobId, jobStatus, showFlowView]);
  const selectSurface = useCallback((surface: string) => setSelectedSurface(surface), []);

  const syncFlowSnapshot = useCallback(async () => {
    setFlowSnapshotSyncing(true);
    try {
      const next = await getFlowSnapshot();
      if (next) {
        setFlowSnapshot(next);
        onStatus(`Airflow preview synced to t = ${next.time.toPrecision(4)}.`);
      } else {
        onStatus("No complete OpenFOAM field is available to preview yet.", true);
      }
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setFlowSnapshotSyncing(false);
    }
  }, [onStatus]);

  async function handleImport() {
    if (!project) return;
    const sourcePath = await chooseGeometryFile();
    if (typeof sourcePath !== "string") return;
    setBusy(true);
    onStatus("Importing geometry into case…");
    try {
      const updated = await importGeometry({
        projectId: project.id,
        caseId: simulationCase.id,
        sourcePath,
      });
      syncProject(updated);
      setSelection(updated.cases.find(({ id }) => id === simulationCase.id)?.geometryId ?? "");
      onStatus("Case geometry imported.");
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign() {
    if (!project || !selection) return;
    setBusy(true);
    onStatus("Assigning geometry…");
    try {
      syncProject(await assignGeometry(project.id, simulationCase.id, selection));
      onStatus("Case geometry updated.");
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSetup() {
    if (!project) return;
    setBusy(true);
    onStatus("Validating and generating OpenFOAM case…");
    try {
      if (geometry?.format === "STEP") {
        onStatus("Triangulating STEP geometry for OpenFOAM…");
        await ensureGeometryTriangulated(project.id, geometry);
      }
      const updated = await updateCaseSetup(project.id, simulationCase.id, setup);
      syncProject(updated);
      const validation = await validateCase(project.id, simulationCase.id);
      onStatus(generatedCaseStatus(validation.warnings));
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    if (!project) return;
    const destination = await chooseCaseExportDirectory();
    if (typeof destination !== "string") return;
    setBusy(true);
    onStatus("Exporting OpenFOAM case…");
    try {
      const path = await exportOpenFoamCase(project.id, simulationCase.id, destination);
      onStatus(`OpenFOAM case exported to ${path}. Open TesRig.foam in ParaView.`);
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    if (!project) return;
    setBusy(true);
    setShowFlowView(true);
    setFlowSnapshot(null);
    onStatus("Preparing OpenFOAM case…");
    try {
      if (geometry?.format === "STEP") {
        onStatus("Triangulating STEP geometry for OpenFOAM…");
        await ensureGeometryTriangulated(project.id, geometry);
      }
      const updated = await updateCaseSetup(project.id, simulationCase.id, setup);
      syncProject(updated);
      const started = await startSimulation(project.id, simulationCase.id);
      setJob(started);
      onStatus("Simulation running.");
    } catch (error) {
      setShowFlowView(false);
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    onStatus("Stopping simulation…");
    try {
      const cancelled = await cancelSimulation();
      setJob(cancelled);
      if (cancelled.status === "Cancelled") setShowFlowView(false);
    } catch (error) {
      onStatus(toUserMessage(error), true);
    }
  }

  const processingScriptsPanel =
    processingScriptsOpen && project ? (
      <ProcessingScriptsPanel
        key={simulationCase.id}
        projectId={project.id}
        caseId={simulationCase.id}
        simulationActive={simulationActive}
        onStatus={onStatus}
      />
    ) : null;

  const setupPanel = (
    <CfdSetupPanel
      simulationCase={simulationCase}
      sourceCaseName={sourceCase?.name}
      geometry={geometry}
      geometries={project?.geometries ?? []}
      geometrySelection={selection}
      onGeometrySelectionChange={setSelection}
      onAssignGeometry={handleAssign}
      onImportGeometry={handleImport}
      onCreateVariant={() => onCreateVariant(simulationCase.id)}
      setup={setup}
      selectedSurface={geometry ? selectedSurface : null}
      onSurfaceSelect={selectSurface}
      busy={busy || simulationActive}
      onChange={setSetup}
      onSave={handleSaveSetup}
      onExport={handleExport}
      runtime={runtime}
      job={job}
      simulationLog={simulationLog}
      onRun={handleRun}
      onCancel={handleCancel}
    />
  );

  return (
    <section className="geometry-editor case-editor">
      {showOpenFoamGeometry && project ? (
        <OpenFoamGeometryInspector
          projectId={project.id}
          caseId={simulationCase.id}
          setup={simulationCase.cfdSetup}
          upAxis={project.settings.upAxis}
        />
      ) : geometry ? (
        showFlowView ? (
          <FlowResultsViewer
            projectId={project!.id}
            geometry={geometry}
            setup={setup}
            snapshot={flowSnapshot}
            isPreview={jobStatus !== "Completed"}
            selectedSurface={selectedSurface}
            onSurfaceSelect={selectSurface}
            upAxis={project!.settings.upAxis}
            onUpAxisChange={onUpAxisChange}
            addProbeRequest={addProbeRequest}
            onProbeCountChange={onProbeCountChange}
            onSyncPreview={syncFlowSnapshot}
            previewSyncing={flowSnapshotSyncing}
            leftPanel={processingScriptsPanel}
          >
            {setupPanel}
          </FlowResultsViewer>
        ) : (
          <GeometryViewer
            projectId={project!.id}
            geometry={geometry}
            selectedSurface={selectedSurface}
            onSurfaceSelect={selectSurface}
            upAxis={project!.settings.upAxis}
            onUpAxisChange={onUpAxisChange}
            boundaryBox={setup.flowDomain === "Internal" ? null : setup.boundaryBox}
            flowDirection={resolveFlowDirection(setup)}
            selectedInletVelocity={
              setup.boundaries.find(
                ({ boundaryType, surface }) =>
                  boundaryType === "Inlet" && surface === selectedSurface,
              )?.velocity ?? null
            }
            leftPanel={processingScriptsPanel}
            onBoundaryBoxChange={(boundaryBox) =>
              setSetup((current) => ({ ...current, boundaryBox }))
            }
          >
            {setupPanel}
          </GeometryViewer>
        )
      ) : (
        <div className="geometry-viewer case-geometry-empty case-geometry-empty--with-panel">
          <div className="case-geometry-empty__message">
            <span>◇</span>
            <h3>Add geometry to continue</h3>
            <p>
              Import an STL, OBJ, or STEP file, or choose an asset already stored in this project.
            </p>
            <Button variant="primary" onClick={handleImport} disabled={busy || simulationActive}>
              Choose geometry file
            </Button>
          </div>
          {setupPanel}
        </div>
      )}
    </section>
  );
}
