import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useState } from "react";
import { Color } from "three";
import { TOKENS } from "../shared/tokens";
import { nearestCorner, viewYaw } from "../world/camera";
import { LOOK } from "../world/stage-look";
import { useZones } from "../world/Stage";
import { FLOOR_HEIGHT } from "../world/zones";
import type { Zone } from "../world/zones";
import { overlayZones, roomLabelAnchor } from "./zone-filter";

// Projected px of one floor band: 1 m of height shows as 2/sqrt(6) px per unit of zoom.
const BAND_PX_PER_ZOOM = (FLOOR_HEIGHT * 2) / Math.sqrt(6);

const isTowerFloor = (z: Zone) =>
  z.kind === "floor" && (z.id === "lobby" || z.id === "roof" || z.id.startsWith("floor-"));

// The 12 edges of every zone box as one LineSegments, coloured by kind.
function buildEdges(zones: readonly Zone[]) {
  const positions: number[] = [];
  const colors: number[] = [];
  const ids: string[] = [];
  for (const z of zones) {
    ids.push(z.id);
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
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), ids };
}

function Label(props: {
  position: readonly [number, number, number];
  color: string;
  testId: string;
  idAttr: string;
  text: string;
}) {
  return (
    <Html position={props.position} zIndexRange={[10, 0]}>
      <div
        data-testid={props.testId}
        data-zone-id={props.idAttr}
        style={{
          height: LOOK.zonesOverlayPillPx,
          padding: "0 8px",
          lineHeight: `${LOOK.zonesOverlayPillPx}px`,
          borderRadius: LOOK.zonesOverlayPillPx / 2,
          background: `color-mix(in srgb, ${TOKENS.bg.bottom} 70%, transparent)`,
          color: props.color,
          fontSize: LOOK.zonesOverlayLabelPx,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {props.text}
      </div>
    </Html>
  );
}

export default function ZoneOverlay() {
  const { registry: zones, zonesOverlay, floorFilter, view, acUnits, towerVisible } = useZones();
  const camera = useThree((s) => s.camera);
  const [zoom, setZoom] = useState(camera.zoom);
  const shown = useMemo(() => overlayZones(zones.zones, floorFilter), [zones, floorFilter]);
  const edges = useMemo(() => buildEdges(shown.edges), [shown]);

  useFrame(() => {
    if (camera.zoom !== zoom) setZoom(camera.zoom);
  });

  if (!zonesOverlay) return null;

  const yaw = viewYaw(view);
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
      {/* Test seam: the zone ids whose box edges are drawn. */}
      <Html position={[0, 0, 0]}>
        <div
          data-testid="zone-edges"
          data-zone-ids={edges.ids.join(" ")}
          style={{ display: "none" }}
        />
      </Html>
      {shown.labels.map((z) =>
        hideFloors && isTowerFloor(z) ? null : (
          <Label
            key={z.id}
            position={z.kind === "room" ? roomLabelAnchor(z) : nearestCorner(z.box, yaw)}
            color={TOKENS.zone[z.kind]}
            testId="zone-label"
            idAttr={z.id}
            text={z.name}
          />
        ),
      )}
      {towerVisible && !hideFloors
        ? acUnits.map((u) => (
            <Label
              key={u.id}
              position={u.position}
              color={TOKENS.zone.floor}
              testId="ac-label"
              idAttr={u.id}
              text={u.name}
            />
          ))
        : null}
    </group>
  );
}
