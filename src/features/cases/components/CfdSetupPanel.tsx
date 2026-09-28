import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import type { GeometryAsset } from "../../projects/project.types";
import type {
  BoundaryCondition,
  BoundaryType,
  CfdSetup,
  OpenFoamRuntimeStatus,
  SimulationJob,
  SimulationLog,
  SimulationCase,
} from "../case.types";
import { createBackgroundMeshPlan, formatCellCount } from "../mesh-planning";
import { SimulationOutputChart } from "./SimulationOutputChart";

interface CfdSetupPanelProps {
  setup: CfdSetup;
  selectedSurface: string | null;
  busy: boolean;
  onChange: (setup: CfdSetup) => void;
  onSave: () => void;
  onExport: () => void;
  runtime: OpenFoamRuntimeStatus | null;
  job: SimulationJob | null;
  simulationLog: SimulationLog | null;
  onRun: () => void;
  onCancel: () => void;
  simulationCase: SimulationCase;
  sourceCaseName?: string;
  geometry?: GeometryAsset;
  geometries: GeometryAsset[];
  geometrySelection: string;
  onGeometrySelectionChange: (geometryId: string) => void;
  onAssignGeometry: () => void;
  onImportGeometry: () => void;
  onCreateVariant: () => void;
}

type Section = "case" | "flow" | "boundaries" | "mesh" | "run";

const boundaryTypes: BoundaryType[] = ["Wall", "Inlet", "Outlet", "Symmetry", "Slip"];
const boundaryBoxFaceLabels: Record<string, string> = {
  "domain:xMin": "Boundary box · X min",
  "domain:xMax": "Boundary box · X max",
  "domain:yMin": "Boundary box · Y min",
  "domain:yMax": "Boundary box · Y max",
  "domain:zMin": "Boundary box · Z min",
  "domain:zMax": "Boundary box · Z max",
};

function patchName(surface: string) {
  if (boundaryBoxFaceLabels[surface]) return surface.replace("domain:", "");
  const result = surface.trim().replace(/[^a-zA-Z0-9_]+/g, "_");
  return /^\d/.test(result) ? `_${result}` : result || "geometry";
}

function defaultBoundaryType(surface: string, velocity: [number, number, number]): BoundaryType {
  const flowAxis = velocity.reduce(
    (largest, value, axis) => (Math.abs(value) > Math.abs(velocity[largest]) ? axis : largest),
    0,
  );
  const axisName = ["x", "y", "z"][flowAxis];
  const positiveFlow = velocity[flowAxis] >= 0;
  if (surface === `domain:${axisName}${positiveFlow ? "Min" : "Max"}`) return "Inlet";
  if (surface === `domain:${axisName}${positiveFlow ? "Max" : "Min"}`) return "Outlet";
  if (surface.startsWith("domain:")) return "Slip";
  return "Wall";
}

function NumericInput({
  label,
  value,
  min,
  max,
  step = "any",
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number | "any";
  onChange: (value: number) => void;
}) {
  return (
    <label className="cfd-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </label>
  );
}

export function CfdSetupPanel({
  setup,
  selectedSurface,
  busy,
  onChange,
  onSave,
  onExport,
  runtime,
  job,
  simulationLog,
  onRun,
  onCancel,
  simulationCase,
  sourceCaseName,
  geometry,
  geometries,
  geometrySelection,
  onGeometrySelectionChange,
  onAssignGeometry,
  onImportGeometry,
  onCreateVariant,
}: CfdSetupPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [section, setSection] = useState<Section>("case");
  const [activePatch, setActivePatch] = useState<string | null>(null);
  const selectedBoundary = useMemo(
    () => setup.boundaries.find(({ surface }) => surface === activePatch) ?? null,
    [activePatch, setup.boundaries],
  );
  const backgroundMeshPlan = useMemo(
    () =>
      setup.boundaryBox
        ? createBackgroundMeshPlan(setup.boundaryBox, setup.mesh.baseCellSize)
        : null,
    [setup.boundaryBox, setup.mesh.baseCellSize],
  );
  const taskActive = Boolean(job && ["Starting", "Running", "Cancelling"].includes(job.status));
  const jobId = job?.id;

  useEffect(() => {
    if (jobId) setChartCollapsed(false);
  }, [jobId]);

  function changeFluid(key: keyof CfdSetup["fluid"], value: number) {
    onChange({ ...setup, fluid: { ...setup.fluid, [key]: value } });
  }

  function changeInitial(key: keyof CfdSetup["initialConditions"], value: number) {
    onChange({
      ...setup,
      initialConditions: { ...setup.initialConditions, [key]: value },
    });
  }

  function changeMesh(key: keyof CfdSetup["mesh"], value: number) {
    onChange({ ...setup, mesh: { ...setup.mesh, [key]: value } });
  }

  function changeRun(key: keyof CfdSetup["run"], value: number) {
    onChange({ ...setup, run: { ...setup.run, [key]: value } });
  }

  function changeVelocity(index: number, value: number) {
    const velocity = [...setup.initialConditions.velocity] as [number, number, number];
    velocity[index] = value;
    onChange({
      ...setup,
      initialConditions: { ...setup.initialConditions, velocity },
    });
  }

  function addSelectedBoundary() {
    if (!selectedSurface || !setup.boundaryBox) return;
    const existing = setup.boundaries.find(({ surface }) => surface === selectedSurface);
    if (!existing) {
      const boundary: BoundaryCondition = {
        surface: selectedSurface,
        patchName: patchName(selectedSurface),
        boundaryType: defaultBoundaryType(selectedSurface, setup.initialConditions.velocity),
        velocity: setup.initialConditions.velocity,
        gaugePressure: setup.initialConditions.gaugePressure,
      };
      onChange({ ...setup, boundaries: [...setup.boundaries, boundary] });
    }
    setActivePatch(selectedSurface);
  }

  function updateBoundary(change: Partial<BoundaryCondition>) {
    if (!selectedBoundary) return;
    onChange({
      ...setup,
      boundaries: setup.boundaries.map((boundary) =>
        boundary.surface === selectedBoundary.surface ? { ...boundary, ...change } : boundary,
      ),
    });
  }

  function updateBoundaryVelocity(index: number, value: number) {
    if (!selectedBoundary) return;
    const velocity = [...selectedBoundary.velocity] as [number, number, number];
    velocity[index] = value;
    updateBoundary({ velocity });
  }

  function removeBoundary() {
    if (!selectedBoundary) return;
    onChange({
      ...setup,
      boundaries: setup.boundaries.filter(({ surface }) => surface !== selectedBoundary.surface),
    });
    setActivePatch(null);
  }

  return (
    <div className="cfd-overlay-stack">
      <aside className={`cfd-panel ${collapsed ? "is-collapsed" : ""}`}>
        <header className="cfd-panel__header">
          <div>
            <span title={runtime?.message}>
              {sourceCaseName ? `Variant of ${sourceCaseName}` : "Simulation case"} ·{" "}
              {simulationCase.status}
            </span>
            <strong>{simulationCase.name}</strong>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand case panel" : "Collapse case panel"}
          >
            {collapsed ? "‹" : "›"}
          </button>
        </header>
        {!collapsed && (
          <>
            <nav className="cfd-panel__tabs" aria-label="Case information and CFD setup sections">
              {(["case", "flow", "boundaries", "mesh", "run"] as Section[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={section === item ? "is-active" : ""}
                  onClick={() => setSection(item)}
                >
                  {item === "boundaries" ? "BCs" : item}
                </button>
              ))}
            </nav>
            <div className="cfd-panel__body">
              {section === "case" && (
                <div className="cfd-form case-overview">
                  <div className="case-overview__identity">
                    <span className="status-chip">{simulationCase.status}</span>
                    <h3>{simulationCase.name}</h3>
                    <p>{simulationCase.description || "No description provided."}</p>
                  </div>
                  <dl className="case-overview__metadata">
                    <div>
                      <dt>Simulation type</dt>
                      <dd>Flow / {simulationCase.simulationType}</dd>
                    </div>
                    <div>
                      <dt>Solver</dt>
                      <dd>{simulationCase.solver}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{new Date(simulationCase.createdAt).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>OpenFOAM</dt>
                      <dd title={runtime?.message}>
                        {runtime?.targetVersion ?? "14"} ·{" "}
                        {runtime?.runtimeReady ? "Ready" : "Setup required"}
                      </dd>
                    </div>
                  </dl>
                  <div className="case-overview__geometry">
                    <div>
                      <span>Geometry</span>
                      <strong>{geometry?.name ?? "No geometry assigned"}</strong>
                    </div>
                    {geometries.length > 0 && (
                      <label className="cfd-field">
                        <span>Project geometry</span>
                        <select
                          value={geometrySelection}
                          onChange={(event) => onGeometrySelectionChange(event.target.value)}
                          disabled={busy || taskActive}
                        >
                          <option value="">Choose project geometry</option>
                          {geometries.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.format})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="case-overview__geometry-actions">
                      {geometries.length > 0 && (
                        <Button
                          onClick={onAssignGeometry}
                          disabled={
                            busy ||
                            taskActive ||
                            !geometrySelection ||
                            geometrySelection === geometry?.id
                          }
                        >
                          Use geometry
                        </Button>
                      )}
                      <Button
                        variant={geometry ? "secondary" : "primary"}
                        onClick={onImportGeometry}
                        disabled={busy || taskActive}
                      >
                        {geometry ? "Replace with import" : "Import geometry"}
                      </Button>
                    </div>
                  </div>
                  <Button onClick={onCreateVariant} disabled={taskActive}>
                    Create variant
                  </Button>
                </div>
              )}
              {section === "flow" && (
                <div className="cfd-form">
                  <label className="cfd-field">
                    <span>Regime</span>
                    <select
                      value={setup.flowRegime}
                      onChange={(event) =>
                        onChange({
                          ...setup,
                          flowRegime: event.target.value as CfdSetup["flowRegime"],
                        })
                      }
                    >
                      <option>Steady</option>
                      <option>Transient</option>
                    </select>
                  </label>
                  <label className="cfd-field">
                    <span>Turbulence</span>
                    <select
                      value={setup.turbulenceModel}
                      onChange={(event) =>
                        onChange({
                          ...setup,
                          turbulenceModel: event.target.value as CfdSetup["turbulenceModel"],
                        })
                      }
                    >
                      <option value="Laminar">Laminar</option>
                      <option value="kOmegaSST">k-omega SST</option>
                      <option value="SpalartAllmaras">Spalart-Allmaras</option>
                    </select>
                  </label>
                  <h4>Air properties</h4>
                  <div className="cfd-form__columns">
                    <NumericInput
                      label="Density (kg/m³)"
                      value={setup.fluid.density}
                      min={0}
                      onChange={(value) => changeFluid("density", value)}
                    />
                    <NumericInput
                      label="Kinematic ν (m²/s)"
                      value={setup.fluid.kinematicViscosity}
                      min={0}
                      onChange={(value) => changeFluid("kinematicViscosity", value)}
                    />
                  </div>
                  <h4>Initial conditions</h4>
                  <div className="cfd-vector">
                    {setup.initialConditions.velocity.map((value, index) => (
                      <NumericInput
                        key={index}
                        label={`U${["x", "y", "z"][index]} (m/s)`}
                        value={value}
                        onChange={(next) => changeVelocity(index, next)}
                      />
                    ))}
                  </div>
                  <NumericInput
                    label="Gauge pressure (Pa)"
                    value={setup.initialConditions.gaugePressure}
                    onChange={(value) => changeInitial("gaugePressure", value)}
                  />
                  <div className="cfd-form__columns">
                    <NumericInput
                      label="Turbulence intensity"
                      value={setup.initialConditions.turbulenceIntensity}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(value) => changeInitial("turbulenceIntensity", value)}
                    />
                    <NumericInput
                      label="Length scale (m)"
                      value={setup.initialConditions.turbulentLengthScale}
                      min={0}
                      onChange={(value) => changeInitial("turbulentLengthScale", value)}
                    />
                  </div>
                </div>
              )}

              {section === "boundaries" && (
                <div className="cfd-form">
                  <div className={`boundary-box-required ${setup.boundaryBox ? "is-ready" : ""}`}>
                    <strong>
                      {setup.boundaryBox ? "Boundary box ready" : "Boundary box required"}
                    </strong>
                    <span>
                      {setup.boundaryBox
                        ? "Use Edit boundary box above, then click a translucent face to configure it."
                        : "Create a boundary box above before assigning boundary conditions."}
                    </span>
                  </div>
                  <div className="surface-selection">
                    <span>Selected surface</span>
                    <strong>
                      {selectedSurface
                        ? (boundaryBoxFaceLabels[selectedSurface] ?? selectedSurface)
                        : "Click a surface in the view"}
                    </strong>
                    <Button
                      onClick={addSelectedBoundary}
                      disabled={!selectedSurface || !setup.boundaryBox}
                    >
                      Add / edit boundary
                    </Button>
                  </div>
                  {setup.boundaries.length > 0 && (
                    <div className="boundary-list">
                      {setup.boundaries.map((boundary) => (
                        <button
                          key={boundary.surface}
                          type="button"
                          className={activePatch === boundary.surface ? "is-active" : ""}
                          onClick={() => setActivePatch(boundary.surface)}
                        >
                          <span>{boundaryBoxFaceLabels[boundary.surface] ?? boundary.surface}</span>
                          <small>{boundary.boundaryType}</small>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedBoundary && (
                    <>
                      <label className="cfd-field">
                        <span>Patch name</span>
                        <input
                          value={selectedBoundary.patchName}
                          onChange={(event) =>
                            updateBoundary({ patchName: patchName(event.target.value) })
                          }
                        />
                      </label>
                      <label className="cfd-field">
                        <span>Type</span>
                        <select
                          value={selectedBoundary.boundaryType}
                          onChange={(event) =>
                            updateBoundary({ boundaryType: event.target.value as BoundaryType })
                          }
                        >
                          {boundaryTypes.map((type) => (
                            <option key={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                      {selectedBoundary.boundaryType === "Inlet" && (
                        <div className="cfd-vector">
                          {selectedBoundary.velocity.map((value, index) => (
                            <NumericInput
                              key={index}
                              label={`U${["x", "y", "z"][index]}`}
                              value={value}
                              onChange={(next) => updateBoundaryVelocity(index, next)}
                            />
                          ))}
                        </div>
                      )}
                      {selectedBoundary.boundaryType === "Outlet" && (
                        <NumericInput
                          label="Gauge pressure (Pa)"
                          value={selectedBoundary.gaugePressure}
                          onChange={(value) => updateBoundary({ gaugePressure: value })}
                        />
                      )}
                      <Button variant="ghost" onClick={removeBoundary}>
                        Remove boundary
                      </Button>
                    </>
                  )}
                </div>
              )}

              {section === "mesh" && (
                <div className="cfd-form">
                  <div className={`boundary-box-required ${setup.boundaryBox ? "is-ready" : ""}`}>
                    <strong>
                      {setup.boundaryBox ? "External flow domain" : "No boundary box"}
                    </strong>
                    <span>
                      {setup.boundaryBox
                        ? "The box is meshed as the fluid volume outside the solid. Its default spacing follows the dominant flow direction."
                        : "Create the boundary box in the 3D toolbar to define the fluid domain."}
                    </span>
                    {setup.boundaryBox && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          onChange({
                            ...setup,
                            boundaryBox: null,
                            boundaries: setup.boundaries.filter(
                              ({ surface }) => !surface.startsWith("domain:"),
                            ),
                          })
                        }
                      >
                        Remove boundary box
                      </Button>
                    )}
                  </div>
                  <NumericInput
                    label="Base cell size (m)"
                    value={setup.mesh.baseCellSize}
                    min={0}
                    onChange={(value) => changeMesh("baseCellSize", value)}
                  />
                  {backgroundMeshPlan?.limited && (
                    <div className="mesh-budget-warning" role="status">
                      <strong>Mesh safety limit active</strong>
                      <span>
                        The requested spacing would create about{" "}
                        {formatCellCount(backgroundMeshPlan.requestedCellCount)} background cells.
                        TesRig will use {backgroundMeshPlan.cells.join(" × ")} cells ({" "}
                        {formatCellCount(backgroundMeshPlan.cellCount)} total) with an effective
                        spacing of about {backgroundMeshPlan.effectiveCellSize.toPrecision(3)} m.
                      </span>
                    </div>
                  )}
                  <div className="cfd-form__columns">
                    <NumericInput
                      label="Surface refinement"
                      value={setup.mesh.surfaceRefinement}
                      min={0}
                      max={8}
                      step={1}
                      onChange={(value) => changeMesh("surfaceRefinement", value)}
                    />
                    <NumericInput
                      label="Boundary layers"
                      value={setup.mesh.boundaryLayers}
                      min={0}
                      max={20}
                      step={1}
                      onChange={(value) => changeMesh("boundaryLayers", value)}
                    />
                  </div>
                  <div className="cfd-form__columns">
                    <NumericInput
                      label="Feature angle (°)"
                      value={setup.mesh.featureAngle}
                      min={0}
                      max={180}
                      onChange={(value) => changeMesh("featureAngle", value)}
                    />
                    {!setup.boundaryBox && (
                      <NumericInput
                        label="Legacy domain half-size (m)"
                        value={setup.mesh.domainPadding}
                        min={0}
                        onChange={(value) => changeMesh("domainPadding", value)}
                      />
                    )}
                  </div>
                  <p className="cfd-panel__note">
                    TesRig generates blockMesh and snappyHexMesh dictionaries. STL and OBJ can be
                    meshed directly; STEP remains packaged for later triangulation.
                  </p>
                </div>
              )}

              {section === "run" && (
                <div className="cfd-form">
                  {setup.flowRegime === "Transient" ? (
                    <div className="cfd-form__columns">
                      <NumericInput
                        label="End time (s)"
                        value={setup.run.endTime}
                        min={0}
                        onChange={(value) => changeRun("endTime", value)}
                      />
                      <NumericInput
                        label="Time step (s)"
                        value={setup.run.timeStep}
                        min={0}
                        onChange={(value) => changeRun("timeStep", value)}
                      />
                    </div>
                  ) : (
                    <NumericInput
                      label="Maximum iterations"
                      value={setup.run.maxIterations}
                      min={1}
                      step={1}
                      onChange={(value) => changeRun("maxIterations", value)}
                    />
                  )}
                  <div className="cfd-form__columns">
                    <NumericInput
                      label="Write interval"
                      value={setup.run.writeInterval}
                      min={0}
                      onChange={(value) => changeRun("writeInterval", value)}
                    />
                    <NumericInput
                      label="Processors"
                      value={setup.run.processors}
                      min={1}
                      step={1}
                      onChange={(value) => changeRun("processors", value)}
                    />
                  </div>
                  <div className="openfoam-output">
                    <strong>
                      {taskActive
                        ? "Simulation running"
                        : job
                          ? `Simulation · ${job.status}`
                          : "OpenFOAM simulation"}
                    </strong>
                    <span>
                      {job?.error?.split(/\r?\n/, 1)[0] ??
                        (runtime && !runtime.runtimeReady
                          ? runtime.message
                          : taskActive
                            ? `${job?.stage ?? "Preparing"} · ${Math.round(job?.progress ?? 0)}%`
                            : (runtime?.message ?? "Ready to run"))}
                    </span>
                    {taskActive && (
                      <progress
                        className="simulation-progress"
                        max={100}
                        value={job?.progress ?? 0}
                        aria-label="Simulation progress"
                      />
                    )}
                  </div>
                  {job?.status === "Failed" && job.error && (
                    <details className="simulation-error-details">
                      <summary>Show failure details</summary>
                      <pre>{job.error}</pre>
                    </details>
                  )}
                  {taskActive ? (
                    <Button onClick={onCancel} disabled={job?.status === "Cancelling"}>
                      {job?.status === "Cancelling" ? "Stopping…" : "Cancel simulation"}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={onRun}
                      disabled={busy || !runtime?.runtimeReady}
                    >
                      Run OpenFOAM
                    </Button>
                  )}
                  <p className="cfd-panel__note">
                    Results stay in the OpenFOAM case and can be opened through TesRig.foam in
                    ParaView.
                  </p>
                </div>
              )}
            </div>
            {section === "run" ? (
              <footer className="cfd-panel__actions">
                <Button onClick={onExport} disabled={busy || taskActive}>
                  Export case
                </Button>
              </footer>
            ) : (
              section !== "case" && (
                <footer className="cfd-panel__actions">
                  <Button variant="primary" onClick={onSave} disabled={busy || taskActive}>
                    {busy ? "Generating…" : "Save & generate"}
                  </Button>
                </footer>
              )
            )}
          </>
        )}
      </aside>
      {job && (
        <SimulationOutputChart
          log={simulationLog}
          collapsed={chartCollapsed}
          onToggleCollapsed={() => setChartCollapsed((value) => !value)}
        />
      )}
    </div>
  );
}
