import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { toUserMessage } from "../../../lib/errors/app-error";
import type { GeometryAsset } from "../../projects/project.types";
import { getGeometryData } from "../geometry.api";

interface GeometryViewerProps {
  projectId: string;
  geometry: GeometryAsset;
  geometries?: GeometryAsset[];
  onGeometryChange?: (geometryId: string) => void;
}

type UpAxis = "Y" | "Z";

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

async function createStepModel(bytes: Uint8Array) {
  const [{ default: createOcctModule }, { default: wasmUrl }] = await Promise.all([
    import("occt-import-js"),
    import("occt-import-js/dist/occt-import-js.wasm?url"),
  ]);
  const occt = await createOcctModule({
    locateFile: (path) => (path.endsWith(".wasm") ? wasmUrl : path),
  });
  const result = occt.ReadStepFile(bytes, {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  });
  if (!result.success) throw new Error("OpenCascade could not read this STEP file.");

  const group = new THREE.Group();
  for (const sourceMesh of result.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.name = sourceMesh.name;
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(sourceMesh.attributes.position.array, 3),
    );
    if (sourceMesh.attributes.normal) {
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(sourceMesh.attributes.normal.array, 3),
      );
    } else {
      geometry.computeVertexNormals();
    }
    geometry.setIndex(sourceMesh.index.array);

    const material = surfaceMaterial.clone();
    if (sourceMesh.color) brightenSourceColor(material, sourceMesh.color);
    group.add(new THREE.Mesh(geometry, material));
  }
  return group;
}

async function createModel(asset: GeometryAsset, bytes: Uint8Array) {
  if (asset.format === "STL") {
    const geometry = new STLLoader().parse(bytes.buffer as ArrayBuffer);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, surfaceMaterial.clone());
  }

  if (asset.format === "STEP") return createStepModel(bytes);

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
    return {
      id: `${object.uuid}-${nodeIndex}`,
      label: object.name.trim() || (isRoot ? rootLabel : isMesh ? `Surface ${meshIndex}` : "Group"),
      kind: isMesh ? "mesh" : "group",
      children: object.children.map((child) => visit(child)),
    };
  }

  return visit(model, true);
}

function ModelTreeBranch({ node, depth = 0 }: { node: ModelTreeNode; depth?: number }) {
  if (node.children.length === 0) {
    return (
      <div className="model-tree__leaf" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        <span className="model-tree__mesh-icon" />
        <span>{node.label}</span>
      </div>
    );
  }

  return (
    <details className="model-tree__branch" open={depth < 2}>
      <summary style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        <span>{node.label}</span>
        <small>{node.children.length}</small>
      </summary>
      {node.children.map((child) => (
        <ModelTreeBranch key={child.id} node={child} depth={depth + 1} />
      ))}
    </details>
  );
}

export function GeometryViewer({
  projectId,
  geometry,
  geometries,
  onGeometryChange,
}: GeometryViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitViewRef = useRef<() => void>(() => undefined);
  const [message, setMessage] = useState("Loading geometry…");
  const [modelTree, setModelTree] = useState<ModelTreeNode | null>(null);
  const [upAxis, setUpAxis] = useState<UpAxis>("Y");

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

    let modelSphere: THREE.Sphere | null = null;
    const fitView = () => {
      if (!modelSphere || modelSphere.radius <= 0) return;

      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const limitingFov = Math.min(verticalFov, horizontalFov);
      const distance = (modelSphere.radius / Math.sin(limitingFov / 2)) * 1.18;
      const viewDirection =
        upAxis === "Y"
          ? new THREE.Vector3(1, 0.72, 1).normalize()
          : new THREE.Vector3(1, -1, 0.72).normalize();

      controls.target.copy(modelSphere.center);
      viewHelper.center.copy(modelSphere.center);
      camera.position.copy(modelSphere.center).addScaledVector(viewDirection, distance);
      camera.near = Math.max(modelSphere.radius / 1000, 0.001);
      camera.far = Math.max(distance + modelSphere.radius * 20, 100);
      controls.minDistance = modelSphere.radius * 0.05;
      controls.maxDistance = modelSphere.radius * 30;
      camera.updateProjectionMatrix();
      controls.update();
    };
    fitViewRef.current = fitView;

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
      renderer.domElement.style.cursor = isInsideViewHelper(event) ? "pointer" : "";
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

        const center = bounds.getCenter(new THREE.Vector3());
        if (upAxis === "Y") {
          model.position.set(-center.x, -bounds.min.y, -center.z);
        } else {
          model.position.set(-center.x, -center.y, -bounds.min.z);
        }
        scene.add(model);
        setModelTree(createModelTree(model, geometry.name));

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

        model.updateMatrixWorld(true);
        const positionedBounds = new THREE.Box3().setFromObject(model);
        modelSphere = positionedBounds.getBoundingSphere(new THREE.Sphere());
        if (!Number.isFinite(modelSphere.radius)) {
          throw new Error("The geometry dimensions are invalid and cannot be framed.");
        }
        modelSphere.radius = Math.max(modelSphere.radius, extent * 0.01, 0.01);
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
      fitViewRef.current = () => undefined;
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
        }
      });
      container.removeChild(renderer.domElement);
    };
  }, [geometry, projectId, upAxis]);

  function selectUpAxis(nextAxis: UpAxis) {
    if (nextAxis === upAxis) return;
    setMessage(`Switching to ${nextAxis}-up…`);
    setModelTree(null);
    setUpAxis(nextAxis);
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
          {modelTree ? <ModelTreeBranch node={modelTree} /> : <span>Reading structure…</span>}
        </div>
      </aside>
      {message && <div className="geometry-viewer__message">{message}</div>}
      {!message && (
        <div className="geometry-viewer__toolbar">
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
        Orbit · left drag &nbsp; Pan · right drag &nbsp; Zoom · wheel &nbsp; Axes · click to snap
      </div>
    </div>
  );
}
