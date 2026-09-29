import * as THREE from "three";

export type VelocityVector = [number, number, number];

interface InletArrowFieldOptions {
  group: THREE.Group;
  model: THREE.Object3D | null;
  domainGroup: THREE.Group | null;
  surface: string | null;
  velocity: VelocityVector | null | undefined;
}

export function disposeInletArrowField(group: THREE.Group) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Line || object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
  group.clear();
  group.visible = false;
}

function addArrow(
  group: THREE.Group,
  point: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
) {
  const arrow = new THREE.ArrowHelper(
    direction,
    point.clone().addScaledVector(direction, -length * 0.35),
    length,
    0x7ce8ff,
    length * 0.28,
    length * 0.13,
  );
  arrow.traverse((object) => {
    object.renderOrder = 7;
    if (!(object instanceof THREE.Line || object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      material.depthTest = false;
      material.transparent = true;
      material.opacity = 0.92;
    });
  });
  group.add(arrow);
}

function addDomainFaceArrows(
  group: THREE.Group,
  domainGroup: THREE.Group | null,
  surface: string,
  direction: THREE.Vector3,
) {
  let faceMesh: THREE.Mesh | null = null;
  domainGroup?.traverse((object) => {
    if (
      !faceMesh &&
      object instanceof THREE.Mesh &&
      object.userData.tesrigBoundaryFace === surface
    ) {
      faceMesh = object;
    }
  });
  if (!faceMesh) return false;
  const selectedFaceMesh = faceMesh as THREE.Mesh;

  domainGroup?.updateMatrixWorld(true);
  const width = Math.abs(selectedFaceMesh.scale.x);
  const height = Math.abs(selectedFaceMesh.scale.y);
  const largestSpan = Math.max(width, height, 1e-6);
  const smallestSpan = Math.max(Math.min(width, height), 1e-6);
  const arrowLength = Math.min(
    Math.max(smallestSpan * 0.12, largestSpan * 0.025),
    largestSpan * 0.08,
  );
  const columns = THREE.MathUtils.clamp(Math.round((width / largestSpan) * 5), 3, 6);
  const rows = THREE.MathUtils.clamp(Math.round((height / largestSpan) * 5), 3, 6);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = new THREE.Vector3(
        (column + 1) / (columns + 1) - 0.5,
        (row + 1) / (rows + 1) - 0.5,
        0,
      );
      selectedFaceMesh.localToWorld(point);
      addArrow(group, point, direction, arrowLength);
    }
  }
  return true;
}

function addGeometrySurfaceArrows(
  group: THREE.Group,
  model: THREE.Object3D | null,
  surface: string,
  direction: THREE.Vector3,
) {
  const meshes: THREE.Mesh[] = [];
  model?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const objectSurface = object.userData.tesrigSurface as string | undefined;
    if (objectSurface === surface || (surface === "geometry" && objectSurface)) {
      meshes.push(object);
    }
  });
  if (meshes.length === 0) return;

  const sampledMeshes = meshes.slice(0, 30);
  const arrowsPerMesh = Math.max(1, Math.floor(30 / sampledMeshes.length));
  const bounds = new THREE.Box3();
  sampledMeshes.forEach((mesh) => bounds.expandByObject(mesh));
  const size = bounds.getSize(new THREE.Vector3());
  const arrowLength = Math.max(size.x, size.y, size.z, 1e-6) * 0.055;

  sampledMeshes.forEach((mesh, meshIndex) => {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const triangleCount = Math.floor((geometry.index?.count ?? positions.count) / 3);
    if (triangleCount === 0) return;
    mesh.updateWorldMatrix(true, false);

    const readVertex = (triangle: number, corner: number, target: THREE.Vector3) => {
      const positionIndex = geometry.index
        ? geometry.index.getX(triangle * 3 + corner)
        : triangle * 3 + corner;
      return target.fromBufferAttribute(positions as THREE.BufferAttribute, positionIndex);
    };
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let sample = 0; sample < arrowsPerMesh; sample += 1) {
      const triangle = Math.min(
        triangleCount - 1,
        Math.floor(((sample + 0.5) / arrowsPerMesh) * triangleCount),
      );
      readVertex(triangle, 0, a);
      readVertex(triangle, 1, b);
      readVertex(triangle, 2, c);
      const seed = sample + meshIndex * arrowsPerMesh + 1;
      const root = Math.sqrt((seed * 0.61803398875) % 1);
      const across = (seed * 0.75487766625) % 1;
      const point = a
        .clone()
        .multiplyScalar(1 - root)
        .addScaledVector(b, root * (1 - across))
        .addScaledVector(c, root * across)
        .applyMatrix4(mesh.matrixWorld);
      addArrow(group, point, direction, arrowLength);
    }
  });
}

export function updateInletArrowField({
  group,
  model,
  domainGroup,
  surface,
  velocity,
}: InletArrowFieldOptions) {
  disposeInletArrowField(group);
  if (!surface || !velocity) return;
  const direction = new THREE.Vector3(...velocity);
  if (direction.lengthSq() < 1e-12) return;
  direction.normalize();

  if (!addDomainFaceArrows(group, domainGroup, surface, direction)) {
    addGeometrySurfaceArrows(group, model, surface, direction);
  }
  group.visible = group.children.length > 0;
}
