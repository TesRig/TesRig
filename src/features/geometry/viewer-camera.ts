import * as THREE from "three";
import type { UpAxis } from "../projects/project.types";

export type CameraProjection = "perspective" | "orthographic";
export type ViewerCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export function createViewerCamera(
  projection: CameraProjection,
  fieldOfView: number,
  upAxis: UpAxis,
): ViewerCamera {
  const camera =
    projection === "orthographic"
      ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000)
      : new THREE.PerspectiveCamera(fieldOfView, 1, 0.01, 100000);
  camera.up.set(0, upAxis === "Y" ? 1 : 0, upAxis === "Z" ? 1 : 0);
  camera.userData.tesrigAspect = 1;
  return camera;
}

export function resizeViewerCamera(camera: ViewerCamera, width: number, height: number) {
  const aspect = width / Math.max(height, 1);
  camera.userData.tesrigAspect = aspect;
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
  } else {
    const halfHeight = Math.max((camera.top - camera.bottom) / 2, 1);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
  }
  camera.updateProjectionMatrix();
}

export function fitViewerCamera(
  camera: ViewerCamera,
  sphere: THREE.Sphere,
  viewDirection: THREE.Vector3,
  padding = 1.15,
) {
  const radius = Math.max(sphere.radius, 0.01);
  let distance: number;
  if (camera instanceof THREE.PerspectiveCamera) {
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * padding;
  } else {
    const aspect = Number(camera.userData.tesrigAspect) || 1;
    const halfHeight = radius * padding;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.zoom = 1;
    distance = radius * 4;
  }
  camera.position.copy(sphere.center).addScaledVector(viewDirection.normalize(), distance);
  camera.near = Math.max(radius / 1000, 0.001);
  camera.far = Math.max(distance + radius * 20, 100);
  camera.updateProjectionMatrix();
  return distance;
}
