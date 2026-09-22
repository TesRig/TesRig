import { invokeCommand } from "../../lib/tauri/invoke";
import type { ProjectIdInput } from "../projects/project.types";
import type { CreateCaseInput, SimulationCase } from "./case.types";

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
