import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import { toUserMessage } from "../../../lib/errors/app-error";
import { GeometryViewer } from "../../geometry/components/GeometryViewer";
import type { GeometryAsset, UpAxis } from "../../projects/project.types";
import { getOpenFoamGeometryData } from "../case.api";
import { resolveFlowDirection } from "../flow-direction";
import type {
  BoundaryBox,
  BoundaryCondition,
  BoundaryType,
  CfdSetup,
  OpenFoamGeometryData,
} from "../case.types";

interface OpenFoamGeometryInspectorProps {
  projectId: string;
  caseId: string;
  setup: CfdSetup;
  upAxis: UpAxis;
}

interface DisplayBoundary extends BoundaryCondition {
  generatedDefault: boolean;
}

const DOMAIN_FACES = [
  { surface: "domain:xMin", patchName: "xMin", label: "X min" },
  { surface: "domain:xMax", patchName: "xMax", label: "X max" },
  { surface: "domain:yMin", patchName: "yMin", label: "Y min" },
  { surface: "domain:yMax", patchName: "yMax", label: "Y max" },
  { surface: "domain:zMin", patchName: "zMin", label: "Z min" },
  { surface: "domain:zMax", patchName: "zMax", label: "Z max" },
] as const;

const BOUNDARY_COLORS: Record<BoundaryType, number> = {
  Inlet: 0x4fd49a,
  Outlet: 0xff9f5a,
  Wall: 0xb8c2ca,
  Symmetry: 0xc69cff,
  Slip: 0x64d8ff,
};

function defaultDomainType(surface: string, velocity: [number, number, number]): BoundaryType {
  const magnitudes = velocity.map((component) => Math.abs(component));
  const axis = magnitudes.indexOf(Math.max(...magnitudes));
  const axisName = ["x", "y", "z"][axis];
  const positiveFlow = velocity[axis] >= 0;
  if (surface === `domain:${axisName}${positiveFlow ? "Min" : "Max"}`) return "Inlet";
  if (surface === `domain:${axisName}${positiveFlow ? "Max" : "Min"}`) return "Outlet";
  return "Slip";
}

function openFoamWord(value: string) {
  const word = value.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  return /^\d/.test(word) ? `_${word}` : word;
}

function effectiveDomainBoundaries(setup: CfdSetup): DisplayBoundary[] {
  return DOMAIN_FACES.map(({ surface, patchName }) => {
    const configured = setup.boundaries.find((boundary) => boundary.surface === surface);
    return configured
      ? { ...configured, patchName: openFoamWord(configured.patchName), generatedDefault: false }
      : {
          surface,
          patchName,
          boundaryType: defaultDomainType(surface, setup.initialConditions.velocity),
          velocity: setup.initialConditions.velocity,
          gaugePressure: setup.initialConditions.gaugePressure,
          generatedDefault: true,
        };
  });
}

function effectiveGeometryBoundaries(setup: CfdSetup): DisplayBoundary[] {
  const configured = setup.boundaries
    .filter(({ surface }) => !surface.startsWith("domain:"))
    .map((boundary) => ({
      ...boundary,
      patchName: openFoamWord(boundary.patchName),
      generatedDefault: false,
    }));
  const needsDefault =
    configured.length === 0 ||
    (setup.flowDomain === "Internal" &&
      !configured.some(({ patchName }) => patchName === "geometry"));
  return needsDefault
    ? [
        {
          surface: "geometry",
          patchName: "geometry",
          boundaryType: "Wall",
          velocity: [0, 0, 0],
          gaugePressure: 0,
          generatedDefault: true,
        },
        ...configured,
      ]
    : configured;
}

function effectiveMeshingBox(setup: CfdSetup): BoundaryBox {
  if (setup.boundaryBox) return setup.boundaryBox;
  const padding = setup.mesh.domainPadding;
  return { min: [-padding, -padding, -padding], max: [padding, padding, padding] };
}

function formatVector(vector: [number, number, number]) {
  return `(${vector.map((value) => value.toPrecision(4)).join(", ")})`;
}

function boundaryDetail(boundary: BoundaryCondition, density: number) {
  if (boundary.boundaryType === "Inlet") return `U = ${formatVector(boundary.velocity)} m/s`;
  if (boundary.boundaryType === "Outlet") {
    return `p = ${(boundary.gaugePressure / density).toPrecision(4)} m²/s² (${boundary.gaugePressure.toPrecision(4)} Pa)`;
  }
  if (boundary.boundaryType === "Wall") return "No-slip velocity";
  if (boundary.boundaryType === "Symmetry") return "Symmetry plane";
  return "Slip / zero normal flow";
}

function BoundaryList({
  boundaries,
  density,
  selectedSurface,
  onSelect,
}: {
  boundaries: DisplayBoundary[];
  density: number;
  selectedSurface: string | null;
  onSelect: (surface: string) => void;
}) {
  return (
    <div className="openfoam-boundary-list">
      {boundaries.map((boundary) => {
        const domainFace = DOMAIN_FACES.find(({ surface }) => surface === boundary.surface);
        const color = `#${BOUNDARY_COLORS[boundary.boundaryType].toString(16).padStart(6, "0")}`;
        return (
          <button
            key={`${boundary.surface}-${boundary.patchName}`}
            type="button"
            className={selectedSurface === boundary.surface ? "is-active" : ""}
            onClick={() => onSelect(boundary.surface)}
          >
            <i style={{ backgroundColor: color }} />
            <span>
              <strong>{boundary.patchName}</strong>
              <small>
                {domainFace?.label ?? boundary.surface} · {boundary.boundaryType}
                {boundary.generatedDefault ? " · generated default" : ""}
              </small>
            </span>
            <em>{boundaryDetail(boundary, density)}</em>
          </button>
        );
      })}
    </div>
  );
}

export function OpenFoamGeometryInspector({
  projectId,
  caseId,
  setup,
  upAxis,
}: OpenFoamGeometryInspectorProps) {
  const [output, setOutput] = useState<OpenFoamGeometryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadRequest, setReloadRequest] = useState(0);
  const [selectedSurface, setSelectedSurface] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setOutput(null);
    setError(null);
    void getOpenFoamGeometryData(projectId, caseId)
      .then((next) => {
        if (!disposed) setOutput(next);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(toUserMessage(reason));
      });
    return () => {
      disposed = true;
    };
  }, [caseId, projectId, reloadRequest]);

  const geometry = useMemo<GeometryAsset | null>(
    () =>
      output
        ? {
            id: `openfoam-${caseId}-${output.fileName}`,
            name: output.fileName,
            fileName: output.fileName,
            format: output.format,
            sizeBytes: output.bytes.length,
            createdAt: "",
          }
        : null,
    [caseId, output],
  );
  const reload = useCallback(() => setReloadRequest((request) => request + 1), []);
  const domainBoundaries = useMemo(() => effectiveDomainBoundaries(setup), [setup]);
  const geometryBoundaries = useMemo(() => effectiveGeometryBoundaries(setup), [setup]);
  const meshingBox = useMemo(() => effectiveMeshingBox(setup), [setup]);
  const flowDirection = useMemo(() => resolveFlowDirection(setup), [setup]);
  const boundaryFaceColors = useMemo(
    () =>
      Object.fromEntries(
        domainBoundaries.map((boundary) => [
          boundary.surface,
          BOUNDARY_COLORS[boundary.boundaryType],
        ]),
      ),
    [domainBoundaries],
  );
  const surfaceColors = useMemo(
    () =>
      Object.fromEntries(
        geometryBoundaries.flatMap((boundary) => {
          const color = BOUNDARY_COLORS[boundary.boundaryType];
          return [
            [boundary.surface, color],
            [boundary.patchName, color],
          ];
        }),
      ),
    [geometryBoundaries],
  );
  const defaultSurfaceColor =
    BOUNDARY_COLORS[
      setup.flowDomain === "Internal" ? "Wall" : (geometryBoundaries[0]?.boundaryType ?? "Wall")
    ];

  if (!geometry || !output) {
    return (
      <div className="geometry-viewer openfoam-geometry-inspector__empty">
        <div className="geometry-viewer__message">
          <strong>{error ? "OpenFOAM geometry unavailable" : "Reading OpenFOAM geometry…"}</strong>
          {error ? <span>{error}</span> : null}
          {error ? (
            <Button variant="ghost" onClick={reload}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <GeometryViewer
      projectId={projectId}
      geometry={geometry}
      geometryData={output.bytes}
      upAxis={upAxis}
      selectedSurface={selectedSurface}
      onSurfaceSelect={setSelectedSurface}
      boundaryBox={setup.flowDomain === "External" ? meshingBox : null}
      flowDirection={flowDirection}
      boundaryFaceColors={boundaryFaceColors}
      surfaceColors={surfaceColors}
      defaultSurfaceColor={defaultSurfaceColor}
      showFlowDirection
    >
      <aside className="openfoam-geometry-inspector" aria-label="OpenFOAM calculation inputs">
        <header>
          <div>
            <span>Exact OpenFOAM input</span>
            <strong>{output.fileName}</strong>
            <small>{output.bytes.length.toLocaleString()} bytes · constant/triSurface</small>
          </div>
          <button type="button" onClick={reload}>
            Reload
          </button>
        </header>

        <section>
          <span>Calculation region</span>
          <strong>
            {setup.flowDomain === "External"
              ? "Inside the displayed boundary box"
              : "Inside the generated geometry volume"}
          </strong>
          <small>
            Mesh envelope min {formatVector(meshingBox.min)} · max {formatVector(meshingBox.max)}
          </small>
          <small>Resolved flow direction {formatVector(flowDirection)}</small>
        </section>

        {setup.flowDomain === "External" ? (
          <section>
            <span>Domain boundary conditions</span>
            <BoundaryList
              boundaries={domainBoundaries}
              density={setup.fluid.density}
              selectedSurface={selectedSurface}
              onSelect={setSelectedSurface}
            />
          </section>
        ) : null}

        <section>
          <span>Geometry boundary conditions</span>
          <BoundaryList
            boundaries={geometryBoundaries}
            density={setup.fluid.density}
            selectedSurface={selectedSurface}
            onSelect={setSelectedSurface}
          />
        </section>
      </aside>
    </GeometryViewer>
  );
}
