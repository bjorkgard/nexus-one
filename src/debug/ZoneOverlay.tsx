import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useState } from "react";
import { Color } from "three";
import { TOKENS } from "../shared/tokens";
import { LOOK } from "../world/stage-look";
import { useZones } from "../world/Stage";
import { FLOOR_HEIGHT } from "../world/zones";
import type { Zone } from "../world/zones";

// Projected px of one floor band: 1 m of height shows as 2/sqrt(6) px per unit of zoom.
const BAND_PX_PER_ZOOM = (FLOOR_HEIGHT * 2) / Math.sqrt(6);

const isTowerFloor = (z: Zone) =>
  z.kind === "floor" && (z.id === "lobby" || z.id === "roof" || z.id.startsWith("floor-"));

// The 12 edges of every zone box as one LineSegments, coloured by kind.
function buildEdges(zones: readonly Zone[]) {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const z of zones) {
    const { min, max } = z.box;
    const c = new Color(TOKENS.zone[z.kind]);
    const corner = (i: number): [number, number, number] => [
      i & 1 ? max[0] : min[0],
      i & 2 ? max[1] : min[1],
      i & 4 ? max[2] : min[2],
    ];
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        if (i & bit) continue;
        positions.push(...corner(i), ...corner(i | bit));
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
}

export default function ZoneOverlay() {
  const zones = useZones();
  const camera = useThree((s) => s.camera);
  const [zoom, setZoom] = useState(camera.zoom);
  const edges = useMemo(() => buildEdges(zones.zones), [zones]);

  useFrame(() => {
    if (camera.zoom !== zoom) setZoom(camera.zoom);
  });

  if (new URLSearchParams(location.search).get("zones") !== "1") return null;

  const hideFloors = zoom * BAND_PX_PER_ZOOM < LOOK.zonesOverlayHideFloorsBelowPx;

  return (
    <group name="nexus-zone-overlay">
      <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[edges.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[edges.colors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      {zones.zones.map((z) =>
        hideFloors && isTowerFloor(z) ? null : (
          <Html
            key={z.id}
            position={[z.box.max[0], z.box.max[1], z.box.max[2]]}
            zIndexRange={[10, 0]}
          >
            <div
              data-testid="zone-label"
              data-zone-id={z.id}
              style={{
                height: LOOK.zonesOverlayPillPx,
                padding: "0 8px",
                lineHeight: `${LOOK.zonesOverlayPillPx}px`,
                borderRadius: LOOK.zonesOverlayPillPx / 2,
                background: `color-mix(in srgb, ${TOKENS.bg.bottom} 70%, transparent)`,
                color: TOKENS.zone[z.kind],
                fontSize: LOOK.zonesOverlayLabelPx,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {z.name}
            </div>
          </Html>
        ),
      )}
    </group>
  );
}
