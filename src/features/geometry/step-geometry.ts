import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { GeometryAsset } from "../projects/project.types";
import {
  getGeometryData,
  hasGeometryTriangulation,
  saveGeometryTriangulation,
} from "./geometry.api";

type StepColor = [number, number, number];

export async function createStepModel(
  bytes: Uint8Array,
  createMaterial: (color?: StepColor) => THREE.Material,
) {
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
    group.add(new THREE.Mesh(geometry, createMaterial(sourceMesh.color)));
  }
  return group;
}

export async function ensureGeometryTriangulated(projectId: string, asset: GeometryAsset) {
  if (asset.format !== "STEP" || (await hasGeometryTriangulation(projectId, asset.id))) return;

  const { bytes } = await getGeometryData(projectId, asset.id);
  const model = await createStepModel(Uint8Array.from(bytes), () => new THREE.MeshBasicMaterial());
  try {
    model.updateMatrixWorld(true);
    const data = new STLExporter().parse(model, { binary: true });
    await saveGeometryTriangulation(
      projectId,
      asset.id,
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  } finally {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
