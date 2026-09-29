import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { GeometryAsset } from "../projects/project.types";
import { createStepModel } from "./step-geometry";

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

export async function createGeometryModel(asset: GeometryAsset, bytes: Uint8Array) {
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
