import type { SimulationCase } from "../cases/case.types";

export type GeometryFormat = "STL" | "OBJ" | "STEP";

export interface GeometryAsset {
  id: string;
  name: string;
  fileName: string;
  format: GeometryFormat;
  sizeBytes: number;
  createdAt: string;
}

export interface ProjectSummary {
  formatVersion: number;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  archivePath: string;
  cases: SimulationCase[];
  geometries: GeometryAsset[];
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
