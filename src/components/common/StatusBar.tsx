import type { SimulationJob } from "../../features/cases/case.types";
import { simulationEta } from "../../features/cases/simulation-progress";

interface StatusBarProps {
  message: string;
  tone?: "neutral" | "error" | "success";
  simulation?: SimulationJob | null;
  busy?: boolean;
  onViewLogs?: () => void;
}

export function StatusBar({
  message,
  tone = "neutral",
  simulation,
  busy = false,
  onViewLogs,
}: StatusBarProps) {
  const active = Boolean(
    simulation && ["Starting", "Running", "Cancelling"].includes(simulation.status),
  );
  const eta = simulationEta(simulation ?? null);
  const solverFinished = active && simulation?.progress === 100;
  return (
    <footer className={`status-bar status-bar--${tone}`} aria-live="polite">
      <span className="status-bar__indicator" />
      <span className="status-bar__message">
        {solverFinished
          ? "Simulation complete · processing results"
          : active
            ? "Simulation running"
            : message}
      </span>
      {simulation && (
        <>
          {active && (
            <div
              className="status-bar__progress"
              title={`${simulation.stage} · ${Math.round(simulation.progress)}%`}
            >
              <progress max={100} value={simulation.progress} />
              <span>{Math.round(simulation.progress)}%</span>
              <span>{eta ? `${simulation.stage} · ETA ${eta}` : simulation.stage}</span>
            </div>
          )}
          <button className="status-bar__logs" type="button" onClick={onViewLogs}>
            View logs
          </button>
        </>
      )}
      {!active && busy ? (
        <div className="status-bar__progress status-bar__progress--io" title={message}>
          <progress aria-label="File operation in progress" />
          <span>Working</span>
          <span>File I/O</span>
        </div>
      ) : null}
    </footer>
  );
}
