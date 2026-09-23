import type { SimulationJob } from "../../features/cases/case.types";

interface StatusBarProps {
  message: string;
  tone?: "neutral" | "error" | "success";
  simulation?: SimulationJob | null;
  onViewLogs?: () => void;
}

export function StatusBar({ message, tone = "neutral", simulation, onViewLogs }: StatusBarProps) {
  const active = Boolean(
    simulation && ["Starting", "Running", "Cancelling"].includes(simulation.status),
  );
  return (
    <footer className={`status-bar status-bar--${tone}`} aria-live="polite">
      <span className="status-bar__indicator" />
      <span className="status-bar__message">{active ? "Simulation running" : message}</span>
      {simulation && (
        <>
          {active && (
            <div
              className="status-bar__progress"
              title={`${simulation.stage} · ${Math.round(simulation.progress)}%`}
            >
              <progress max={100} value={simulation.progress} />
              <span>{Math.round(simulation.progress)}%</span>
              <span>{simulation.stage}</span>
            </div>
          )}
          <button className="status-bar__logs" type="button" onClick={onViewLogs}>
            View logs
          </button>
        </>
      )}
    </footer>
  );
}
