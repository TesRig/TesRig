import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "../../../components/common/Button";
import { useBoundaryBoxControls } from "../../geometry/boundary-box-controls";
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
import { resolveFlowDirection } from "../flow-direction";
import { SimulationOutputChart } from "./SimulationOutputChart";

interface CfdSetupPanelProps {
  setup: CfdSetup;
  selectedSurface: string | null;
  onSurfaceSelect: (surface: string) => void;
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
type BoundaryStep = "analysis" | "domain" | "conditions" | "optimize";

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

function defaultBoundaryType(surface: string, direction: [number, number, number]): BoundaryType {
  const flowAxis = direction.reduce(
    (largest, value, axis) => (Math.abs(value) > Math.abs(direction[largest]) ? axis : largest),
    0,
  );
  const axisName = ["x", "y", "z"][flowAxis];
  const positiveFlow = direction[flowAxis] >= 0;
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

function BoundaryStepSection({
  number,
  title,
  description,
  complete,
  locked = false,
  open,
  onToggle,
  children,
}: {
  number: number;
  title: string;
  description: string;
  complete: boolean;
  locked?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={`boundary-step ${complete ? "is-complete" : ""} ${locked ? "is-locked" : ""}`}
    >
      <button
        className="boundary-step__header"
        type="button"
        onClick={onToggle}
        disabled={locked}
        aria-expanded={open}
      >
        <span className="boundary-step__number">{complete ? "✓" : number}</span>
        <span className="boundary-step__heading">
          <strong>{title}</strong>
          <small>{locked ? "Complete the previous step first" : description}</small>
        </span>
        <span className={`boundary-step__chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
      </button>
      {open && !locked && <div className="boundary-step__content">{children}</div>}
    </section>
  );
}

export function CfdSetupPanel({
  setup,
  selectedSurface,
  onSurfaceSelect,
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
  const [openBoundarySteps, setOpenBoundarySteps] = useState<Set<BoundaryStep>>(
    () => new Set(["analysis"]),
  );
  const boundaryBoxControls = useBoundaryBoxControls();
  const flowDomain = setup.flowDomain ?? "External";
  const isExternal = flowDomain === "External";
  const selectedBoundary = useMemo(
    () => setup.boundaries.find(({ surface }) => surface === activePatch) ?? null,
    [activePatch, setup.boundaries],
  );
  const selectedSurfaceBoundary = selectedSurface
    ? setup.boundaries.find(({ surface }) => surface === selectedSurface)
    : null;
  const selectedSurfacePatch = selectedSurfaceBoundary?.surface ?? null;
  const boundarySurfaceAllowed = Boolean(
    selectedSurface &&
    (isExternal ? selectedSurface.startsWith("domain:") : !selectedSurface.startsWith("domain:")),
  );
  const relevantBoundaries = setup.boundaries.filter(({ surface }) =>
    isExternal ? surface.startsWith("domain:") : !surface.startsWith("domain:"),
  );
  const domainReady = isExternal
    ? Boolean(setup.boundaryBox)
    : Boolean(geometry && boundaryBoxControls?.geometryReady);
  const conditionsComplete =
    relevantBoundaries.some(({ boundaryType }) => boundaryType === "Inlet") &&
    relevantBoundaries.some(({ boundaryType }) => boundaryType === "Outlet");
  const backgroundMeshPlan = useMemo(
    () =>
      setup.boundaryBox
        ? createBackgroundMeshPlan(setup.boundaryBox, setup.mesh.baseCellSize)
        : null,
    [setup.boundaryBox, setup.mesh.baseCellSize],
  );
  const taskActive = Boolean(job && ["Starting", "Running", "Cancelling"].includes(job.status));
  const displayedWriteInterval =
    setup.flowRegime === "Steady" && setup.run.writeInterval < 1
      ? Math.max(1, Math.ceil(setup.run.maxIterations / 10))
      : setup.run.writeInterval;
  const jobId = job?.id;

  useEffect(() => {
    if (jobId) setChartCollapsed(false);
  }, [jobId]);

  useEffect(() => {
    if (!selectedSurface) setActivePatch(null);
    else if (selectedSurfacePatch) setActivePatch(selectedSurfacePatch);
  }, [selectedSurface, selectedSurfacePatch]);

  useEffect(() => {
    if (
      section === "boundaries" &&
      geometry &&
      boundaryBoxControls?.geometryReady &&
      !setup.boundaryBox
    ) {
      boundaryBoxControls.createSetupBox();
    }
  }, [boundaryBoxControls, geometry, section, setup.boundaryBox]);

  useEffect(() => {
    if (!isExternal && boundaryBoxControls?.isEditing) {
      boundaryBoxControls.setEditing(false);
    }
  }, [boundaryBoxControls, isExternal]);

  useEffect(() => {
    if (!conditionsComplete) return;
    setOpenBoundarySteps((current) => new Set([...current, "optimize"]));
  }, [conditionsComplete]);

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
    if (!selectedSurface || !domainReady || !boundarySurfaceAllowed) return;
    const existing = setup.boundaries.find(({ surface }) => surface === selectedSurface);
    if (!existing) {
      const boundary: BoundaryCondition = {
        surface: selectedSurface,
        patchName: patchName(selectedSurface),
        boundaryType: defaultBoundaryType(selectedSurface, resolveFlowDirection(setup)),
        velocity: setup.initialConditions.velocity,
        gaugePressure: setup.initialConditions.gaugePressure,
      };
      onChange({ ...setup, boundaries: [...setup.boundaries, boundary] });
    }
    setActivePatch(selectedSurface);
  }

  function toggleBoundaryStep(step: BoundaryStep) {
    setOpenBoundarySteps((current) => {
      const next = new Set(current);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  function advanceBoundaryStep(current: BoundaryStep, next: BoundaryStep) {
    setOpenBoundarySteps((steps) => {
      const updated = new Set(steps);
      updated.delete(current);
      updated.add(next);
      return updated;
    });
  }

  function changeFlowDomain(nextDomain: CfdSetup["flowDomain"]) {
    const keepDomainSurfaces = nextDomain === "External";
    onChange({
      ...setup,
      flowDomain: nextDomain,
      boundaries: setup.boundaries.filter(({ surface }) =>
        keepDomainSurfaces ? surface.startsWith("domain:") : !surface.startsWith("domain:"),
      ),
    });
    setActivePatch(null);
    if (boundaryBoxControls?.geometryReady) {
      boundaryBoxControls.createSetupBox();
      if (nextDomain === "Internal") boundaryBoxControls.setEditing(false);
    }
    advanceBoundaryStep("analysis", "domain");
  }

  function updateBoundaryBoxLimit(side: "min" | "max", axis: number, value: number) {
    if (!setup.boundaryBox) return;
    const next = {
      min: [...setup.boundaryBox.min] as [number, number, number],
      max: [...setup.boundaryBox.max] as [number, number, number],
    };
    next[side][axis] = value;
    onChange({ ...setup, boundaryBox: next });
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
                <div className="boundary-workflow">
                  <BoundaryStepSection
                    number={1}
                    title="Choose flow domain"
                    description={isExternal ? "External fluid analysis" : "Internal fluid analysis"}
                    complete
                    open={openBoundarySteps.has("analysis")}
                    onToggle={() => toggleBoundaryStep("analysis")}
                  >
                    <div className="flow-domain-options">
                      <button
                        type="button"
                        className={isExternal ? "is-selected" : ""}
                        onClick={() => changeFlowDomain("External")}
                      >
                        <strong>External</strong>
                        <span>
                          Create a surrounding fluid volume and assign its faces as inlets, outlets,
                          or open boundaries.
                        </span>
                      </button>
                      <button
                        type="button"
                        className={!isExternal ? "is-selected" : ""}
                        onClick={() => changeFlowDomain("Internal")}
                      >
                        <strong>Internal</strong>
                        <span>
                          Use the imported geometry as the fluid passage and assign its own
                          surfaces.
                        </span>
                      </button>
                    </div>
                  </BoundaryStepSection>

                  <BoundaryStepSection
                    number={2}
                    title={isExternal ? "Prepare boundary volume" : "Prepare internal surfaces"}
                    description={
                      isExternal
                        ? setup.boundaryBox
                          ? "Equal-sided setup volume ready"
                          : "Creating setup volume"
                        : "Input geometry surfaces will define the flow passage"
                    }
                    complete={domainReady}
                    open={openBoundarySteps.has("domain")}
                    onToggle={() => toggleBoundaryStep("domain")}
                  >
                    {isExternal ? (
                      <>
                        <p className="boundary-step__note">
                          The initial cube is only for selecting boundary faces. Drag its faces in
                          the viewport or enter exact limits below; optimize it after assigning the
                          inlet and outlet.
                        </p>
                        {!setup.boundaryBox ? (
                          <Button
                            variant="primary"
                            onClick={() => boundaryBoxControls?.createSetupBox()}
                            disabled={!boundaryBoxControls?.geometryReady}
                          >
                            Create setup volume
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant={boundaryBoxControls?.isEditing ? "primary" : "secondary"}
                              onClick={() =>
                                boundaryBoxControls?.setEditing(!boundaryBoxControls.isEditing)
                              }
                            >
                              {boundaryBoxControls?.isEditing
                                ? "Finish resizing"
                                : "Resize in viewport"}
                            </Button>
                            <div className="boundary-limits">
                              {(["min", "max"] as const).map((side) => (
                                <div key={side} className="cfd-vector">
                                  {setup.boundaryBox![side].map((value, axis) => (
                                    <NumericInput
                                      key={`${side}-${axis}`}
                                      label={`${side === "min" ? "Min" : "Max"} ${["X", "Y", "Z"][axis]}`}
                                      value={value}
                                      onChange={(next) => updateBoundaryBoxLimit(side, axis, next)}
                                    />
                                  ))}
                                </div>
                              ))}
                            </div>
                            <Button
                              variant="ghost"
                              onClick={() => advanceBoundaryStep("domain", "conditions")}
                            >
                              Continue to boundary conditions
                            </Button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="boundary-step__note">
                          Select faces directly on the imported geometry. The outer background mesh
                          is treated only as a meshing aid and is not exposed as a flow boundary.
                        </p>
                        <Button
                          variant="ghost"
                          onClick={() => advanceBoundaryStep("domain", "conditions")}
                          disabled={!domainReady}
                        >
                          Continue to boundary conditions
                        </Button>
                      </>
                    )}
                  </BoundaryStepSection>

                  <BoundaryStepSection
                    number={3}
                    title="Assign boundary conditions"
                    description={
                      conditionsComplete
                        ? "Inlet and outlet assigned"
                        : "Add at least one inlet and one outlet"
                    }
                    complete={conditionsComplete}
                    locked={!domainReady}
                    open={openBoundarySteps.has("conditions")}
                    onToggle={() => toggleBoundaryStep("conditions")}
                  >
                    <div className="surface-selection">
                      <span>Selected surface</span>
                      <strong>
                        {selectedSurface
                          ? (boundaryBoxFaceLabels[selectedSurface] ?? selectedSurface)
                          : `Click ${isExternal ? "a boundary-volume face" : "an input-geometry surface"} in the view`}
                      </strong>
                      {selectedSurface && !boundarySurfaceAllowed && (
                        <small>
                          Select {isExternal ? "a translucent volume face" : "a geometry surface"}
                          for this analysis type.
                        </small>
                      )}
                      <Button
                        variant={selectedSurfaceBoundary ? "secondary" : "primary"}
                        onClick={addSelectedBoundary}
                        disabled={!boundarySurfaceAllowed || !domainReady}
                      >
                        {selectedSurfaceBoundary
                          ? "Open selected boundary in list"
                          : "Add selected surface"}
                      </Button>
                    </div>
                    {relevantBoundaries.length > 0 && (
                      <div className="boundary-list">
                        {relevantBoundaries.map((boundary) => (
                          <button
                            key={boundary.surface}
                            type="button"
                            className={activePatch === boundary.surface ? "is-active" : ""}
                            onClick={() => {
                              setActivePatch(boundary.surface);
                              onSurfaceSelect(boundary.surface);
                            }}
                          >
                            <span>
                              {boundaryBoxFaceLabels[boundary.surface] ?? boundary.surface}
                            </span>
                            <small>{boundary.boundaryType}</small>
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedBoundary &&
                      relevantBoundaries.some(
                        ({ surface }) => surface === selectedBoundary.surface,
                      ) && (
                        <div className="boundary-editor">
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
                        </div>
                      )}
                  </BoundaryStepSection>

                  {isExternal && (
                    <BoundaryStepSection
                      number={4}
                      title="Optimize boundary volume"
                      description="Resize using recommended external-flow clearance"
                      complete={false}
                      locked={!conditionsComplete}
                      open={openBoundarySteps.has("optimize")}
                      onToggle={() => toggleBoundaryStep("optimize")}
                    >
                      <p className="boundary-step__note">
                        The setup cube will be reshaped using the detected inlet-to-outlet
                        direction, with additional downstream space for the wake.
                      </p>
                      <Button
                        variant="primary"
                        onClick={() => boundaryBoxControls?.optimizeBox()}
                        disabled={!boundaryBoxControls?.geometryReady}
                      >
                        Optimize boundary volume
                      </Button>
                    </BoundaryStepSection>
                  )}
                </div>
              )}

              {section === "mesh" && (
                <div className="cfd-form">
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
                  <NumericInput
                    label="Feature angle (°)"
                    value={setup.mesh.featureAngle}
                    min={0}
                    max={180}
                    onChange={(value) => changeMesh("featureAngle", value)}
                  />
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
                      label={
                        setup.flowRegime === "Steady"
                          ? "Write every (iterations)"
                          : "Write interval (s)"
                      }
                      value={displayedWriteInterval}
                      min={setup.flowRegime === "Steady" ? 1 : setup.run.timeStep}
                      step={setup.flowRegime === "Steady" ? 1 : undefined}
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
                    TesRig retains the 10 newest result times to control disk use. The full solver
                    history remains available in the log and chart.
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
