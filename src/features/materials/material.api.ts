import { open, save } from "@tauri-apps/plugin-dialog";
import { invokeCommand } from "../../lib/tauri/invoke";
import type { Material, ProjectSummary } from "../projects/project.types";

const materialFilters = [
  { name: "TesRig Material Library", extensions: ["json"] },
  { name: "MatML Material Data", extensions: ["xml", "matml"] },
  { name: "CalculiX / Abaqus Material", extensions: ["inp"] },
];

export function chooseMaterialFile() {
  return open({
    title: "Import materials",
    multiple: false,
    directory: false,
    filters: materialFilters,
  });
}

export function chooseMaterialExportFile(defaultName: string) {
  return save({ title: "Export materials", defaultPath: defaultName, filters: materialFilters });
}

export function upsertMaterial(projectId: string, material: Material) {
  return invokeCommand<ProjectSummary, { projectId: string; material: Material }>(
    "upsert_material",
    { projectId, material },
  );
}

export function deleteMaterial(projectId: string, materialId: string) {
  return invokeCommand<ProjectSummary, { projectId: string; materialId: string }>(
    "delete_material",
    { projectId, materialId },
  );
}

export function assignMaterial(projectId: string, geometryId: string, materialId: string | null) {
  return invokeCommand<
    ProjectSummary,
    { projectId: string; geometryId: string; materialId: string | null }
  >("assign_material", { projectId, geometryId, materialId });
}

export function importMaterials(projectId: string, sourcePath: string) {
  return invokeCommand<ProjectSummary, { projectId: string; sourcePath: string }>(
    "import_materials",
    { projectId, sourcePath },
  );
}

export function exportMaterials(projectId: string, materialIds: string[], destination: string) {
  return invokeCommand<string, { projectId: string; materialIds: string[]; destination: string }>(
    "export_materials",
    { projectId, materialIds, destination },
  );
}
