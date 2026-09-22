import { open, save } from "@tauri-apps/plugin-dialog";
import { invokeCommand } from "../../lib/tauri/invoke";
import type {
  CreateProjectInput,
  OpenProjectInput,
  ProjectIdInput,
  ProjectSummary,
} from "./project.types";

const projectFilter = [{ name: "TesRig Project", extensions: ["tsrig"] }];

export function createProject(input: CreateProjectInput) {
  return invokeCommand<ProjectSummary, CreateProjectInput>("create_project", input);
}

export function openProject(input: OpenProjectInput) {
  return invokeCommand<ProjectSummary, OpenProjectInput>("open_project", input);
}

export function saveProject(input: ProjectIdInput) {
  return invokeCommand<ProjectSummary, ProjectIdInput>("save_project", input);
}

export function closeProject() {
  return invokeCommand<void>("close_project");
}

export function chooseProjectDestination(projectName: string) {
  const safeName =
    [...projectName.trim()]
      .map((character) =>
        character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "-" : character,
      )
      .join("") || "Untitled";
  return save({
    title: "Create TesRig Project",
    defaultPath: `${safeName}.tsrig`,
    filters: projectFilter,
  });
}

export async function chooseProjectToOpen(): Promise<string | null> {
  const selection = await open({
    title: "Open TesRig Project",
    multiple: false,
    directory: false,
    filters: projectFilter,
  });
  return typeof selection === "string" ? selection : null;
}
