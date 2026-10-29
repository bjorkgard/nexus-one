import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { BoxGeometry, Color, Euler, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { BufferGeometry, Material } from "three";
import { TOKENS, flattenTokens } from "../shared/tokens";
import { __clearGeometryCache, getGeometry } from "../world/geometry-cache";
import { palette } from "../world/palette";
import {
  PITCH,
  SIZE,
  TOGETHER_HALF_U,
  TOGETHER_HALF_V,
  YAW,
  place,
  rowLabel,
  rowV,
  slotU,
  swatchCentre,
  swatchLabel,
  title,
} from "../world/palette-layout";
import { useRevealHold } from "../world/reveal-hold";
import { LOOK } from "../world/stage-look";
import type { Vec3 } from "../world/zones";
import { PaletteFailure } from "./PaletteFailure";

// Marker for the build guard: nexus-palette-board
const KINDS = ["swatch-box", "swatch-pane", "swatch-edge", "swatch-dot"] as const;

const box = () => getGeometry("swatch-box", {}, () => new BoxGeometry(1, 1, 1));
const pane = () => getGeometry("swatch-pane", {}, () => new BoxGeometry(SIZE, SIZE, 0.2));
const edge = () => getGeometry("swatch-edge", {}, () => new BoxGeometry(0.08, 0.08, SIZE + 0.08));
const dot = () => getGeometry("swatch-dot", {}, () => new BoxGeometry(0.25, 0.25, 0.25));

type Instance = { position: Vec3; scale?: Vec3; rotation?: Vec3; color?: string };

const tokenHex = new Map(flattenTokens());
// Token name and hex both come from TOKENS, never typed.
const labelOf = (token: string) => `${token.replace(/^surface\./, "")} ${tokenHex.get(token)}`;

// One InstancedMesh; `color` per instance goes through setColorAt (D12), default is the shared material colour.
function Instances({
  geometry,
  material,
  items,
}: {
  geometry: BufferGeometry;
  material: Material;
  items: Instance[];
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    items.forEach((item, i) => {
      const [rx, ry, rz] = item.rotation ?? [0, 0, 0];
      quaternion.setFromEuler(new Euler(rx, ry, rz));
      matrix.compose(
        new Vector3(...item.position),
        quaternion,
        new Vector3(...(item.scale ?? [1, 1, 1])),
      );
      mesh.setMatrixAt(i, matrix);
      if (item.color) mesh.setColorAt(i, new Color(item.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[geometry, material, items.length]} frustumCulled={false} />
  );
}

// Slots run along the screen-horizontal ground axis, so one slot is PITCH * zoom px apart.
function useSwatchLabelsVisible() {
  const camera = useThree((s) => s.camera);
  const [zoom, setZoom] = useState(camera.zoom);
  useFrame(() => {
    if (camera.zoom !== zoom) setZoom(camera.zoom);
  });
  return zoom * PITCH >= LOOK.paletteHideSwatchLabelsBelowPx;
}

function Label({ position, text, large }: { position: Vec3; text: string; large?: boolean }) {
  const swatchLabelsVisible = useSwatchLabelsVisible();
  if (!large && !swatchLabelsVisible) return null;
  return (
    <Html position={position} center zIndexRange={[10, 0]}>
      <div
        data-testid="palette-label"
        style={{
          color: TOKENS.text.muted,
          fontFamily: "var(--font-sans)",
          fontSize: large ? LOOK.overlayHeadingPx : LOOK.zonesOverlayLabelPx,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {text}
      </div>
    </Html>
  );
}

const cube = ([x, , z]: Vec3): Instance[] => [
  { position: [x, SIZE / 2, z], scale: [SIZE, SIZE, SIZE] },
];

// 12 edge bars around a 4 m cube centred at (x, 2, z).
function edgeBars([x, , z]: Vec3): Instance[] {
  const h = SIZE / 2;
  const bars: Instance[] = [];
  for (const a of [-h, h]) {
    for (const b of [-h, h]) {
      bars.push({ position: [x + a, h + b, z] });
      bars.push({ position: [x + a, h, z + b], rotation: [Math.PI / 2, 0, 0] });
      bars.push({ position: [x, h + a, z + b], rotation: [0, Math.PI / 2, 0] });
    }
  }
  return bars;
}

const FURNITURE = TOKENS.surface.furniture;
const SCREEN_IDLE = TOKENS.surface.screenIdle;
const SCREEN_ACTIVE = TOKENS.surface.screenActive;
// Thin standing monitors, faced to the camera (local x along u, local z along v).
const SCREEN_SCALE: Vec3 = [3, 2, 0.25];

function Surfaces() {
  const at = (i: number) => swatchCentre("surfaces", i);
  const u = (i: number) => slotU("surfaces", i);
  const row = rowV("surfaces");
  const unit = box();
  const trimCube = (i: number, material: Material) => (
    <>
      <Instances geometry={unit} material={palette.panel} items={cube(at(i))} />
      <Instances geometry={edge()} material={material} items={edgeBars(at(i))} />
    </>
  );
  const ledDots: Instance[] = [];
  const [lx, , lz] = at(8);
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-0.6, 0.6]) {
      ledDots.push({
        position: [lx + dx, SIZE / 2 + dy, lz + SIZE / 2 + 0.125],
        color: TOKENS.surface.trimCyan,
      });
    }
  }
  const screenAt = (i: number, color: string): Instance => ({
    position: place(u(i), row, SCREEN_SCALE[1] / 2),
    scale: SCREEN_SCALE,
    rotation: [0, YAW, 0],
    color,
  });
  const labels = [
    ...(
      [
        "panel",
        "trimCyan",
        "trimWhite",
        "glass",
        "floor",
        "furniture",
        "screenIdle",
        "screenActive",
      ] as const
    ).map((name) => labelOf(`surface.${name}`)),
    // led shows trimCyan; the palette name is its label.
    `led ${TOKENS.surface.trimCyan}`,
  ];
  return (
    <group>
      <Instances geometry={unit} material={palette.panel} items={cube(at(0))} />
      {trimCube(1, palette.trimCyan)}
      {trimCube(2, palette.trimWhite)}
      <Instances
        geometry={unit}
        material={palette.panel}
        items={cube(place(u(3) + 0.2, row - 2.2))}
      />
      <Instances
        geometry={pane()}
        material={palette.glass}
        items={[{ position: place(u(3) - 0.6, row + 0.8, SIZE / 2), rotation: [0, YAW, 0] }]}
      />
      <Instances geometry={unit} material={palette.floor} items={cube(at(4))} />
      <Instances
        geometry={unit}
        material={palette.furniture}
        items={cube(at(5)).map((item) => ({ ...item, color: FURNITURE }))}
      />
      <Instances geometry={unit} material={palette.screen} items={[screenAt(6, SCREEN_IDLE)]} />
      <Instances geometry={unit} material={palette.screen} items={[screenAt(7, SCREEN_ACTIVE)]} />
      <Instances geometry={unit} material={palette.panel} items={cube(at(8))} />
      <Instances geometry={dot()} material={palette.led} items={ledDots} />
      {labels.map((text, i) => (
        <Label key={text} position={swatchLabel("surfaces", i)} text={text} />
      ))}
      <Label position={rowLabel("surfaces")} text="Surfaces" large />
    </group>
  );
}

function Paints() {
  const names = Object.keys(TOKENS.paint) as (keyof typeof TOKENS.paint)[];
  const items: Instance[] = names.map((name, i) => ({
    position: [swatchCentre("paints", i)[0], SIZE / 2, swatchCentre("paints", i)[2]],
    scale: [SIZE, SIZE, SIZE],
    color: TOKENS.paint[name],
  }));
  return (
    <group>
      <Instances geometry={box()} material={palette.paint} items={items} />
      {names.map((name, i) => (
        <Label key={name} position={swatchLabel("paints", i)} text={labelOf(`paint.${name}`)} />
      ))}
      <Label position={rowLabel("paints")} text="Vehicle paints" large />
    </group>
  );
}

function Together() {
  const row = rowV("together");
  const tileTop = 0.3;
  const unit = box();
  const yaw: Vec3 = [0, YAW, 0];
  return (
    <group>
      <mesh
        geometry={unit}
        material={palette.floor}
        position={place(0, row, tileTop / 2)}
        rotation={yaw}
        scale={[2 * TOGETHER_HALF_U, tileTop, 2 * TOGETHER_HALF_V]}
      />
      <mesh
        geometry={unit}
        material={palette.panel}
        position={place(0, row - TOGETHER_HALF_V + 0.15, tileTop + 2)}
        rotation={yaw}
        scale={[2 * TOGETHER_HALF_U, 4, 0.3]}
      />
      <mesh
        geometry={edge()}
        material={palette.trimCyan}
        position={place(0, row - TOGETHER_HALF_V + 0.15, tileTop + 4 + 0.06)}
        rotation={[0, 3 * YAW, 0]}
        scale={[1.5, 1.5, (2 * TOGETHER_HALF_U) / (SIZE + 0.08)]}
      />
      <Instances
        geometry={unit}
        material={palette.furniture}
        items={[
          {
            position: place(-2, row, tileTop + 0.5),
            scale: [2, 1, 1],
            rotation: yaw,
            color: FURNITURE,
          },
          {
            position: place(3, row, tileTop + 0.5),
            scale: [2, 1, 1],
            rotation: yaw,
            color: FURNITURE,
          },
        ]}
      />
      <mesh
        geometry={pane()}
        material={palette.glass}
        position={place(2.5, row + 0.8, tileTop + 1.4)}
        rotation={yaw}
        scale={[0.25, 0.7, 1]}
      />
      <Label position={rowLabel("together")} text="Together" large />
    </group>
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => __clearGeometryCache([...KINDS]));
}

export default function PaletteBoard() {
  const hold = useRevealHold();
  // Read from the store so a timeout between render and commit re-renders before paint (X1).
  const status = useSyncExternalStore(hold.subscribe, () => hold.status);
  useLayoutEffect(() => {
    hold.release();
  }, [hold]);
  if (status === "timedOut") return <PaletteFailure message="Palette board timed out" />;
  return (
    <group name="nexus-palette-board">
      <Surfaces />
      <Paints />
      <Together />
      <Label position={title()} text="Material palette" large />
    </group>
  );
}
