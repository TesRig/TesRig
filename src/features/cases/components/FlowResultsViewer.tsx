import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import { toUserMessage } from "../../../lib/errors/app-error";
import { getGeometryData } from "../../geometry/geometry.api";
import { createGeometryModel } from "../../geometry/geometry-model";
import type { GeometryAsset, UpAxis } from "../../projects/project.types";
import type { CfdSetup, FlowSnapshot } from "../case.types";
import { listFlowVisualizationExtensions } from "../flow-extension-api";

type ProbeKind = "domain" | "line" | "point" | "connections" | "surface" | "slice";
type SliceField = "pressure" | "velocity";

interface ProbeSettings {
  id: string;
  color: number;
  visible: boolean;
  kind: ProbeKind;
  density: number;
  radius: number;
  normalDistance: number;
  reverse: boolean;
  sliceAxis: 0 | 1 | 2;
  slicePosition: number;
  sliceField: SliceField;
}

interface FlowResultsViewerProps {
  projectId: string;
  geometry: GeometryAsset;
  setup: CfdSetup;
  snapshot: FlowSnapshot | null;
  isPreview: boolean;
  selectedSurface: string | null;
  onSurfaceSelect: (surface: string) => void;
  upAxis: UpAxis;
  onUpAxisChange: (upAxis: UpAxis) => void;
  addProbeRequest: number;
  onProbeCountChange: (count: number) => void;
  leftPanel?: ReactNode;
  children?: ReactNode;
}

interface ParticleSet {
  points: THREE.Points;
  curves: THREE.CatmullRomCurve3[];
  offsets: number[];
}

interface SceneState {
  scene: THREE.Scene;
  model: THREE.Object3D;
  modelBounds: THREE.Box3;
  displayDomain: THREE.Box3;
  flowGroup: THREE.Group;
  domainGroup: THREE.Group;
  sliceGroup: THREE.Group;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  viewHelper: ViewHelper;
  particleSets: ParticleSet[];
}

const PROBE_COLORS = [0x64d8ff, 0xffb45c, 0x8be39b, 0xc69cff, 0xff7196, 0xf4df4e];
const DOMAIN_FACES = [
  { id: "domain:xMin", axis: 0, side: "min" },
  { id: "domain:xMax", axis: 0, side: "max" },
  { id: "domain:yMin", axis: 1, side: "min" },
  { id: "domain:yMax", axis: 1, side: "max" },
  { id: "domain:zMin", axis: 2, side: "min" },
  { id: "domain:zMax", axis: 2, side: "max" },
] as const;

function createProbe(index: number, kind: ProbeKind = index === 0 ? "connections" : "line") {
  return {
    id: `probe-${Date.now()}-${index}`,
    color: PROBE_COLORS[index % PROBE_COLORS.length],
    visible: true,
    kind,
    density: 1.2,
    radius: 0.25,
    normalDistance: 0.1,
    reverse: false,
    sliceAxis: 0 as const,
    slicePosition: 0.5,
    sliceField: "pressure" as const,
  } satisfies ProbeSettings;
}

const PROBE_OPTIONS = listFlowVisualizationExtensions().filter(
  (extension): extension is typeof extension & { id: ProbeKind } =>
    ["domain", "line", "point", "connections", "surface", "slice"].includes(extension.id),
);

function finiteVelocity(snapshot: FlowSnapshot | null, fallback: [number, number, number]) {
  const velocity = snapshot?.velocityMean ?? fallback;
  const vector = new THREE.Vector3(...velocity);
  return vector.lengthSq() > 1e-12 ? vector : new THREE.Vector3(1, 0, 0);
}

function cardinalDirection(velocity: THREE.Vector3) {
  const components = velocity.toArray().map(Math.abs);
  const axis = components.indexOf(Math.max(...components));
  const direction = new THREE.Vector3();
  direction.setComponent(axis, velocity.getComponent(axis) < 0 ? -1 : 1);
  return direction;
}

function connectionDirection(setup: CfdSetup) {
  const inlet = setup.boundaries.find(
    ({ boundaryType, surface }) => boundaryType === "Inlet" && surface.startsWith("domain:"),
  );
  if (!inlet) return cardinalDirection(new THREE.Vector3(...setup.initialConditions.velocity));
  const match = inlet.surface.match(/^domain:([xyz])(Min|Max)$/);
  if (!match) return cardinalDirection(new THREE.Vector3(...setup.initialConditions.velocity));
  const axis = { x: 0, y: 1, z: 2 }[match[1] as "x" | "y" | "z"];
  const direction = new THREE.Vector3();
  direction.setComponent(axis, match[2] === "Min" ? 1 : -1);
  return direction;
}

function heatColor(value: number) {
  const normalized = THREE.MathUtils.clamp(value, 0, 1);
  return new THREE.Color().setHSL((1 - normalized) * 0.64, 0.88, 0.56);
}

function setSurfacePressure(model: THREE.Object3D, enabled: boolean, direction: THREE.Vector3) {
  const axis = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)].indexOf(
    Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)),
  );
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (enabled && position) {
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      if (bounds) {
        const colors = new Float32Array(position.count * 3);
        const span = Math.max(bounds.max.getComponent(axis) - bounds.min.getComponent(axis), 1e-9);
        for (let index = 0; index < position.count; index += 1) {
          const fraction =
            (position.getComponent(index, axis) - bounds.min.getComponent(axis)) / span;
          const color = heatColor(direction.getComponent(axis) >= 0 ? 1 - fraction : fraction);
          colors[index * 3] = color.r;
          colors[index * 3 + 1] = color.g;
          colors[index * 3 + 2] = color.b;
        }
        object.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.vertexColors = enabled;
        material.needsUpdate = true;
      }
    });
  });
}

function setSurfaceSelection(model: THREE.Object3D, surface: string | null) {
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissiveIntensity = object.userData.tesrigSurface === surface ? 1.7 : 0.75;
      }
    });
  });
}

function disposeGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      if (
        object instanceof THREE.Line ||
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points
      ) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}

function addDomainBox(group: THREE.Group, bounds: THREE.Box3) {
  disposeGroup(group);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(...size.toArray())),
    new THREE.LineBasicMaterial({ color: 0x72cfff, transparent: true, opacity: 0.72 }),
  );
  wire.position.copy(center);
  group.add(wire);

  DOMAIN_FACES.forEach((face) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x72cfff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      }),
    );
    mesh.userData.tesrigBoundaryFace = face.id;
    mesh.position.copy(center);
    mesh.position.setComponent(
      face.axis,
      face.side === "min" ? bounds.min.getComponent(face.axis) : bounds.max.getComponent(face.axis),
    );
    if (face.axis === 0) {
      mesh.rotation.y = Math.PI / 2;
      mesh.scale.set(size.z, size.y, 1);
    } else if (face.axis === 1) {
      mesh.rotation.x = Math.PI / 2;
      mesh.scale.set(size.x, size.z, 1);
    } else {
      mesh.scale.set(size.x, size.y, 1);
    }
    mesh.renderOrder = 2;
    group.add(mesh);
  });
}

function setDomainSelection(group: THREE.Group, surface: string | null) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || typeof object.userData.tesrigBoundaryFace !== "string")
      return;
    const isSelected = object.userData.tesrigBoundaryFace === surface;
    const material = object.material as THREE.MeshBasicMaterial;
    material.color.setHex(0x72cfff);
    material.opacity = isSelected ? 0.3 : 0;
    object.renderOrder = isSelected ? 4 : 2;
  });
}

function probeMetric(settings: ProbeSettings, bounds: THREE.Box3, flowAxis: number) {
  const size = bounds.getSize(new THREE.Vector3());
  const crossAxes = [0, 1, 2].filter((axis) => axis !== flowAxis);
  if (settings.kind === "point") return (4 / 3) * Math.PI * settings.radius ** 3;
  if (settings.kind === "surface")
    return Math.max(size.getComponent(crossAxes[0]) * settings.normalDistance, 1e-6);
  return Math.max(size.getComponent(crossAxes[0]) * size.getComponent(crossAxes[1]), 1e-6);
}

function seedPoints(settings: ProbeSettings, bounds: THREE.Box3, direction: THREE.Vector3) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const components = direction.toArray().map(Math.abs);
  const flowAxis = components.indexOf(Math.max(...components));
  const crossAxes = [0, 1, 2].filter((axis) => axis !== flowAxis);
  const metric = probeMetric(settings, bounds, flowAxis);
  const count = THREE.MathUtils.clamp(Math.round(settings.density * metric), 5, 64);
  const seeds: THREE.Vector3[] = [];
  const flowSign = direction.getComponent(flowAxis) >= 0 ? 1 : -1;
  const upstream =
    flowSign > 0 ? bounds.min.getComponent(flowAxis) : bounds.max.getComponent(flowAxis);

  for (let index = 0; index < count; index += 1) {
    const point = center.clone();
    point.setComponent(flowAxis, upstream);
    const u = ((index * 0.61803398875) % 1) - 0.5;
    const v = ((index * 0.38196601125 + 0.31) % 1) - 0.5;
    if (settings.kind === "line") {
      point.setComponent(
        crossAxes[0],
        center.getComponent(crossAxes[0]) + u * size.getComponent(crossAxes[0]),
      );
      point.setComponent(crossAxes[1], center.getComponent(crossAxes[1]));
    } else if (settings.kind === "point") {
      const angle = index * 2.399963;
      const radial = settings.radius * Math.sqrt((index + 0.5) / count);
      point.copy(center);
      point.setComponent(
        crossAxes[0],
        center.getComponent(crossAxes[0]) + Math.cos(angle) * radial,
      );
      point.setComponent(
        crossAxes[1],
        center.getComponent(crossAxes[1]) + Math.sin(angle) * radial,
      );
      point.setComponent(flowAxis, center.getComponent(flowAxis) - flowSign * settings.radius);
    } else if (settings.kind === "surface") {
      point.setComponent(
        flowAxis,
        center.getComponent(flowAxis) - flowSign * settings.normalDistance,
      );
      point.setComponent(
        crossAxes[0],
        center.getComponent(crossAxes[0]) + u * size.getComponent(crossAxes[0]) * 0.45,
      );
      point.setComponent(
        crossAxes[1],
        center.getComponent(crossAxes[1]) + v * size.getComponent(crossAxes[1]) * 0.45,
      );
    } else {
      point.setComponent(
        crossAxes[0],
        center.getComponent(crossAxes[0]) + u * size.getComponent(crossAxes[0]) * 0.9,
      );
      point.setComponent(
        crossAxes[1],
        center.getComponent(crossAxes[1]) + v * size.getComponent(crossAxes[1]) * 0.9,
      );
    }
    seeds.push(point);
  }
  return { seeds, flowAxis, crossAxes, metric, flowSign };
}

function visibleFlowBounds(state: SceneState, direction: THREE.Vector3) {
  const bounds = state.modelBounds.clone();
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const characteristic = Math.max(size.x, size.y, size.z, 1e-6);
  const components = direction.toArray().map(Math.abs);
  const flowAxis = components.indexOf(Math.max(...components));
  const sign = direction.getComponent(flowAxis) >= 0 ? 1 : -1;

  for (let axis = 0; axis < 3; axis += 1) {
    if (axis === flowAxis) {
      const extent = Math.max(size.getComponent(axis), characteristic * 0.35);
      bounds.min.setComponent(axis, center.getComponent(axis) - extent * (sign > 0 ? 2.25 : 3.5));
      bounds.max.setComponent(axis, center.getComponent(axis) + extent * (sign > 0 ? 3.5 : 2.25));
    } else {
      const halfSpan = Math.max(size.getComponent(axis) * 0.9, characteristic * 0.22);
      bounds.min.setComponent(axis, center.getComponent(axis) - halfSpan);
      bounds.max.setComponent(axis, center.getComponent(axis) + halfSpan);
    }
    bounds.min.setComponent(
      axis,
      Math.max(bounds.min.getComponent(axis), state.displayDomain.min.getComponent(axis)),
    );
    bounds.max.setComponent(
      axis,
      Math.min(bounds.max.getComponent(axis), state.displayDomain.max.getComponent(axis)),
    );
  }
  return bounds;
}

function addSlice(state: SceneState, settings: ProbeSettings, bounds: THREE.Box3) {
  const sliceSize = bounds.getSize(new THREE.Vector3());
  const planeGeometry = new THREE.PlaneGeometry(1, 1, 24, 24);
  const planePositions = planeGeometry.getAttribute("position");
  const planeColors = new Float32Array(planePositions.count * 3);
  for (let index = 0; index < planePositions.count; index += 1) {
    const value = THREE.MathUtils.clamp(
      (planePositions.getX(index) + planePositions.getY(index) + 1) / 2,
      0,
      1,
    );
    const color = heatColor(value);
    planeColors[index * 3] = color.r;
    planeColors[index * 3 + 1] = color.g;
    planeColors[index * 3 + 2] = color.b;
  }
  planeGeometry.setAttribute("color", new THREE.BufferAttribute(planeColors, 3));
  const plane = new THREE.Mesh(
    planeGeometry,
    new THREE.MeshBasicMaterial({
      color: settings.color,
      vertexColors: true,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  plane.position.copy(bounds.min).lerp(bounds.max, 0.5);
  plane.position.setComponent(
    settings.sliceAxis,
    bounds.min.getComponent(settings.sliceAxis) +
      sliceSize.getComponent(settings.sliceAxis) * settings.slicePosition,
  );
  if (settings.sliceAxis === 0) {
    plane.rotation.y = Math.PI / 2;
    plane.scale.set(sliceSize.z, sliceSize.y, 1);
  } else if (settings.sliceAxis === 1) {
    plane.rotation.x = Math.PI / 2;
    plane.scale.set(sliceSize.x, sliceSize.z, 1);
  } else {
    plane.scale.set(sliceSize.x, sliceSize.y, 1);
  }
  state.sliceGroup.add(plane);
}

function rebuildFlow(
  state: SceneState,
  probes: ProbeSettings[],
  snapshot: FlowSnapshot | null,
  setup: CfdSetup,
  selectedSurface: string | null,
) {
  disposeGroup(state.flowGroup);
  disposeGroup(state.sliceGroup);
  state.particleSets.length = 0;
  const sourceDirection = finiteVelocity(snapshot, setup.initialConditions.velocity);
  const modelCenter = state.modelBounds.getCenter(new THREE.Vector3());
  const modelSize = state.modelBounds.getSize(new THREE.Vector3());
  const characteristic = Math.max(modelSize.x, modelSize.y, modelSize.z, 1e-6);

  probes
    .filter(({ visible }) => visible)
    .forEach((settings, probeIndex) => {
      const direction = (
        settings.kind === "connections" ? connectionDirection(setup) : sourceDirection
      )
        .clone()
        .normalize()
        .multiplyScalar(settings.reverse ? -1 : 1);
      const pathBounds = visibleFlowBounds(state, direction);
      if (settings.kind === "connections") {
        const components = direction.toArray().map(Math.abs);
        const connectionAxis = components.indexOf(Math.max(...components));
        pathBounds.min.setComponent(
          connectionAxis,
          state.displayDomain.min.getComponent(connectionAxis),
        );
        pathBounds.max.setComponent(
          connectionAxis,
          state.displayDomain.max.getComponent(connectionAxis),
        );
      }
      let seedBounds = pathBounds;
      if (settings.kind === "surface" && selectedSurface) {
        state.model.traverse((object) => {
          if (object.userData.tesrigSurface === selectedSurface) {
            const surfaceBounds = new THREE.Box3().setFromObject(object);
            if (!surfaceBounds.isEmpty()) seedBounds = surfaceBounds;
          }
        });
      }
      const { seeds, flowAxis, crossAxes, flowSign } = seedPoints(settings, seedBounds, direction);
      const pathSize = pathBounds.getSize(new THREE.Vector3());
      const length = pathSize.getComponent(flowAxis);
      const inletCoordinate =
        flowSign > 0
          ? pathBounds.min.getComponent(flowAxis)
          : pathBounds.max.getComponent(flowAxis);
      const modelUpstreamCoordinate =
        flowSign > 0
          ? state.modelBounds.min.getComponent(flowAxis)
          : state.modelBounds.max.getComponent(flowAxis);
      const inletToModel = Math.max(
        (modelUpstreamCoordinate - inletCoordinate) * flowSign,
        characteristic * 0.1,
      );
      const straightFraction = settings.kind === "connections" ? 0.9 : 0.68;
      const bendStart = inletCoordinate + flowSign * inletToModel * straightFraction;
      const bendDistance = Math.max(inletToModel * (1 - straightFraction), characteristic * 0.04);
      if (settings.kind === "slice") addSlice(state, settings, pathBounds);

      const curves: THREE.CatmullRomCurve3[] = [];
      seeds.forEach((seed, index) => {
        const curvePoints: THREE.Vector3[] = [];
        for (let step = 0; step <= 48; step += 1) {
          const t = step / 48;
          const point = seed.clone();
          point.setComponent(
            flowAxis,
            flowSign > 0
              ? pathBounds.min.getComponent(flowAxis) + length * t
              : pathBounds.max.getComponent(flowAxis) - length * t,
          );
          const along = point.getComponent(flowAxis) - modelCenter.getComponent(flowAxis);
          const flowExtent = Math.max(modelSize.getComponent(flowAxis), characteristic * 0.28);
          const bendProgress = THREE.MathUtils.smoothstep(
            (point.getComponent(flowAxis) - bendStart) * flowSign,
            0,
            bendDistance,
          );
          const influence = Math.exp(-Math.pow(along / (flowExtent * 1.15), 2)) * bendProgress;
          crossAxes.forEach((axis, crossIndex) => {
            const halfExtent = Math.max(modelSize.getComponent(axis) * 0.56, characteristic * 0.08);
            const relative =
              (seed.getComponent(axis) - modelCenter.getComponent(axis)) / halfExtent;
            const proximity = Math.exp(-relative * relative * 1.4);
            const side =
              Math.abs(relative) > 0.06 ? Math.sign(relative) : (index + crossIndex) % 2 ? 1 : -1;
            const displacement = side * halfExtent * 0.5 * influence * proximity;
            point.setComponent(axis, point.getComponent(axis) + displacement);
          });
          if (along * flowSign > 0) {
            const wake = Math.exp(-Math.abs(along) / Math.max(flowExtent * 2.5, 1e-6));
            point.setComponent(
              crossAxes[0],
              point.getComponent(crossAxes[0]) +
                Math.sin(t * Math.PI * 4 + index * 0.7) * characteristic * 0.018 * wake,
            );
          }
          curvePoints.push(point);
        }
        const curve = new THREE.CatmullRomCurve3(curvePoints);
        curves.push(curve);
        const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(110));
        const fraction = seeds.length <= 1 ? 0.5 : index / (seeds.length - 1);
        const color = new THREE.Color(settings.color).lerp(heatColor(fraction), 0.18);
        const line = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: settings.kind === "slice" ? 0.82 : 0.58,
            depthWrite: false,
          }),
        );
        state.flowGroup.add(line);
      });

      if (curves.length > 0) {
        const markerGeometry = new THREE.BufferGeometry();
        markerGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(curves.length * 3), 3),
        );
        const markers = new THREE.Points(
          markerGeometry,
          new THREE.PointsMaterial({
            color: settings.color,
            size: characteristic * 0.025,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
          }),
        );
        state.flowGroup.add(markers);
        state.particleSets.push({
          points: markers,
          curves,
          offsets: curves.map((_, index) => (index / curves.length + probeIndex * 0.17) % 1),
        });
      }
    });
}

function displayNumber(value: number | undefined, unit: string) {
  return value === undefined || !Number.isFinite(value)
    ? "Waiting"
    : `${value.toPrecision(4)} ${unit}`;
}

export function FlowResultsViewer({
  projectId,
  geometry,
  setup,
  snapshot,
  isPreview,
  selectedSurface,
  onSurfaceSelect,
  upAxis,
  onUpAxisChange,
  addProbeRequest,
  onProbeCountChange,
  leftPanel,
  children,
}: FlowResultsViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const fitViewRef = useRef<() => void>(() => undefined);
  const [message, setMessage] = useState("Loading airflow view…");
  const [showDomain, setShowDomain] = useState(false);
  const [showPressure, setShowPressure] = useState(false);
  const [probes, setProbes] = useState<ProbeSettings[]>(() => [createProbe(0)]);
  const [activeProbeId, setActiveProbeId] = useState(() => probes[0].id);
  const handledAddProbeRequest = useRef(addProbeRequest);
  const probeSequence = useRef(1);
  const settings = probes.find(({ id }) => id === activeProbeId) ?? probes[0];
  const flowDirection = useMemo(
    () => finiteVelocity(snapshot, setup.initialConditions.velocity),
    [setup.initialConditions.velocity, snapshot],
  );

  function updateActiveProbe(update: (current: ProbeSettings) => ProbeSettings) {
    setProbes((current) =>
      current.map((probe) => (probe.id === activeProbeId ? update(probe) : probe)),
    );
  }

  function addProbe(kind?: ProbeKind) {
    const probe = createProbe(probeSequence.current, kind);
    probeSequence.current += 1;
    setProbes((current) => [...current, probe]);
    setActiveProbeId(probe.id);
  }

  useEffect(() => {
    if (addProbeRequest === handledAddProbeRequest.current) return;
    handledAddProbeRequest.current = addProbeRequest;
    const probe = createProbe(probeSequence.current);
    probeSequence.current += 1;
    setProbes((current) => [...current, probe]);
    setActiveProbeId(probe.id);
  }, [addProbeRequest]);

  useEffect(() => onProbeCountChange(probes.length), [onProbeCountChange, probes.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x091014);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
    camera.up.set(0, upAxis === "Y" ? 1 : 0, upAxis === "Z" ? 1 : 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.screenSpacePanning = true;
    const viewHelper = new ViewHelper(camera, renderer.domElement);
    viewHelper.location.left = 14;
    viewHelper.location.bottom = 14;
    viewHelper.setLabels("X", "Y", "Z");
    const flowGroup = new THREE.Group();
    const domainGroup = new THREE.Group();
    const sliceGroup = new THREE.Group();
    domainGroup.visible = false;
    scene.add(domainGroup, sliceGroup, flowGroup);
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    scene.add(new THREE.HemisphereLight(0xdff3ff, 0x35424a, 3));
    const light = new THREE.DirectionalLight(0xffffff, 4);
    light.position.set(4, 8, 6);
    scene.add(light);

    let frame = 0;
    const clock = new THREE.Clock();
    let elapsed = 0;
    const render = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      elapsed += delta;
      controls.update();
      sceneRef.current?.particleSets.forEach(({ points, curves, offsets }) => {
        const positions = points.geometry.getAttribute("position") as THREE.BufferAttribute;
        curves.forEach((curve, index) => {
          const point = curve.getPointAt((offsets[index] + elapsed * 0.085) % 1);
          positions.setXYZ(index, point.x, point.y, point.z);
        });
        positions.needsUpdate = true;
      });
      renderer.clear();
      renderer.render(scene, camera);
      viewHelper.render(renderer);
      frame = requestAnimationFrame(render);
    };
    render();

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const setPointer = (event: MouseEvent | PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };
    const selectAtPointer = (event: MouseEvent) => {
      setPointer(event);
      const hit = raycaster
        .intersectObjects(scene.children, true)
        .find(({ object }) => typeof object.userData.tesrigSurface === "string");
      if (hit) onSurfaceSelect(hit.object.userData.tesrigSurface as string);
    };
    let pointerStart: { x: number; y: number } | null = null;
    const rememberPointer = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const selectDomainFace = (event: PointerEvent) => {
      if (
        !pointerStart ||
        Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4
      ) {
        pointerStart = null;
        return;
      }
      pointerStart = null;
      if (!domainGroup.visible) return;
      setPointer(event);
      const hit = raycaster
        .intersectObjects(domainGroup.children, true)
        .find(({ object }) => typeof object.userData.tesrigBoundaryFace === "string");
      if (hit) onSurfaceSelect(hit.object.userData.tesrigBoundaryFace as string);
    };
    renderer.domElement.addEventListener("dblclick", selectAtPointer);
    renderer.domElement.addEventListener("pointerdown", rememberPointer);
    renderer.domElement.addEventListener("pointerup", selectDomainFace);

    void getGeometryData(projectId, geometry.id)
      .then(({ bytes }) => createGeometryModel(geometry, Uint8Array.from(bytes)))
      .then((model) => {
        if (disposed) return;
        const rawBounds = new THREE.Box3().setFromObject(model);
        const center = rawBounds.getCenter(new THREE.Vector3());
        if (upAxis === "Y") model.position.set(-center.x, -rawBounds.min.y, -center.z);
        else model.position.set(-center.x, -center.y, -rawBounds.min.z);
        let surfaceIndex = 0;
        model.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            surfaceIndex += 1;
            object.userData.tesrigSurface = object.name.trim() || `Surface ${surfaceIndex}`;
          }
        });
        scene.add(model);
        model.updateMatrixWorld(true);
        const modelBounds = new THREE.Box3().setFromObject(model);
        const offset = model.position;
        const box = setup.boundaryBox ?? {
          min: rawBounds.min.toArray() as [number, number, number],
          max: rawBounds.max.toArray() as [number, number, number],
        };
        const displayDomain = new THREE.Box3(
          new THREE.Vector3(...box.min).add(offset),
          new THREE.Vector3(...box.max).add(offset),
        );
        addDomainBox(domainGroup, displayDomain);
        setDomainSelection(domainGroup, selectedSurface);
        const state: SceneState = {
          scene,
          model,
          modelBounds,
          displayDomain,
          flowGroup,
          domainGroup,
          sliceGroup,
          renderer,
          camera,
          controls,
          viewHelper,
          particleSets: [],
        };
        sceneRef.current = state;
        const fitView = () => {
          const sphere = visibleFlowBounds(state, flowDirection).getBoundingSphere(
            new THREE.Sphere(),
          );
          const fov = THREE.MathUtils.degToRad(camera.fov);
          const distance = (sphere.radius / Math.sin(fov / 2)) * 1.05;
          const view =
            upAxis === "Y" ? new THREE.Vector3(1, 0.7, 1) : new THREE.Vector3(1, -1, 0.7);
          controls.target.copy(sphere.center);
          viewHelper.center.copy(sphere.center);
          camera.position.copy(sphere.center).addScaledVector(view.normalize(), distance);
          camera.near = Math.max(sphere.radius / 1000, 0.001);
          camera.far = Math.max(distance + sphere.radius * 20, 100);
          camera.updateProjectionMatrix();
          controls.update();
        };
        fitViewRef.current = fitView;
        fitView();
        rebuildFlow(state, probes, snapshot, setup, selectedSurface);
        setSurfacePressure(model, showPressure, flowDirection);
        setSurfaceSelection(model, selectedSurface);
        setMessage("");
      })
      .catch((error: unknown) => setMessage(toUserMessage(error)));

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("dblclick", selectAtPointer);
      renderer.domElement.removeEventListener("pointerdown", rememberPointer);
      renderer.domElement.removeEventListener("pointerup", selectDomainFace);
      controls.dispose();
      viewHelper.dispose();
      disposeGroup(flowGroup);
      disposeGroup(domainGroup);
      disposeGroup(sliceGroup);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      sceneRef.current = null;
      fitViewRef.current = () => undefined;
      if (renderer.domElement.parentElement === container)
        container.removeChild(renderer.domElement);
    };
    // Scene recreation is limited to assets and coordinate-system changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, onSurfaceSelect, projectId, upAxis]);

  useEffect(() => {
    const state = sceneRef.current;
    if (state) rebuildFlow(state, probes, snapshot, setup, selectedSurface);
  }, [probes, selectedSurface, setup, snapshot]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.domainGroup.visible = showDomain;
  }, [showDomain]);

  useEffect(() => {
    if (sceneRef.current) setSurfacePressure(sceneRef.current.model, showPressure, flowDirection);
  }, [flowDirection, showPressure]);

  useEffect(() => {
    if (sceneRef.current) {
      setSurfaceSelection(sceneRef.current.model, selectedSurface);
      setDomainSelection(sceneRef.current.domainGroup, selectedSurface);
    }
  }, [selectedSurface]);

  const direction = settings.reverse ? "Outlet → inlet" : "Inlet → outlets";
  const velocity = snapshot?.velocityMagnitude.mean ?? flowDirection.length();
  const pressure = snapshot?.pressure ? snapshot.pressure.mean * setup.fluid.density : undefined;
  const densityUnit = settings.kind === "point" ? "m³" : "m²";
  const streamlineMetric =
    settings.kind === "point"
      ? (4 / 3) * Math.PI * settings.radius ** 3
      : setup.boundaryBox
        ? Math.max(
            ...[
              (setup.boundaryBox.max[0] - setup.boundaryBox.min[0]) *
                (setup.boundaryBox.max[1] - setup.boundaryBox.min[1]),
              (setup.boundaryBox.max[1] - setup.boundaryBox.min[1]) *
                (setup.boundaryBox.max[2] - setup.boundaryBox.min[2]),
              (setup.boundaryBox.max[0] - setup.boundaryBox.min[0]) *
                (setup.boundaryBox.max[2] - setup.boundaryBox.min[2]),
            ],
          )
        : 1;
  const displayedStreamlines = THREE.MathUtils.clamp(
    Math.round(settings.density * streamlineMetric),
    4,
    64,
  );

  return (
    <div className="geometry-viewer flow-results-viewer" ref={containerRef}>
      {message ? <div className="geometry-viewer__message">{message}</div> : null}
      <div
        className={`viewer-left-stack flow-viewer__left-stack ${leftPanel ? "has-secondary-panel" : ""}`}
      >
        <aside className="flow-panel" aria-label="Airflow visualization controls">
          <header>
            <div>
              <span>{isPreview ? "Live preview" : "Result field"}</span>
              <strong>Airflow probes</strong>
            </div>
            <span className={`flow-panel__live ${snapshot ? "is-ready" : ""}`}>
              {snapshot ? `t = ${snapshot.time.toPrecision(4)}` : "Initial field"}
            </span>
          </header>
          <div className="flow-panel__body">
            <div className="flow-probe-list" aria-label="Active airflow probes">
              {probes.map((probe, index) => (
                <div
                  key={probe.id}
                  className={`flow-probe-list__item ${probe.id === activeProbeId ? "is-active" : ""}`}
                >
                  <button type="button" onClick={() => setActiveProbeId(probe.id)}>
                    <i
                      style={{ backgroundColor: `#${probe.color.toString(16).padStart(6, "0")}` }}
                    />
                    <span>Probe {index + 1}</span>
                    <small>{PROBE_OPTIONS.find(({ id }) => id === probe.kind)?.label}</small>
                  </button>
                  <button
                    type="button"
                    className={probe.visible ? "is-visible" : ""}
                    aria-label={`${probe.visible ? "Hide" : "Show"} probe ${index + 1}`}
                    onClick={() =>
                      setProbes((current) =>
                        current.map((item) =>
                          item.id === probe.id ? { ...item, visible: !item.visible } : item,
                        ),
                      )
                    }
                  >
                    {probe.visible ? "●" : "○"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove probe ${index + 1}`}
                    disabled={probes.length === 1}
                    onClick={() => {
                      const remaining = probes.filter(({ id }) => id !== probe.id);
                      setProbes(remaining);
                      if (activeProbeId === probe.id) setActiveProbeId(remaining[0].id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button className="flow-probe-list__add" type="button" onClick={() => addProbe()}>
                + Add probe
              </button>
            </div>
            <label className="cfd-field">
              <span>Visualization</span>
              <select
                value={settings.kind}
                onChange={(event) =>
                  updateActiveProbe((current) => ({
                    ...current,
                    kind: event.target.value as ProbeKind,
                  }))
                }
              >
                {PROBE_OPTIONS.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {settings.kind === "connections" ? (
              <button
                className="flow-direction-toggle"
                type="button"
                onClick={() =>
                  updateActiveProbe((current) => ({ ...current, reverse: !current.reverse }))
                }
              >
                {direction}
              </button>
            ) : null}
            {settings.kind !== "slice" ? (
              <label className="flow-range">
                <span>
                  Streamline density <strong>{settings.density.toFixed(1)}</strong>
                </span>
                <input
                  type="range"
                  min="0.2"
                  max="8"
                  step="0.2"
                  value={settings.density}
                  onChange={(event) =>
                    updateActiveProbe((current) => ({
                      ...current,
                      density: event.target.valueAsNumber,
                    }))
                  }
                />
                <small>{settings.kind === "point" ? "lines / m³" : "lines / m²"}</small>
              </label>
            ) : null}
            {settings.kind === "point" ? (
              <label className="flow-range">
                <span>
                  Probe radius <strong>{settings.radius.toFixed(2)} m</strong>
                </span>
                <input
                  type="range"
                  min="0.02"
                  max="2"
                  step="0.02"
                  value={settings.radius}
                  onChange={(event) =>
                    updateActiveProbe((current) => ({
                      ...current,
                      radius: event.target.valueAsNumber,
                    }))
                  }
                />
              </label>
            ) : null}
            {settings.kind === "surface" ? (
              <>
                <div className="flow-surface-selection">
                  <span>Selected surface</span>
                  <strong>{selectedSurface ?? "Double-click a model surface"}</strong>
                </div>
                <label className="flow-range">
                  <span>
                    Normal distance <strong>{settings.normalDistance.toFixed(2)} m</strong>
                  </span>
                  <input
                    type="range"
                    min="0.01"
                    max="1"
                    step="0.01"
                    value={settings.normalDistance}
                    onChange={(event) =>
                      updateActiveProbe((current) => ({
                        ...current,
                        normalDistance: event.target.valueAsNumber,
                      }))
                    }
                  />
                </label>
              </>
            ) : null}
            {settings.kind === "slice" ? (
              <div className="flow-section-controls">
                <label className="cfd-field">
                  <span>Section axis</span>
                  <select
                    value={settings.sliceAxis}
                    onChange={(event) =>
                      updateActiveProbe((current) => ({
                        ...current,
                        sliceAxis: Number(event.target.value) as 0 | 1 | 2,
                      }))
                    }
                  >
                    <option value="0">X</option>
                    <option value="1">Y</option>
                    <option value="2">Z</option>
                  </select>
                </label>
                <label className="cfd-field">
                  <span>Field</span>
                  <select
                    value={settings.sliceField}
                    onChange={(event) =>
                      updateActiveProbe((current) => ({
                        ...current,
                        sliceField: event.target.value as SliceField,
                      }))
                    }
                  >
                    <option value="pressure">Pressure</option>
                    <option value="velocity">Velocity</option>
                  </select>
                </label>
                <label className="flow-range flow-section-position">
                  <span>Section position</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={settings.slicePosition}
                    onChange={(event) =>
                      updateActiveProbe((current) => ({
                        ...current,
                        slicePosition: event.target.valueAsNumber,
                      }))
                    }
                  />
                </label>
              </div>
            ) : null}
            <dl className="flow-statistics">
              <div>
                <dt>Mean speed</dt>
                <dd>{displayNumber(velocity, "m/s")}</dd>
              </div>
              <div>
                <dt>Mean pressure</dt>
                <dd>{displayNumber(pressure, "Pa")}</dd>
              </div>
              <div>
                <dt>Samples</dt>
                <dd>{snapshot?.sampleCount.toLocaleString() ?? "Initial"}</dd>
              </div>
              <div>
                <dt>Streamlines</dt>
                <dd>
                  {displayedStreamlines} @ {settings.density.toFixed(1)}/{densityUnit}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
        {leftPanel}
      </div>
      <div className="geometry-viewer__toolbar flow-viewer__toolbar">
        <button
          type="button"
          className={`geometry-viewer__fit ${showDomain ? "is-active" : ""}`}
          aria-pressed={showDomain}
          onClick={() => setShowDomain((value) => !value)}
        >
          {showDomain ? "Hide bounding box" : "Show bounding box"}
        </button>
        <button
          type="button"
          className={`geometry-viewer__fit ${showPressure ? "is-active" : ""}`}
          aria-pressed={showPressure}
          onClick={() => setShowPressure((value) => !value)}
        >
          Surface pressure
        </button>
        <div className="up-axis-control" aria-label="Up axis">
          <span>Up</span>
          {(["Y", "Z"] as UpAxis[]).map((axis) => (
            <button
              key={axis}
              className={upAxis === axis ? "is-active" : ""}
              type="button"
              onClick={() => onUpAxisChange(axis)}
            >
              {axis}
            </button>
          ))}
        </div>
        <button className="geometry-viewer__fit" type="button" onClick={() => fitViewRef.current()}>
          Fit view
        </button>
      </div>
      {showPressure ? (
        <div className="pressure-legend" aria-label="Surface pressure legend">
          <span>Low</span>
          <i />
          <span>High</span>
          <small>
            {snapshot?.pressure
              ? `${(snapshot.pressure.minimum * setup.fluid.density).toPrecision(3)} – ${(snapshot.pressure.maximum * setup.fluid.density).toPrecision(3)} Pa`
              : "Estimated from initial field"}
          </small>
        </div>
      ) : null}
      <div className="geometry-viewer__hint">
        Orbit · left drag · Pan · right drag · Zoom · wheel · Select bounding face · click · Select
        model surface · double-click
      </div>
      {children}
    </div>
  );
}
