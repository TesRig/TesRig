import type { SimulationCase } from "../cases/case.types";

export interface ProjectSummary {
  formatVersion: number;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  archivePath: string;
  cases: SimulationCase[];
}

export interface CreateProjectInput {
  name: string;
  description: string;
  destination: string;
}

export interface OpenProjectInput {
  path: string;
}

export interface ProjectIdInput {
  projectId: string;
}
