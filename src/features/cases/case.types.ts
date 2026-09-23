export type SimulationType = "CFD";
export type Solver = "OpenFOAM";
export type CaseStatus = "Draft" | "Ready";
export type FlowRegime = "Steady" | "Transient";
export type TurbulenceModel = "Laminar" | "kOmegaSST" | "SpalartAllmaras";
export type BoundaryType = "Wall" | "Inlet" | "Outlet" | "Symmetry" | "Slip";

export interface BoundaryCondition {
  surface: string;
  patchName: string;
  boundaryType: BoundaryType;
  velocity: [number, number, number];
  gaugePressure: number;
}

export interface BoundaryBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface CfdSetup {
  flowRegime: FlowRegime;
  turbulenceModel: TurbulenceModel;
  fluid: {
    density: number;
    kinematicViscosity: number;
  };
  initialConditions: {
    velocity: [number, number, number];
    gaugePressure: number;
    turbulenceIntensity: number;
    turbulentLengthScale: number;
  };
  mesh: {
    baseCellSize: number;
    surfaceRefinement: number;
    boundaryLayers: number;
    featureAngle: number;
    domainPadding: number;
  };
  run: {
    endTime: number;
    timeStep: number;
    writeInterval: number;
    maxIterations: number;
    processors: number;
  };
  boundaryBox: BoundaryBox | null;
  boundaries: BoundaryCondition[];
}

export interface SimulationCase {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  simulationType: SimulationType;
  solver: Solver;
  status: CaseStatus;
  geometryId: string | null;
  variantOfCaseId: string | null;
  cfdSetup: CfdSetup;
}

export interface CaseValidation {
  valid: boolean;
  warnings: string[];
  generatedPath: string;
}

export interface OpenFoamRuntimeStatus {
  targetVersion: string;
  detectedVersion: string | null;
  environmentScript: string | null;
  adapterPackaged: boolean;
  runtimeReady: boolean;
  backend: string;
  distribution: string;
  message: string;
  gpuAcceleration: boolean;
}

export type SimulationJobStatus =
  "Starting" | "Running" | "Cancelling" | "Completed" | "Failed" | "Cancelled";

export interface SimulationJob {
  id: string;
  projectId: string;
  caseId: string;
  status: SimulationJobStatus;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  logPath: string;
  error: string | null;
  stage: string;
  progress: number;
}

export interface SimulationLog {
  stdout: string;
  stderr: string;
}

export interface CreateCaseInput {
  projectId: string;
  name: string;
  description: string;
  simulationType: SimulationType;
  solver: Solver;
  geometryId?: string | null;
  variantOfCaseId?: string | null;
}
