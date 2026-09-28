import type { BoundaryBox } from "./case.types";

export const MAX_BACKGROUND_CELLS = 500_000;
export const MAX_BACKGROUND_AXIS_CELLS = 500;

export interface BackgroundMeshPlan {
  cells: [number, number, number];
  cellCount: number;
  requestedCellCount: number;
  effectiveCellSize: number;
  limited: boolean;
}

export function createBackgroundMeshPlan(
  box: BoundaryBox,
  requestedCellSize: number,
): BackgroundMeshPlan | null {
  const spans = box.max.map((value, axis) => value - box.min[axis]) as [number, number, number];
  if (
    !Number.isFinite(requestedCellSize) ||
    requestedCellSize <= 0 ||
    spans.some((span) => !Number.isFinite(span) || span <= 0)
  ) {
    return null;
  }

  const requestedCells = spans.map((span) => Math.max(4, Math.ceil(span / requestedCellSize)));
  const requestedCellCount = requestedCells.reduce((product, count) => product * count, 1);
  let effectiveCellSize = Math.max(
    requestedCellSize,
    ...spans.map((span) => span / MAX_BACKGROUND_AXIS_CELLS),
  );
  let cells = spans.map((span) => Math.max(4, Math.ceil(span / effectiveCellSize))) as [
    number,
    number,
    number,
  ];

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const cellCount = cells.reduce((product, count) => product * count, 1);
    if (cellCount <= MAX_BACKGROUND_CELLS) break;
    const scale = Math.max(Math.cbrt(cellCount / MAX_BACKGROUND_CELLS) * 1.001, 1.01);
    effectiveCellSize *= scale;
    cells = spans.map((span) => Math.max(4, Math.ceil(span / effectiveCellSize))) as [
      number,
      number,
      number,
    ];
  }

  const cellCount = cells.reduce((product, count) => product * count, 1);
  return {
    cells,
    cellCount,
    requestedCellCount,
    effectiveCellSize,
    limited: effectiveCellSize > requestedCellSize * 1.000001,
  };
}

export function formatCellCount(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} billion`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} million`;
  return Math.round(value).toLocaleString();
}
