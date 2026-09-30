import type { SimulationCase } from "../cases/case.types";

export type GeometryFormat = "STL" | "OBJ" | "STEP";
export type UpAxis = "Y" | "Z";

export interface ProjectSettings {
  upAxis: UpAxis;
}

export interface GeometryAsset {
  id: string;
  name: string;
  fileName: string;
  format: GeometryFormat;
  sizeBytes: number;
  createdAt: string;
  materialId: string | null;
}

export interface MechanicalProperties {
  density: number | null;
  youngsModulus: number | null;
  poissonsRatio: number | null;
  yieldStrength: number | null;
  ultimateTensileStrength: number | null;
}

export interface ThermalProperties {
  thermalConductivity: number | null;
  specificHeat: number | null;
  thermalExpansionCoefficient: number | null;
}

export interface MaterialAppearance {
  baseColor: string;
  metalness: number;
  roughness: number;
  opacity: number;
}

export interface MaterialSource {
  title: string;
  url: string;
  note: string;
}

export interface Material {
  id: string;
  name: string;
  category: string;
  description: string;
  mechanical: MechanicalProperties;
  thermal: ThermalProperties;
  appearance: MaterialAppearance;
  sources: MaterialSource[];
  basedOn: string | null;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
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
  materials: Material[];
  settings: ProjectSettings;
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

export interface UpdateProjectSettingsInput extends ProjectIdInput {
  settings: ProjectSettings;
}
