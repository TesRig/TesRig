import { invokeCommand } from "../../lib/tauri/invoke";
import type { ProjectIdInput } from "../projects/project.types";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CfdSetup,
  CaseValidation,
  CreateCaseInput,
  OpenFoamRuntimeStatus,
  SimulationJob,
  SimulationLog,
  SimulationCase,
} from "./case.types";

export function createCase(input: CreateCaseInput) {
  return invokeCommand<SimulationCase, CreateCaseInput>("create_case", input);
}

export function listCases(input: ProjectIdInput) {
  return invokeCommand<SimulationCase[], ProjectIdInput>("list_cases", input);
}

export function getCase(projectId: string, caseId: string) {
  return invokeCommand<SimulationCase, { projectId: string; caseId: string }>("get_case", {
    projectId,
    caseId,
  });
}

export function updateCaseSetup(projectId: string, caseId: string, setup: CfdSetup) {
  return invokeCommand<
    import("../projects/project.types").ProjectSummary,
    { projectId: string; caseId: string; setup: CfdSetup }
  >("update_case_setup", { projectId, caseId, setup });
}

export function validateCase(projectId: string, caseId: string) {
  return invokeCommand<CaseValidation, { projectId: string; caseId: string }>("validate_case", {
    projectId,
    caseId,
  });
}

export async function chooseCaseExportDirectory() {
  return open({ title: "Export OpenFOAM case", directory: true, multiple: false });
}

export function exportOpenFoamCase(projectId: string, caseId: string, destination: string) {
  return invokeCommand<string, { projectId: string; caseId: string; destination: string }>(
    "export_openfoam_case",
    { projectId, caseId, destination },
  );
}

export function getOpenFoamRuntime() {
  return invokeCommand<OpenFoamRuntimeStatus>("get_openfoam_runtime");
}

export function startSimulation(projectId: string, caseId: string) {
  return invokeCommand<SimulationJob, { projectId: string; caseId: string }>("start_simulation", {
    projectId,
    caseId,
  });
}

export function getSimulationStatus() {
  return invokeCommand<SimulationJob | null>("get_simulation_status");
}

export function getSimulationLog() {
  return invokeCommand<SimulationLog>("get_simulation_log");
}

export function cancelSimulation() {
  return invokeCommand<SimulationJob>("cancel_simulation");
}
