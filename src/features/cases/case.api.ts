import { invokeCommand } from "../../lib/tauri/invoke";
import type { ProjectIdInput } from "../projects/project.types";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CfdSetup,
  CaseValidation,
  FlowSnapshot,
  CreateCaseInput,
  OpenFoamRuntimeStatus,
  OpenFoamGeometryData,
  ProcessingScript,
  ProcessingScriptRun,
  ProcessingScriptValidation,
  ProcessingResult,
  ProcessingResultSummary,
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

export function getOpenFoamGeometryData(projectId: string, caseId: string) {
  return invokeCommand<OpenFoamGeometryData, { projectId: string; caseId: string }>(
    "get_openfoam_geometry_data",
    { projectId, caseId },
  );
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

export function getFlowSnapshot() {
  return invokeCommand<FlowSnapshot | null>("get_flow_snapshot");
}

export function getCaseFlowSnapshot(projectId: string, caseId: string) {
  return invokeCommand<FlowSnapshot | null, { projectId: string; caseId: string }>(
    "get_case_flow_snapshot",
    { projectId, caseId },
  );
}

export function clearSimulationLog() {
  return invokeCommand<SimulationLog>("clear_simulation_log");
}

export function cancelSimulation() {
  return invokeCommand<SimulationJob>("cancel_simulation");
}

export function listProcessingScripts(projectId: string, caseId: string) {
  return invokeCommand<ProcessingScript[], { projectId: string; caseId: string }>(
    "list_processing_scripts",
    { projectId, caseId },
  );
}

export function listProcessingResults(projectId: string, caseId: string) {
  return invokeCommand<ProcessingResultSummary[], { projectId: string; caseId: string }>(
    "list_processing_results",
    { projectId, caseId },
  );
}

export function readProcessingResult(projectId: string, caseId: string, fileName: string) {
  return invokeCommand<ProcessingResult, { projectId: string; caseId: string; fileName: string }>(
    "read_processing_result",
    { projectId, caseId, fileName },
  );
}

export function saveProcessingScript(
  projectId: string,
  caseId: string,
  name: string,
  source: string,
) {
  return invokeCommand<
    ProcessingScript,
    { projectId: string; caseId: string; name: string; source: string }
  >("save_processing_script", { projectId, caseId, name, source });
}

export function deleteProcessingScript(projectId: string, caseId: string, name: string) {
  return invokeCommand<void, { projectId: string; caseId: string; name: string }>(
    "delete_processing_script",
    { projectId, caseId, name },
  );
}

export function runProcessingScript(projectId: string, caseId: string, name: string) {
  return invokeCommand<ProcessingScriptRun, { projectId: string; caseId: string; name: string }>(
    "run_processing_script",
    { projectId, caseId, name },
  );
}

export function validateProcessingScript(source: string) {
  return invokeCommand<ProcessingScriptValidation, { source: string }>(
    "validate_processing_script",
    { source },
  );
}

export function openPythonApiDocs() {
  return invokeCommand<void>("open_python_api_docs");
}
