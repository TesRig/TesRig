import type { CfdSetup } from "./case.types";

export type CardinalDirection = [number, number, number];

interface DomainFace {
  axis: 0 | 1 | 2;
  side: "min" | "max";
}

export function parseDomainFace(surface: string): DomainFace | null {
  const match = surface.match(/^domain:([xyz])(Min|Max)$/);
  if (!match) return null;
  return {
    axis: { x: 0, y: 1, z: 2 }[match[1] as "x" | "y" | "z"] as 0 | 1 | 2,
    side: match[2] === "Min" ? "min" : "max",
  };
}

export function cardinalFlowDirection(velocity: [number, number, number]): CardinalDirection {
  const components = velocity.map((value) => (Number.isFinite(value) ? Math.abs(value) : 0));
  const axis = components.indexOf(Math.max(...components));
  const direction: CardinalDirection = [0, 0, 0];
  direction[axis] = velocity[axis] < 0 ? -1 : 1;
  return direction;
}

export function resolveFlowDirection(setup: CfdSetup): CardinalDirection {
  const domainBoundaries = setup.boundaries.flatMap((boundary) => {
    const face = parseDomainFace(boundary.surface);
    return face ? [{ boundary, face }] : [];
  });
  const inlets = domainBoundaries.filter(({ boundary }) => boundary.boundaryType === "Inlet");
  const outlets = domainBoundaries.filter(({ boundary }) => boundary.boundaryType === "Outlet");
  const pairedInlet = inlets.find(({ face: inletFace }) =>
    outlets.some(
      ({ face: outletFace }) =>
        outletFace.axis === inletFace.axis && outletFace.side !== inletFace.side,
    ),
  );
  const resolved = pairedInlet ?? inlets[0] ?? outlets[0];
  if (!resolved) return cardinalFlowDirection(setup.initialConditions.velocity);

  const { boundary, face } = resolved;
  const direction: CardinalDirection = [0, 0, 0];
  if (boundary.boundaryType === "Inlet") {
    direction[face.axis] = face.side === "min" ? 1 : -1;
  } else {
    direction[face.axis] = face.side === "min" ? -1 : 1;
  }
  return direction;
}
