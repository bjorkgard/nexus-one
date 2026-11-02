// Type-only: pulls in the R3F JSX element types (<instancedMesh>) for this file.
import type {} from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { InstancedMesh } from "three";
import { getGeometry } from "./geometry-cache";
import { palette } from "./palette";
import type { TowerPart } from "./tower";

// The grid is transparent too; it sorts before the glass so the panes blend over it, not under it.
export const GLASS_RENDER_ORDER = 2;
export const GRID_RENDER_ORDER = GLASS_RENDER_ORDER - 1;

// One InstancedMesh per part. `onUploaded` fires after the matrices, the instance flag and the bounding sphere
// are set, so the caller can request the shadow update that depends on them.
function TowerPartMesh({
  part,
  view,
  onUploaded,
}: {
  part: TowerPart;
  view: number;
  onUploaded: () => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(
    () => getGeometry(part.geometryKey.kind, part.geometryKey.params, part.buildGeometry),
    [part],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    part.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    onUploaded();
  }, [part, geometry, view, onUploaded]);

  return (
    <instancedMesh
      // A new count is a new mesh: remount instead of resizing the instance buffer.
      key={part.matrices.length}
      ref={ref}
      args={[geometry, palette[part.material], part.matrices.length]}
      castShadow={part.castShadow}
      receiveShadow={part.receiveShadow}
      renderOrder={part.kind === "glass" ? GLASS_RENDER_ORDER : 0}
    />
  );
}

export function Tower({
  parts,
  view,
  glow,
  onUploaded,
}: {
  parts: readonly TowerPart[];
  view: number;
  glow: boolean;
  onUploaded: () => void;
}) {
  return (
    <>
      {parts
        .filter((part) => glow || part.kind !== "glow")
        .map((part) => (
          <TowerPartMesh key={part.kind} part={part} view={view} onUploaded={onUploaded} />
        ))}
    </>
  );
}
