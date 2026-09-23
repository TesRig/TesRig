import { spawn } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriCli = path.join(repositoryRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(process.execPath, [tauriCli, "dev"], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    TESRIG_DEV_PROJECT: path.join(repositoryRoot, "sandbox", "projects", "wing.tsrig"),
    TESRIG_DEV_GEOMETRY: path.join(repositoryRoot, "sandbox", "assets", "Wing.step"),
    TESRIG_OPENFOAM_NATIVE_ROOT: "E:\\OpenFOAM\\v2606",
    VITE_TESRIG_DEV_AUTORUN: "1",
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(`Could not start the TesRig test workspace: ${error.message}`);
  process.exitCode = 1;
});
