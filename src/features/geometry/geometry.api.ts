import { open } from "@tauri-apps/plugin-dialog";
import { invokeCommand } from "../../lib/tauri/invoke";
import type { ProjectSummary } from "../projects/project.types";

interface ImportGeometryInput {
  projectId: string;
  caseId?: string | null;
  sourcePath: string;
}

export function chooseGeometryFile() {
  return open({
    title: "Import geometry",
    multiple: false,
    directory: false,
    filters: [{ name: "3D Geometry", extensions: ["stl", "obj", "step", "stp"] }],
  });
}

export function importGeometry(input: ImportGeometryInput) {
  return invokeCommand<ProjectSummary, ImportGeometryInput>("import_geometry", input);
}

export function assignGeometry(projectId: string, caseId: string, geometryId: string) {
  return invokeCommand<ProjectSummary, { projectId: string; caseId: string; geometryId: string }>(
    "assign_geometry",
    { projectId, caseId, geometryId },
  );
}

export function getGeometryData(projectId: string, geometryId: string) {
  return invokeCommand<{ bytes: number[] }, { projectId: string; geometryId: string }>(
    "get_geometry_data",
    { projectId, geometryId },
  );
}
