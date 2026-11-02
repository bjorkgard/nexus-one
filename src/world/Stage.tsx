import { Grid, OrthographicCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { BoxGeometry, Color, Float32BufferAttribute } from "three";
import type { DirectionalLight, OrthographicCamera as OrthographicCameraImpl } from "three";
import { TOKENS } from "../shared/tokens";
import {
  FIT_MARGIN,
  GROUND_EDGE_PX_PER_ZOOM,
  boundsCentre,
  cameraRig,
  cellOpacity,
  fitPointsZoom,
  framingBounds,
  framingPoints,
  keyLightDirection,
  keyShadowFrustum,
  readDevInt,
  viewBasis,
  viewYaw,
} from "./camera";
import { __clearGeometryCache, getGeometry } from "./geometry-cache";
import { palette } from "./palette";
import { shadowPending, stageReady } from "./ready-gate";
import { RevealHoldContext, createRevealHold } from "./reveal-hold";
import { LOOK } from "./stage-look";
// Explicit extension: on a case-insensitive disk "./Tower" would also match tower.ts.
import { GRID_RENDER_ORDER, Tower } from "./Tower.tsx";
import { INTERIOR_GEOMETRY_KINDS, buildInterior } from "./interior";
import { TOWER_GEOMETRY_KINDS, buildTower } from "./tower";
import type { AcUnit } from "./tower";
import { DEFAULT_FLOORS, MAX_FLOORS, MIN_FLOORS, createZoneRegistry } from "./zones";
import type { Box, ZoneRegistry } from "./zones";

export type ZonesValue = {
  registry: ZoneRegistry;
  zonesOverlay: boolean;
  // `?floor=N` for the zone overlay: the one floor whose rooms show, -1 for none.
  floorFilter: number;
  view: number;
  acUnits: readonly AcUnit[];
  towerVisible: boolean;
};

// The validated floor count and whether the tower is drawn, reported once for the canvas accessible name.
export type FloorsReport = { floors: number; towerVisible: boolean };

export const ZonesContext = createContext<ZonesValue | null>(null);

export function useZones(): ZonesValue {
  const zones = useContext(ZonesContext);
  if (!zones) throw new Error("useZones must be used inside <Stage>");
  return zones;
}

// `?palette=1`: dev only, exact "1". App mounts the board and Stage frames it from this one reader.
export const isPaletteBoardOn = () =>
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("palette") === "1";

// Dev-only URL parameters: `?floors=<n>` overrides the floor count, `?view=0..3` turns the camera in 90 degree steps, `?zones=1` frames the campus box, `?floor=0..floors` shows that floor's rooms in the zone overlay, `?palette=1` frames the palette board, `?glow=0` hides the floor glow.
function readDevParams(): {
  floors: number;
  view: number;
  glow: boolean;
  zonesOverlay: boolean;
  floorFilter: number;
  palette: boolean;
} {
  if (!import.meta.env.DEV) {
    return {
      floors: DEFAULT_FLOORS,
      view: 0,
      glow: true,
      zonesOverlay: false,
      floorFilter: -1,
      palette: false,
    };
  }
  const params = new URLSearchParams(location.search);
  const floors = readDevInt(params, "floors", MIN_FLOORS, MAX_FLOORS, DEFAULT_FLOORS);
  return {
    floors,
    view: readDevInt(params, "view", 0, 3, 0),
    glow: readDevInt(params, "glow", 0, 1, 1) === 1,
    zonesOverlay: params.get("zones") === "1",
    floorFilter: readDevInt(params, "floor", 0, floors, -1),
    palette: isPaletteBoardOn(),
  };
}

// Top face in the slab's top colour, the four side faces in its side colour; one geometry, one material.
function buildSlabGeometry(): BoxGeometry {
  const geometry = new BoxGeometry(LOOK.slabSize, LOOK.slabThickness, LOOK.slabSize);
  geometry.translate(0, -LOOK.slabThickness / 2, 0);
  const top = new Color(TOKENS.slab.top);
  const side = new Color(TOKENS.slab.side);
  const normals = geometry.getAttribute("normal");
  const colors: number[] = [];
  for (let i = 0; i < normals.count; i++) {
    const c = normals.getY(i) > 0.5 ? top : side;
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

import.meta.hot?.dispose(() =>
  __clearGeometryCache(["slab", ...TOWER_GEOMETRY_KINDS, ...INTERIOR_GEOMETRY_KINDS]),
);

export function Stage({
  children,
  onReady,
  onFloors,
}: {
  children?: ReactNode;
  onReady?: () => void;
  onFloors?: (report: FloorsReport) => void;
}) {
  const size = useThree((s) => s.size);
  const canvas = useThree((s) => s.gl.domElement);
  const activeCamera = useThree((s) => s.camera);
  const cameraRef = useRef<OrthographicCameraImpl>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const fitted = useRef(false);
  const signalled = useRef(false);
  const lightRef = useRef<DirectionalLight>(null);
  const shadowRequested = useRef(false);

  // Built in render, not at import: a bad `?floors` throws into CanvasErrorBoundary instead of a blank page.
  const {
    floors,
    view,
    glow,
    zonesOverlay,
    floorFilter,
    palette: paletteBoard,
  } = useMemo(() => readDevParams(), []);
  const towerVisible = !paletteBoard;
  const zones = useMemo(() => createZoneRegistry({ floors }), [floors]);
  const tower = useMemo(
    () => (towerVisible ? buildTower({ floors, openings: zones.layout.openings }) : null),
    [towerVisible, floors, zones],
  );
  const interior = useMemo(
    () => (towerVisible ? buildInterior(zones.layout) : null),
    [towerVisible, zones],
  );
  const towerParts = useMemo(
    () => (tower && interior ? [...tower.parts, ...interior] : null),
    [tower, interior],
  );
  const zonesValue = useMemo(
    () => ({
      registry: zones,
      zonesOverlay,
      floorFilter,
      view,
      acUnits: tower?.acUnits ?? [],
      towerVisible,
    }),
    [zones, zonesOverlay, floorFilter, view, tower, towerVisible],
  );
  useEffect(() => {
    onFloors?.({ floors, towerVisible });
  }, [floors, towerVisible, onFloors]);
  const bounds = useMemo(
    () => framingBounds({ zonesOverlay, floors, palette: paletteBoard }),
    [zonesOverlay, floors, paletteBoard],
  );
  // Derived in render (zero-size viewport keeps the previous zoom); the effect below applies it to the camera.
  const yaw = viewYaw(view);
  const fit = useMemo(
    () => framingPoints({ zonesOverlay, floors, palette: paletteBoard }),
    [zonesOverlay, floors, paletteBoard],
  );
  // Depth range covers everything fitted (a tall tower reaches toward the camera), not only the slab.
  const rigBounds = useMemo((): Box => {
    const lo = (a: 0 | 1 | 2) => Math.min(...fit.points.map((p) => p[a]));
    const hi = (a: 0 | 1 | 2) => Math.max(...fit.points.map((p) => p[a]));
    return { min: [lo(0), lo(1), lo(2)], max: [hi(0), hi(1), hi(2)] };
  }, [fit]);
  const nextZoom = fitPointsZoom(fit.points, fit.centre, size, FIT_MARGIN, yaw);
  if (nextZoom !== null && nextZoom !== zoom) setZoom(nextZoom);
  const slab = useMemo(
    () =>
      getGeometry(
        "slab",
        {
          size: LOOK.slabSize,
          thickness: LOOK.slabThickness,
          top: TOKENS.slab.top,
          side: TOKENS.slab.side,
        },
        buildSlabGeometry,
      ),
    [],
  );
  // Held until the palette board mounts (or the 3 s timeout); no hold without `?palette=1`.
  const hold = useMemo(() => createRevealHold({ holds: paletteBoard ? 1 : 0 }), [paletteBoard]);
  useEffect(() => {
    hold.start();
    return () => hold.dispose();
  }, [hold]);

  // Light distance and shadow camera fitted to the campus box at the current floors, turned with the view.
  const shadowCam = useMemo(() => keyShadowFrustum(floors, yaw), [floors, yaw]);
  const keyLight = useMemo(() => {
    const dir = keyLightDirection(yaw);
    return [
      dir[0] * shadowCam.distance,
      dir[1] * shadowCam.distance,
      dir[2] * shadowCam.distance,
    ] as const;
  }, [yaw, shadowCam]);
  // Static shadow map: redrawn only on request, and only after the instances are uploaded.
  const requestShadow = useCallback(() => {
    const light = lightRef.current;
    if (!light) return;
    light.shadow.needsUpdate = true;
    shadowRequested.current = true;
  }, []);
  useLayoutEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    const { left, right, top, bottom, near, far } = shadowCam;
    Object.assign(light.shadow.camera, { left, right, top, bottom, near, far });
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.autoUpdate = false;
    // Children's layout effects (the Tower upload) have already run, so the map is drawn from loaded instances.
    requestShadow();
  }, [shadowCam, keyLight, requestShadow, towerVisible]);

  // A restored WebGL context has lost the static shadow map: draw it again.
  useEffect(() => {
    canvas.addEventListener("webglcontextrestored", requestShadow);
    return () => canvas.removeEventListener("webglcontextrestored", requestShadow);
  }, [canvas, requestShadow]);

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    const target = boundsCentre(bounds);
    const { distance, near, far } = cameraRig(rigBounds);
    const { direction } = viewBasis(yaw);
    camera.position.set(
      target[0] - direction[0] * distance,
      target[1] - direction[1] * distance,
      target[2] - direction[2] * distance,
    );
    camera.near = near;
    camera.far = far;
    camera.lookAt(...target);
    camera.userData.target = [...target];
    if (zoom !== null) {
      camera.zoom = zoom;
      fitted.current = true;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }, [bounds, rigBounds, yaw, zoom]);

  // Ready once the ortho camera is the active one, the fitted zoom is applied, the first shadow map has been
  // drawn and a frame has been drawn.
  useFrame(({ gl }) => {
    if (signalled.current) return;
    const ok = stageReady({
      fitted: fitted.current,
      cameraActive: activeCamera === cameraRef.current,
      holdStatus: hold.status,
      shadowPending: shadowPending({
        towerVisible,
        enabled: gl.shadowMap.enabled,
        requested: shadowRequested.current,
        needsUpdate: lightRef.current?.shadow.needsUpdate ?? true,
      }),
    });
    if (!ok) return;
    signalled.current = true;
    requestAnimationFrame(() => onReady?.());
  });

  const cellThickness =
    LOOK.gridCellThickness * (zoom === null ? 0 : cellOpacity(zoom * GROUND_EDGE_PX_PER_ZOOM));
  const half = LOOK.slabSize / 2;

  return (
    <ZonesContext.Provider value={zonesValue}>
      <RevealHoldContext.Provider value={hold}>
        <OrthographicCamera ref={cameraRef} makeDefault />
        <hemisphereLight
          args={[LOOK.hemisphere.sky, LOOK.hemisphere.ground, LOOK.hemisphere.intensity]}
        />
        <directionalLight
          ref={lightRef}
          color={LOOK.key.color}
          intensity={LOOK.key.intensity}
          position={keyLight}
          castShadow={towerVisible}
          shadow-mapSize={[LOOK.key.shadow.mapSize, LOOK.key.shadow.mapSize]}
          shadow-radius={LOOK.key.shadow.radius}
          shadow-bias={LOOK.key.shadow.bias}
          shadow-normalBias={LOOK.key.shadow.normalBias}
        />
        <mesh geometry={slab} material={palette.ground} receiveShadow />
        <Grid
          args={[LOOK.slabSize, LOOK.slabSize]}
          position={[0, LOOK.gridLift, 0]}
          cellSize={LOOK.gridCellSize}
          sectionSize={LOOK.gridSectionSize}
          cellColor={TOKENS.grid.cell}
          sectionColor={TOKENS.grid.section}
          cellThickness={cellThickness}
          sectionThickness={LOOK.gridSectionThickness}
          fadeFrom={0}
          fadeDistance={Math.hypot(half, half)}
          renderOrder={GRID_RENDER_ORDER}
        />
        {towerParts && (
          <Tower parts={towerParts} view={view} glow={glow} onUploaded={requestShadow} />
        )}
        {children}
      </RevealHoldContext.Provider>
    </ZonesContext.Provider>
  );
}
