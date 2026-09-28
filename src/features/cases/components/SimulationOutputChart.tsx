import { useMemo, type CSSProperties } from "react";
import type { SimulationLog } from "../case.types";
import {
  aggregateSimulationSamples,
  parseSimulationSamples,
  type SimulationSample,
} from "../simulation-output";

const series = [
  { key: "ux", label: "Ux", color: "#72cfff" },
  { key: "uy", label: "Uy", color: "#78d6a3" },
  { key: "uz", label: "Uz", color: "#c49cff" },
] as const;

function displayValue(value: number | null, exponential = false) {
  if (value === null || !Number.isFinite(value)) return "—";
  return exponential ? value.toExponential(2) : value.toPrecision(4);
}

export function SimulationOutputChart({
  log,
  collapsed,
  onToggleCollapsed,
}: {
  log: SimulationLog | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const allSamples = useMemo(() => parseSimulationSamples(log?.stdout ?? ""), [log?.stdout]);
  const samples = useMemo(() => aggregateSimulationSamples(allSamples), [allSamples]);
  const latest = allSamples.at(-1) ?? null;

  const left = 40;
  const right = 374;
  const top = 15;
  const bottom = 132;
  const times = samples.map(({ time }) => time);
  const timeMin = times.length > 0 ? Math.min(...times) : 0;
  const timeMax = times.length > 0 ? Math.max(...times) : 1;
  const timeSpan = Math.max(timeMax - timeMin, Number.EPSILON);
  const velocities = samples.flatMap((sample) =>
    [sample.ux, sample.uy, sample.uz].filter((value): value is number => value !== null),
  );
  let velocityMin = Math.min(...velocities, 0);
  let velocityMax = Math.max(...velocities, 0);
  const velocityPadding = Math.max((velocityMax - velocityMin) * 0.08, 1e-6);
  velocityMin -= velocityPadding;
  velocityMax += velocityPadding;
  const velocitySpan = velocityMax - velocityMin;
  const errors = samples
    .map(({ error }) => error)
    .filter((value): value is number => value !== null && value > 0);
  const errorMin = errors.length > 0 ? Math.min(...errors) : 1e-8;
  const errorMax = errors.length > 0 ? Math.max(...errors) : 1;
  const errorLogMin = Math.log10(Math.max(errorMin / 1.2, 1e-16));
  const errorLogMax = Math.log10(Math.max(errorMax * 1.2, 1e-15));
  const errorLogSpan = Math.max(errorLogMax - errorLogMin, 1);

  const x = (sample: SimulationSample, index: number) =>
    samples.length === 1
      ? (left + right) / 2
      : left + ((sample.time - timeMin) / timeSpan) * (right - left) ||
        left + (index / Math.max(samples.length - 1, 1)) * (right - left);
  const velocityY = (value: number) =>
    bottom - ((value - velocityMin) / velocitySpan) * (bottom - top);
  const errorY = (value: number) =>
    bottom - ((Math.log10(Math.max(value, 1e-16)) - errorLogMin) / errorLogSpan) * (bottom - top);
  const makePath = (key: "ux" | "uy" | "uz") => {
    let path = "";
    let drawing = false;
    samples.forEach((sample, index) => {
      const value = sample[key];
      if (value === null) {
        drawing = false;
        return;
      }
      path += `${drawing ? " L" : "M"} ${x(sample, index).toFixed(2)} ${velocityY(value).toFixed(2)}`;
      drawing = true;
    });
    return path;
  };
  let errorPath = "";
  let drawingError = false;
  samples.forEach((sample, index) => {
    if (!sample.error || sample.error <= 0) {
      drawingError = false;
      return;
    }
    errorPath += `${drawingError ? " L" : "M"} ${x(sample, index).toFixed(2)} ${errorY(sample.error).toFixed(2)}`;
    drawingError = true;
  });

  return (
    <section
      className={`simulation-chart simulation-chart-popup ${collapsed ? "is-collapsed" : ""}`}
      aria-label="OpenFOAM velocity and residual history"
    >
      <header className="simulation-chart__header">
        <div>
          <strong>Solver output</strong>
          <span>Time vs velocity and error</span>
        </div>
        <small>
          {allSamples.length > 0
            ? `${allSamples.length} samples · ${samples.length} plotted`
            : "Waiting for samples"}
        </small>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand solver output chart" : "Collapse solver output chart"}
        >
          {collapsed ? "‹" : "›"}
        </button>
      </header>
      {!collapsed && (
        <>
          <div className="simulation-chart__legend">
            {series.map(({ key, label, color }) => (
              <span key={key} style={{ "--series-color": color } as CSSProperties}>
                {label} {displayValue(latest?.[key] ?? null)}
              </span>
            ))}
            <span style={{ "--series-color": "#ffb454" } as CSSProperties}>
              Error {displayValue(latest?.error ?? null, true)}
            </span>
          </div>
          <svg viewBox="0 0 400 154" role="img" aria-label="Aggregated solver history chart">
            {[0, 1, 2, 3].map((row) => {
              const y = top + (row / 3) * (bottom - top);
              return (
                <line
                  key={row}
                  className="simulation-chart__grid"
                  x1={left}
                  x2={right}
                  y1={y}
                  y2={y}
                />
              );
            })}
            <line className="simulation-chart__axis" x1={left} x2={left} y1={top} y2={bottom} />
            <line className="simulation-chart__axis" x1={left} x2={right} y1={bottom} y2={bottom} />
            {series.map(({ key, color }) => (
              <path key={key} d={makePath(key)} fill="none" stroke={color} strokeWidth="1.6" />
            ))}
            <path
              d={errorPath}
              fill="none"
              stroke="#ffb454"
              strokeDasharray="4 3"
              strokeWidth="1.4"
            />
            {samples.length === 0 && (
              <text className="simulation-chart__empty" x="207" y="77" textAnchor="middle">
                Velocity samples appear when the solver starts
              </text>
            )}
            <text className="simulation-chart__label" x={left} y="148">
              {samples.length > 0 ? timeMin.toPrecision(4) : "0"}
            </text>
            <text className="simulation-chart__label" x={right} y="148" textAnchor="end">
              time {samples.length > 0 ? timeMax.toPrecision(4) : "—"}
            </text>
            <text className="simulation-chart__label" x="3" y="12">
              U
            </text>
            <text className="simulation-chart__label" x="397" y="12" textAnchor="end">
              Error (log)
            </text>
          </svg>
        </>
      )}
    </section>
  );
}
