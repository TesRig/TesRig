import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { toUserMessage } from "../../../lib/errors/app-error";
import type { BoundaryBox } from "../../cases/case.types";
import type { GeometryAsset, UpAxis } from "../../projects/project.types";
import { getGeometryData } from "../geometry.api";
import { createStepModel } from "../step-geometry";

interface GeometryViewerProps {
  projectId: string;
  geometry: GeometryAsset;
  geometries?: GeometryAsset[];
  onGeometryChange?: (geometryId: string) => void;
  selectedSurface?: string | null;
  onSurfaceSelect?: (surface: string) => void;
  upAxis: UpAxis;
  onUpAxisChange: (upAxis: UpAxis) => void;
  boundaryBox?: BoundaryBox | null;
  flowVelocity?: [number, number, number];
  onBoundaryBoxChange?: (boundaryBox: BoundaryBox) => void;
  children?: ReactNode;
}

interface ModelTreeNode {
  id: string;
  label: string;
  kind: "group" | "mesh";
  children: ModelTreeNode[];
}

const surfaceMaterial = new THREE.MeshStandardMaterial({
  color: 0x72cfff,
  emissive: 0x0b2838,
  emissiveIntensity: 0.75,
  metalness: 0.03,
  roughness: 0.42,
  side: THREE.DoubleSide,
});

const boundaryFaces = [
  { id: "domain:xMin", axis: 0, side: "min" as const },
  { id: "domain:xMax", axis: 0, side: "max" as const },
  { id: "domain:yMin", axis: 1, side: "min" as const },
  { id: "domain:yMax", axis: 1, side: "max" as const },
  { id: "domain:zMin", axis: 2, side: "min" as const },
  { id: "domain:zMax", axis: 2, side: "max" as const },
];

function createDefaultBoundaryBox(
  bounds: THREE.Box3,
  velocity: [number, number, number],
): BoundaryBox {
  const size = bounds.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.y, size.z, 1e-6);
  const flowAxis = velocity.reduce(
    (largest, value, axis) => (Math.abs(value) > Math.abs(velocity[largest]) ? axis : largest),
    0,
  );
  const min = bounds.min.toArray() as [number, number, number];
  const max = bounds.max.toArray() as [number, number, number];

  for (let axis = 0; axis < 3; axis += 1) {
    if (axis === flowAxis) {
      const positiveFlow = velocity[axis] >= 0;
      min[axis] -= length * (positiveFlow ? 3 : 6);
      max[axis] += length * (positiveFlow ? 6 : 3);
    } else {
      min[axis] -= length * 3;
      max[axis] += length * 3;
    }
  }
  return { min, max };
}

function brightenSourceColor(
  material: THREE.MeshStandardMaterial,
  source: [number, number, number],
) {
  const color = new THREE.Color(...source);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const saturation = hsl.s < 0.08 ? hsl.s : Math.max(hsl.s, 0.38);
  color.setHSL(hsl.h, saturation, Math.max(hsl.l, 0.58));
  material.color.copy(color);
  material.emissive.copy(color).multiplyScalar(0.18);
}

async function createModel(asset: GeometryAsset, bytes: Uint8Array) {
  if (asset.format === "STL") {
    const geometry = new STLLoader().parse(bytes.buffer as ArrayBuffer);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, surfaceMaterial.clone());
  }

  if (asset.format === "STEP") {
    return createStepModel(bytes, (color) => {
      const material = surfaceMaterial.clone();
      if (color) brightenSourceColor(material, color);
      return material;
    });
  }

  const object = new OBJLoader().parse(new TextDecoder().decode(bytes));
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = surfaceMaterial.clone();
      child.geometry.computeVertexNormals();
    }
  });
  return object;
}

function createModelTree(model: THREE.Object3D, rootLabel: string): ModelTreeNode {
  let meshIndex = 0;
  let nodeIndex = 0;

  function visit(object: THREE.Object3D, isRoot = false): ModelTreeNode {
    const isMesh = object instanceof THREE.Mesh;
    if (isMesh) meshIndex += 1;
    nodeIndex += 1;
    const label =
      object.name.trim() || (isRoot ? rootLabel : isMesh ? `Surface ${meshIndex}` : "Group");
    if (isMesh) object.userData.tesrigSurface = label;
    return {
      id: `${object.uuid}-${nodeIndex}`,
      label,
      kind: isMesh ? "mesh" : "group",
      children: object.children.map((child) => visit(child)),
    };
  }

  return visit(model, true);
}

function ModelTreeBranch({
  node,
  depth = 0,
  selectedSurface,
  onSurfaceSelect,
}: {
  node: ModelTreeNode;
  depth?: number;
  selectedSurface?: string | null;
  onSurfaceSelect?: (surface: string) => void;
}) {
  if (node.children.length === 0) {
    return (
      <button
        type="button"
        className={`model-tree__leaf ${selectedSurface === node.label ? "is-selected" : ""}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onSurfaceSelect?.(node.label)}
      >
        <span className="model-tree__mesh-icon" />
        <span>{node.label}</span>
      </button>
    );
  }

  return (
    <details className="model-tree__branch" open={depth < 2}>
      <summary style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        <span>{node.label}</span>
        <small>{node.children.length}</small>
      </summary>
      {node.children.map((child) => (
        <ModelTreeBranch
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedSurface={selectedSurface}
          onSurfaceSelect={onSurfaceSelect}
        />
      ))}
    </details>
  );
}

export function GeometryViewer({
  projectId,
  geometry,
  geometries,
  onGeometryChange,
  selectedSurface,
  onSurfaceSelect,
  upAxis,
  onUpAxisChange,
  boundaryBox,
  flowVelocity = [1, 0, 0],
  onBoundaryBoxChange,
  children,
}: GeometryViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitViewRef = useRef<() => void>(() => undefined);
  const selectSurfaceRef = useRef<(surface: string | null) => void>(() => undefined);
  const updateBoundaryBoxRef = useRef<(box: BoundaryBox | null) => void>(() => undefined);
  const createBoundaryBoxRef = useRef<() => void>(() => undefined);
  const selectedSurfaceValueRef = useRef(selectedSurface);
  selectedSurfaceValueRef.current = selectedSurface;
  const boundaryBoxValueRef = useRef(boundaryBox);
  boundaryBoxValueRef.current = boundaryBox;
  const flowVelocityRef = useRef(flowVelocity);
  flowVelocityRef.current = flowVelocity;
  const onBoundaryBoxChangeRef = useRef(onBoundaryBoxChange);
  onBoundaryBoxChangeRef.current = onBoundaryBoxChange;
  const [message, setMessage] = useState("Loading geometry…");
  const [modelTree, setModelTree] = useState<ModelTreeNode | null>(null);
  const [editingBoundaryBox, setEditingBoundaryBox] = useState(false);
  const editingBoundaryBoxRef = useRef(editingBoundaryBox);
  editingBoundaryBoxRef.current = editingBoundaryBox;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setMessage(geometry.format === "STEP" ? "Tessellating STEP geometry…" : "Loading geometry…");
    setModelTree(null);
    let disposed = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1012);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
    camera.up.set(0, upAxis === "Y" ? 1 : 0, upAxis === "Z" ? 1 : 0);
    camera.position.set(8, upAxis === "Y" ? 6 : -8, upAxis === "Y" ? 8 : 6);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x0d1012, 1);
    // The view helper is rendered as a second pass. Automatic clearing would
    // erase the model pass and leave only the axis widget visible.
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | null = null;
    let rawModelBounds: THREE.Box3 | null = null;
    const modelOffset = new THREE.Vector3();
    let geometrySphere: THREE.Sphere | null = null;
    let domainSphere: THREE.Sphere | null = null;
    const boundaryGroup = new THREE.Group();
    boundaryGroup.visible = false;
    scene.add(boundaryGroup);
    const boundaryWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x72cfff, transparent: true, opacity: 0.78 }),
    );
    boundaryWire.renderOrder = 3;
    boundaryGroup.add(boundaryWire);
    const boundaryFaceMeshes = boundaryFaces.map((face) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: 0x72cfff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
        }),
      );
      mesh.userData.tesrigBoundaryFace = face.id;
      mesh.userData.tesrigBoundaryAxis = face.axis;
      mesh.userData.tesrigBoundarySide = face.side;
      mesh.renderOrder = 2;
      boundaryGroup.add(mesh);
      return mesh;
    });
    const applySurfaceSelection = (surface: string | null) => {
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.emissiveIntensity = object.userData.tesrigSurface === surface ? 1.65 : 0.75;
          } else if (material instanceof THREE.MeshBasicMaterial) {
            material.opacity = object.userData.tesrigBoundaryFace === surface ? 0.26 : 0.08;
          }
        });
      });
    };
    selectSurfaceRef.current = applySurfaceSelection;
    let updateBoundaryBoxVisual: (box: BoundaryBox | null) => void = () => undefined;
    let faceDrag:
      | {
          pointerId: number;
          axis: number;
          side: "min" | "max";
          plane: THREE.Plane;
          startPoint: THREE.Vector3;
          startCoordinate: number;
        }
      | undefined;
    const setPointerFromEvent = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };
    const handleModelPointerDown = (event: PointerEvent) => {
      if (editingBoundaryBoxRef.current && boundaryBoxValueRef.current) {
        setPointerFromEvent(event);
        const hit = raycaster.intersectObjects(boundaryFaceMeshes, false)[0];
        if (hit) {
          const axis = hit.object.userData.tesrigBoundaryAxis as number;
          const side = hit.object.userData.tesrigBoundarySide as "min" | "max";
          const axisVector = new THREE.Vector3().setComponent(axis, 1);
          const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
          const planeNormal = cameraDirection.addScaledVector(
            axisVector,
            -cameraDirection.dot(axisVector),
          );
          if (planeNormal.lengthSq() < 1e-8) {
            planeNormal.set(axis === 0 ? 0 : 1, axis === 0 ? 1 : 0, 0);
          }
          planeNormal.normalize();
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, hit.point);
          const startPoint = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
          if (startPoint) {
            const box = boundaryBoxValueRef.current;
            faceDrag = {
              pointerId: event.pointerId,
              axis,
              side,
              plane,
              startPoint,
              startCoordinate: box[side][axis],
            };
            pointerStart = null;
            controls.enabled = false;
            renderer.domElement.setPointerCapture(event.pointerId);
            onSurfaceSelect?.(hit.object.userData.tesrigBoundaryFace as string);
            renderer.domElement.style.cursor = "grabbing";
            event.preventDefault();
            return;
          }
        }
      }
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const handleModelPointerMove = (event: PointerEvent) => {
      if (!faceDrag || faceDrag.pointerId !== event.pointerId) return;
      const box = boundaryBoxValueRef.current;
      if (!box) return;
      setPointerFromEvent(event);
      const point = raycaster.ray.intersectPlane(faceDrag.plane, new THREE.Vector3());
      if (!point) return;
      const axisVector = new THREE.Vector3().setComponent(faceDrag.axis, 1);
      let coordinate =
        faceDrag.startCoordinate + point.clone().sub(faceDrag.startPoint).dot(axisVector);
      const spans = [0, 1, 2].map((axis) => box.max[axis] - box.min[axis]);
      const characteristic = Math.max(
        ...spans,
        rawModelBounds?.getSize(new THREE.Vector3()).length() ?? 0,
        1e-6,
      );
      const snapDistance = characteristic * 0.0125;
      if (Math.abs(coordinate) <= snapDistance) coordinate = 0;
      const minimumSpan = characteristic * 0.001;
      coordinate =
        faceDrag.side === "min"
          ? Math.min(coordinate, box.max[faceDrag.axis] - minimumSpan)
          : Math.max(coordinate, box.min[faceDrag.axis] + minimumSpan);
      const next: BoundaryBox = {
        min: [...box.min] as [number, number, number],
        max: [...box.max] as [number, number, number],
      };
      next[faceDrag.side][faceDrag.axis] = coordinate;
      boundaryBoxValueRef.current = next;
      updateBoundaryBoxVisual(next);
      onBoundaryBoxChangeRef.current?.(next);
      event.preventDefault();
    };
    const handleModelPointerUp = (event: PointerEvent) => {
      if (faceDrag?.pointerId === event.pointerId) {
        faceDrag = undefined;
        controls.enabled = true;
        renderer.domElement.style.cursor = "grab";
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId);
        }
        event.preventDefault();
        return;
      }
      if (
        !pointerStart ||
        Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4
      ) {
        pointerStart = null;
        return;
      }
      pointerStart = null;
      setPointerFromEvent(event);
      const hit = raycaster
        .intersectObjects(scene.children, true)
        .find(({ object }) => typeof object.userData.tesrigSurface === "string");
      if (hit) onSurfaceSelect?.(hit.object.userData.tesrigSurface as string);
    };
    const handleModelPointerCancel = (event: PointerEvent) => {
      if (faceDrag?.pointerId !== event.pointerId) return;
      faceDrag = undefined;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    renderer.domElement.addEventListener("pointerdown", handleModelPointerDown);
    renderer.domElement.addEventListener("pointermove", handleModelPointerMove);
    renderer.domElement.addEventListener("pointerup", handleModelPointerUp);
    renderer.domElement.addEventListener("pointercancel", handleModelPointerCancel);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.screenSpacePanning = true;
    controls.target.set(0, 0, 0);
    controls.update();

    const viewHelper = new ViewHelper(camera, renderer.domElement);
    viewHelper.location.left = 14;
    viewHelper.location.right = 0;
    viewHelper.location.bottom = 14;
    viewHelper.setLabels("X", "Y", "Z");
    viewHelper.setLabelStyle("700 20px sans-serif", "#071015", 15);

    const fitView = () => {
      const fitSphere = domainSphere ?? geometrySphere;
      if (!fitSphere || fitSphere.radius <= 0) return;

      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const limitingFov = Math.min(verticalFov, horizontalFov);
      const distance = (fitSphere.radius / Math.sin(limitingFov / 2)) * 1.18;
      const viewDirection =
        upAxis === "Y"
          ? new THREE.Vector3(1, 0.72, 1).normalize()
          : new THREE.Vector3(1, -1, 0.72).normalize();

      controls.target.copy(fitSphere.center);
      viewHelper.center.copy(fitSphere.center);
      camera.position.copy(fitSphere.center).addScaledVector(viewDirection, distance);
      camera.near = Math.max(fitSphere.radius / 1000, 0.001);
      camera.far = Math.max(distance + fitSphere.radius * 20, 100);
      controls.minDistance = fitSphere.radius * 0.05;
      controls.maxDistance = fitSphere.radius * 30;
      camera.updateProjectionMatrix();
      controls.update();
    };
    fitViewRef.current = fitView;

    updateBoundaryBoxVisual = (box) => {
      if (!box || !rawModelBounds) {
        boundaryGroup.visible = false;
        domainSphere = null;
        return;
      }
      const displayMin = new THREE.Vector3(...box.min).add(modelOffset);
      const displayMax = new THREE.Vector3(...box.max).add(modelOffset);
      const displayBounds = new THREE.Box3(displayMin, displayMax);
      const size = displayBounds.getSize(new THREE.Vector3());
      const center = displayBounds.getCenter(new THREE.Vector3());
      boundaryGroup.visible = true;
      boundaryWire.position.copy(center);
      boundaryWire.scale.copy(size);
      boundaryFaceMeshes.forEach((mesh, index) => {
        const face = boundaryFaces[index];
        mesh.position.copy(center);
        mesh.position.setComponent(
          face.axis,
          face.side === "min"
            ? displayMin.getComponent(face.axis)
            : displayMax.getComponent(face.axis),
        );
        mesh.rotation.set(0, 0, 0);
        if (face.axis === 0) {
          mesh.rotation.y = Math.PI / 2;
          mesh.scale.set(size.z, size.y, 1);
        } else if (face.axis === 1) {
          mesh.rotation.x = Math.PI / 2;
          mesh.scale.set(size.x, size.z, 1);
        } else {
          mesh.scale.set(size.x, size.y, 1);
        }
      });
      domainSphere = displayBounds.getBoundingSphere(new THREE.Sphere());
      applySurfaceSelection(selectedSurfaceValueRef.current ?? null);
    };
    updateBoundaryBoxRef.current = updateBoundaryBoxVisual;
    createBoundaryBoxRef.current = () => {
      if (!rawModelBounds) return;
      const next = createDefaultBoundaryBox(rawModelBounds, flowVelocityRef.current);
      boundaryBoxValueRef.current = next;
      updateBoundaryBoxVisual(next);
      onBoundaryBoxChangeRef.current?.(next);
      setEditingBoundaryBox(true);
      fitView();
    };

    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    scene.add(new THREE.HemisphereLight(0xe8f5ff, 0x53606a, 3.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x8fd8ff, 2.4);
    fillLight.position.set(-5, 2, -4);
    scene.add(fillLight);

    // Keep a reference plane visible while the model is loading. Once the
    // model bounds are known it is scaled to suit the imported geometry.
    const groundGrid = new THREE.GridHelper(10, 24, 0x61707c, 0x27313a);
    if (upAxis === "Z") groundGrid.rotation.x = Math.PI / 2;
    scene.add(groundGrid);

    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      const wasAnimating = viewHelper.animating;
      if (wasAnimating) {
        viewHelper.update(Math.min(clock.getDelta(), 0.05));
        if (!viewHelper.animating) {
          controls.target.copy(viewHelper.center);
          controls.enabled = true;
          controls.update();
        }
      } else {
        clock.getDelta();
        controls.update();
      }
      renderer.clear();
      renderer.render(scene, camera);
      viewHelper.render(renderer);
      frame = requestAnimationFrame(render);
    };
    render();

    const helperSize = 128;
    let helperPointerActive = false;
    const isInsideViewHelper = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return (
        x >= viewHelper.location.left! &&
        x <= viewHelper.location.left! + helperSize &&
        y >= rect.height - viewHelper.location.bottom - helperSize &&
        y <= rect.height - viewHelper.location.bottom
      );
    };
    const handleHelperPointerDown = (event: PointerEvent) => {
      if (!isInsideViewHelper(event)) return;
      helperPointerActive = true;
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const handleHelperPointerUp = (event: PointerEvent) => {
      if (!helperPointerActive) return;
      helperPointerActive = false;
      const handled = viewHelper.handleClick(event);
      controls.enabled = !handled;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const handleHelperPointerCancel = (event: PointerEvent) => {
      if (!helperPointerActive) return;
      helperPointerActive = false;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    const handleHelperPointerMove = (event: PointerEvent) => {
      if (isInsideViewHelper(event)) {
        renderer.domElement.style.cursor = "pointer";
      } else if (!faceDrag && editingBoundaryBoxRef.current) {
        setPointerFromEvent(event);
        renderer.domElement.style.cursor = raycaster.intersectObjects(boundaryFaceMeshes, false)[0]
          ? "grab"
          : "";
      } else if (!faceDrag) {
        renderer.domElement.style.cursor = "";
      }
    };
    renderer.domElement.addEventListener("pointerdown", handleHelperPointerDown, true);
    renderer.domElement.addEventListener("pointerup", handleHelperPointerUp, true);
    renderer.domElement.addEventListener("pointercancel", handleHelperPointerCancel, true);
    renderer.domElement.addEventListener("pointermove", handleHelperPointerMove);

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      const width = Math.max(clientWidth, 1);
      const height = Math.max(clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      fitView();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    void getGeometryData(projectId, geometry.id)
      .then(({ bytes }) => {
        if (disposed) return null;
        setMessage(
          geometry.format === "STEP" ? "Tessellating STEP geometry…" : "Loading geometry…",
        );
        return createModel(geometry, Uint8Array.from(bytes));
      })
      .then((model) => {
        if (disposed || !model) return;
        const bounds = new THREE.Box3().setFromObject(model);
        if (bounds.isEmpty()) throw new Error("The geometry file contains no visible surfaces.");
        rawModelBounds = bounds.clone();

        const center = bounds.getCenter(new THREE.Vector3());
        if (upAxis === "Y") {
          model.position.set(-center.x, -bounds.min.y, -center.z);
        } else {
          model.position.set(-center.x, -center.y, -bounds.min.z);
        }
        modelOffset.copy(model.position);
        scene.add(model);
        setModelTree(createModelTree(model, geometry.name));
        applySurfaceSelection(selectedSurfaceValueRef.current ?? null);

        const size = bounds.getSize(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, size.z, 1);
        const gridSize = Math.max(extent * 2.4, 10);
        const groundOffset = Math.max(extent * 0.002, 0.002);
        groundGrid.scale.setScalar(gridSize / 10);
        if (upAxis === "Y") {
          groundGrid.position.y = -groundOffset;
        } else {
          groundGrid.position.z = -groundOffset;
        }

        if (onBoundaryBoxChangeRef.current) {
          const originMarker = new THREE.AxesHelper(Math.max(extent * 0.18, 0.1));
          originMarker.position.copy(modelOffset);
          originMarker.renderOrder = 4;
          scene.add(originMarker);
        }

        model.updateMatrixWorld(true);
        const positionedBounds = new THREE.Box3().setFromObject(model);
        geometrySphere = positionedBounds.getBoundingSphere(new THREE.Sphere());
        if (!Number.isFinite(geometrySphere.radius)) {
          throw new Error("The geometry dimensions are invalid and cannot be framed.");
        }
        geometrySphere.radius = Math.max(geometrySphere.radius, extent * 0.01, 0.01);
        updateBoundaryBoxVisual(boundaryBoxValueRef.current ?? null);
        fitView();
        setMessage("");
      })
      .catch((error: unknown) => setMessage(toUserMessage(error)));

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      viewHelper.dispose();
      renderer.domElement.removeEventListener("pointerdown", handleHelperPointerDown, true);
      renderer.domElement.removeEventListener("pointerup", handleHelperPointerUp, true);
      renderer.domElement.removeEventListener("pointercancel", handleHelperPointerCancel, true);
      renderer.domElement.removeEventListener("pointermove", handleHelperPointerMove);
      renderer.domElement.removeEventListener("pointerdown", handleModelPointerDown);
      renderer.domElement.removeEventListener("pointermove", handleModelPointerMove);
      renderer.domElement.removeEventListener("pointerup", handleModelPointerUp);
      renderer.domElement.removeEventListener("pointercancel", handleModelPointerCancel);
      fitViewRef.current = () => undefined;
      selectSurfaceRef.current = () => undefined;
      updateBoundaryBoxRef.current = () => undefined;
      createBoundaryBoxRef.current = () => undefined;
      renderer.dispose();
      groundGrid.geometry.dispose();
      const gridMaterials = Array.isArray(groundGrid.material)
        ? groundGrid.material
        : [groundGrid.material];
      gridMaterials.forEach((material) => material.dispose());
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        } else if (object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      container.removeChild(renderer.domElement);
    };
  }, [geometry, onSurfaceSelect, projectId, upAxis]);

  useEffect(() => selectSurfaceRef.current(selectedSurface ?? null), [selectedSurface]);
  useEffect(() => {
    updateBoundaryBoxRef.current(boundaryBox ?? null);
    if (!boundaryBox) setEditingBoundaryBox(false);
  }, [boundaryBox]);

  function selectUpAxis(nextAxis: UpAxis) {
    if (nextAxis === upAxis) return;
    onUpAxisChange(nextAxis);
  }

  return (
    <div className="geometry-viewer" ref={containerRef}>
      <aside className="model-tree" aria-label="Geometry structure">
        {geometries && geometries.length > 1 ? (
          <label className="model-tree__geometry-select">
            <span>Geometry</span>
            <select
              value={geometry.id}
              onChange={(event) => {
                setMessage("Loading geometry…");
                setModelTree(null);
                onGeometryChange?.(event.target.value);
              }}
            >
              {geometries.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="model-tree__title">
            <span>{geometry.name}</span>
            <small>{geometry.format}</small>
          </div>
        )}
        <div className="model-tree__content">
          {modelTree ? (
            <ModelTreeBranch
              node={modelTree}
              selectedSurface={selectedSurface}
              onSurfaceSelect={onSurfaceSelect}
            />
          ) : (
            <span>Reading structure…</span>
          )}
        </div>
      </aside>
      {message && <div className="geometry-viewer__message">{message}</div>}
      {!message && (
        <div className="geometry-viewer__toolbar">
          {onBoundaryBoxChange && (
            <button
              className={`geometry-viewer__fit boundary-box-toggle ${editingBoundaryBox ? "is-active" : ""}`}
              type="button"
              onClick={() => {
                if (boundaryBox) {
                  setEditingBoundaryBox((editing) => !editing);
                } else {
                  createBoundaryBoxRef.current();
                }
              }}
            >
              {boundaryBox
                ? editingBoundaryBox
                  ? "Finish box"
                  : "Edit boundary box"
                : "Create boundary box"}
            </button>
          )}
          <div className="up-axis-control" aria-label="Up axis">
            <span>Up</span>
            <button
              className={upAxis === "Y" ? "is-active" : ""}
              type="button"
              onClick={() => selectUpAxis("Y")}
            >
              Y
            </button>
            <button
              className={upAxis === "Z" ? "is-active" : ""}
              type="button"
              onClick={() => selectUpAxis("Z")}
            >
              Z
            </button>
          </div>
          <button
            className="geometry-viewer__fit"
            type="button"
            onClick={() => fitViewRef.current()}
          >
            Fit view
          </button>
        </div>
      )}
      <div className="geometry-viewer__hint">
        {editingBoundaryBox
          ? "Drag a translucent face to resize · faces snap to the origin"
          : "Orbit · left drag   Pan · right drag   Zoom · wheel   Axes · click to snap"}
      </div>
      {children}
    </div>
  );
}
