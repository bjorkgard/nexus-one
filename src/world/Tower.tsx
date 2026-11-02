// Type-only: pulls in the R3F JSX element types (<instancedMesh>) for this file.
import type {} from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { InstancedMesh } from "three";
import { getGeometry } from "./geometry-cache";
import { palette } from "./palette";
import type { TowerPart, TowerPartKind } from "./tower";

// The grid is transparent too; it sorts before the glass so the panes blend over it, not under it.
export const GLASS_RENDER_ORDER = 2;
export const GRID_RENDER_ORDER = GLASS_RENDER_ORDER - 1;

// Transparent parts (anything on the glass material) draw in the glass pass, whatever their kind.
export function partRenderOrder(part: TowerPart): number {
  return part.material === "glass" ? GLASS_RENDER_ORDER : 0;
}

// One InstancedMesh per part. `onUploaded` fires after the matrices, the instance flag and the bounding sphere
// are set, so the caller can request the shadow update that depends on them. `visibleCount` (from `cutCounts`)
// draws only the first instances; it sets `mesh.count`, so the key and the instance buffer stay as they are.
function TowerPartMesh({
  part,
  view,
  visibleCount,
  onUploaded,
}: {
  part: TowerPart;
  view: number;
  visibleCount?: number;
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
    part.colors?.forEach((color, i) => mesh.setColorAt(i, color));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    onUploaded();
  }, [part, geometry, view, onUploaded]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (mesh) mesh.count = Math.min(visibleCount ?? part.matrices.length, part.matrices.length);
  }, [part, visibleCount]);

  return (
    <instancedMesh
      // A new count is a new mesh: remount instead of resizing the instance buffer.
      key={part.matrices.length}
      ref={ref}
      args={[geometry, palette[part.material], part.matrices.length]}
      castShadow={part.castShadow}
      receiveShadow={part.receiveShadow}
      renderOrder={partRenderOrder(part)}
    />
  );
}

export function Tower({
  parts,
  view,
  glow,
  counts,
  onUploaded,
}: {
  parts: readonly TowerPart[];
  view: number;
  glow: boolean;
  // Visible instances per part kind (`cutCounts`); a kind left out draws in full.
  counts?: Partial<Record<TowerPartKind, number>>;
  onUploaded: () => void;
}) {
  return (
    <>
      {parts
        .filter(
          (part) =>
            glow ||
            (part.kind !== "glow" && part.kind !== "glowHoled" && part.kind !== "penthouseGlow"),
        )
        .map((part) => (
          <TowerPartMesh
            key={part.kind}
            part={part}
            view={view}
            visibleCount={counts?.[part.kind]}
            onUploaded={onUploaded}
          />
        ))}
    </>
  );
}
