export type SimulationType = "CFD";
export type Solver = "OpenFOAM";
export type CaseStatus = "Draft";

export interface SimulationCase {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  simulationType: SimulationType;
  solver: Solver;
  status: CaseStatus;
}

export interface CreateCaseInput {
  projectId: string;
  name: string;
  description: string;
  simulationType: SimulationType;
  solver: Solver;
}
