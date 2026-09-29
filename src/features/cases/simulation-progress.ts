import type { SimulationJob } from "./case.types";

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

export function simulationEta(job: SimulationJob | null) {
  if (!job || job.status !== "Running" || job.progress <= 1 || job.progress >= 100) return null;
  const startedAt = Date.parse(job.startedAt);
  if (!Number.isFinite(startedAt)) return null;
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  if (elapsedSeconds <= 0) return null;
  return formatDuration((elapsedSeconds * (100 - job.progress)) / job.progress);
}
