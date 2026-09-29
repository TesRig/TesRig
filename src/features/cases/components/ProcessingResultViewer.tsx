import { useMemo, type CSSProperties } from "react";
import type { ProcessingResult } from "../case.types";

interface NumericSeries {
  label: string;
  values: number[];
}

const SERIES_COLORS = ["#72cfff", "#78d6a3", "#c49cff", "#ffb454", "#ff7f91", "#8ee6d2"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericValues(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return value as number[];
  }
  if (
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length > 0 &&
        item.every((component) => typeof component === "number" && Number.isFinite(component)),
    )
  ) {
    return value.map((item) =>
      Math.sqrt((item as number[]).reduce((sum, component) => sum + component * component, 0)),
    );
  }
  return null;
}

function resultSeries(result: ProcessingResult): NumericSeries[] {
  const directValues = numericValues(result.data);
  if (directValues) return [{ label: result.name, values: directValues }];
  if (!isRecord(result.data)) return [];
  if (result.kind === "probe") {
    const values = numericValues(result.data.values);
    return values ? [{ label: "Probe value", values }] : [];
  }
  const source =
    result.kind === "table" && isRecord(result.data.columns) ? result.data.columns : result.data;
  return Object.entries(source)
    .flatMap(([label, value]) => {
      const values = numericValues(value);
      return values ? [{ label, values }] : [];
    })
    .slice(0, SERIES_COLORS.length);
}

function resultMetrics(value: unknown, prefix = "", depth = 0): Array<[string, number]> {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [[prefix || "value", value]];
  }
  if (!isRecord(value) || depth > 2) return [];
  const metrics: Array<[string, number]> = [];
  for (const [key, item] of Object.entries(value)) {
    const label = prefix ? `${prefix} · ${key}` : key;
    if (typeof item === "number" && Number.isFinite(item)) {
      metrics.push([label, item]);
    } else if (isRecord(item)) {
      metrics.push(...resultMetrics(item, label, depth + 1));
    }
    if (metrics.length >= 12) break;
  }
  return metrics.slice(0, 12);
}

function displayNumber(value: number) {
  if (value === 0) return "0";
  if (Math.abs(value) >= 10000 || Math.abs(value) < 0.001) return value.toExponential(3);
  return Number(value.toPrecision(5)).toString();
}

function sampleSeries(values: number[], count = 180) {
  if (values.length <= count) return values;
  const sampled: number[] = [];
  for (let index = 0; index < count; index += 1) {
    sampled.push(values[Math.round((index / (count - 1)) * (values.length - 1))]);
  }
  return sampled;
}

function NumericSeriesChart({ series }: { series: NumericSeries[] }) {
  const width = 420;
  const height = 156;
  const left = 42;
  const right = 408;
  const top = 12;
  const bottom = 132;
  const sampled = series.map(({ label, values }) => ({ label, values: sampleSeries(values) }));
  const allValues = sampled.flatMap(({ values }) => values);
  const minimum = Math.min(...allValues);
  const maximum = Math.max(...allValues);
  const span = Math.max(maximum - minimum, Number.EPSILON);
  const longest = Math.max(...sampled.map(({ values }) => values.length), 1);
  const paths = sampled.map(({ values }) =>
    values
      .map((value, index) => {
        const x = left + (index / Math.max(longest - 1, 1)) * (right - left);
        const y = bottom - ((value - minimum) / span) * (bottom - top);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" "),
  );

  return (
    <div className="processing-result__chart">
      <div className="processing-result__legend">
        {sampled.map(({ label }, index) => (
          <span key={label} style={{ "--result-color": SERIES_COLORS[index] } as CSSProperties}>
            {label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Processing result chart">
        {[0, 1, 2, 3].map((row) => {
          const y = top + (row / 3) * (bottom - top);
          return (
            <line
              key={row}
              className="processing-result__grid"
              x1={left}
              x2={right}
              y1={y}
              y2={y}
            />
          );
        })}
        {paths.map((path, index) => (
          <path
            key={sampled[index].label}
            d={path}
            fill="none"
            stroke={SERIES_COLORS[index]}
            strokeWidth="1.7"
          />
        ))}
        <text className="processing-result__axis-label" x="2" y={top + 4}>
          {displayNumber(maximum)}
        </text>
        <text className="processing-result__axis-label" x="2" y={bottom}>
          {displayNumber(minimum)}
        </text>
        <text className="processing-result__axis-label" x={right} y="150" textAnchor="end">
          {longest} samples
        </text>
      </svg>
    </div>
  );
}

function ResultTable({ result }: { result: ProcessingResult }) {
  if (result.kind !== "table" || !isRecord(result.data) || !isRecord(result.data.columns)) {
    return null;
  }
  const columns = Object.entries(result.data.columns)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .slice(0, 6);
  const rowCount = Math.min(8, ...columns.map(([, values]) => values.length));
  if (columns.length === 0 || !Number.isFinite(rowCount)) return null;

  return (
    <div className="processing-result__table-wrap">
      <table className="processing-result__table">
        <thead>
          <tr>
            {columns.map(([name]) => (
              <th key={name}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }, (_, row) => (
            <tr key={row}>
              {columns.map(([name, values]) => (
                <td key={name}>{String(values[row] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProcessingResultViewer({ result }: { result: ProcessingResult }) {
  const series = useMemo(() => resultSeries(result), [result]);
  const metrics = useMemo(() => resultMetrics(result.data), [result.data]);

  return (
    <article className="processing-result">
      <header className="processing-result__header">
        <div>
          <strong>{result.name}</strong>
          <span>
            {result.kind} · schema {result.schemaVersion}
          </span>
        </div>
        <time>{new Date(result.updatedAt).toLocaleString()}</time>
      </header>
      <div className="processing-result__body">
        {series.length > 0 ? <NumericSeriesChart series={series} /> : null}
        {metrics.length > 0 ? (
          <dl className="processing-result__metrics">
            {metrics.map(([label, value]) => (
              <div key={label}>
                <dt>{label.replaceAll("_", " ")}</dt>
                <dd>{displayNumber(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <ResultTable result={result} />
        {series.length === 0 && metrics.length === 0 ? (
          <p className="processing-result__empty">
            This result does not contain chartable numeric data.
          </p>
        ) : null}
        <details className="processing-result__raw">
          <summary>Raw file data</summary>
          <pre>{JSON.stringify({ metadata: result.metadata, data: result.data }, null, 2)}</pre>
        </details>
      </div>
    </article>
  );
}
