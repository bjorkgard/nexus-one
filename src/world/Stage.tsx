import { Grid, OrthographicCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { BoxGeometry, Color, Float32BufferAttribute, Vector3 } from "three";
import type { OrthographicCamera as OrthographicCameraImpl } from "three";
import { TOKENS } from "../shared/tokens";
import {
  GROUND_EDGE_PX_PER_ZOOM,
  boundsCentre,
  cameraRig,
  cellOpacity,
  fitZoom,
  framingBounds,
  isoDirection,
} from "./camera";
import { __clearGeometryCache, getGeometry } from "./geometry-cache";
import { palette } from "./palette";
import { RevealHoldContext, createRevealHold } from "./reveal-hold";
import { LOOK } from "./stage-look";
import { DEFAULT_FLOORS, createZoneRegistry } from "./zones";
import type { ZoneRegistry } from "./zones";

export type ZonesValue = { registry: ZoneRegistry; zonesOverlay: boolean };

export const ZonesContext = createContext<ZonesValue | null>(null);

export function useZones(): ZonesValue {
  const zones = useContext(ZonesContext);
  if (!zones) throw new Error("useZones must be used inside <Stage>");
  return zones;
}

// `?palette=1`: dev only, exact "1". App mounts the board and Stage frames it from this one reader.
export const isPaletteBoardOn = () =>
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("palette") === "1";

// Dev-only URL parameters: `?floors=<n>` overrides the floor count, `?zones=1` frames the campus box, `?palette=1` frames the palette board.
function readDevParams(): { floors: number; zonesOverlay: boolean; palette: boolean } {
  if (!import.meta.env.DEV) return { floors: DEFAULT_FLOORS, zonesOverlay: false, palette: false };
  const params = new URLSearchParams(location.search);
  const floors = params.get("floors");
  return {
    floors: floors === null ? DEFAULT_FLOORS : Number(floors),
    zonesOverlay: params.get("zones") === "1",
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

import.meta.hot?.dispose(() => __clearGeometryCache(["slab"]));

export function Stage({ children, onReady }: { children?: ReactNode; onReady?: () => void }) {
  const size = useThree((s) => s.size);
  const activeCamera = useThree((s) => s.camera);
  const cameraRef = useRef<OrthographicCameraImpl>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const fitted = useRef(false);
  const signalled = useRef(false);

  // Built in render, not at import: a bad `?floors` throws into CanvasErrorBoundary instead of a blank page.
  const { floors, zonesOverlay, palette: paletteBoard } = useMemo(() => readDevParams(), []);
  const zones = useMemo(() => createZoneRegistry({ floors }), [floors]);
  const zonesValue = useMemo(() => ({ registry: zones, zonesOverlay }), [zones, zonesOverlay]);
  const bounds = useMemo(
    () => framingBounds({ zonesOverlay, floors, palette: paletteBoard }),
    [zonesOverlay, floors, paletteBoard],
  );
  // Derived in render (zero-size viewport keeps the previous zoom); the effect below applies it to the camera.
  const nextZoom = fitZoom(bounds, size);
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

  const keyLight = useMemo(
    () => new Vector3(...LOOK.key.direction).normalize().multiplyScalar(100),
    [],
  );

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    const target = boundsCentre(bounds);
    const { distance, near, far } = cameraRig(bounds);
    const direction = isoDirection();
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
  }, [bounds, zoom]);

  // Ready once the ortho camera is the active one, the fitted zoom is applied and a frame has been drawn.
  useFrame(() => {
    if (signalled.current || !fitted.current || activeCamera !== cameraRef.current) return;
    if (hold.status === "pending") return;
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
          color={LOOK.key.color}
          intensity={LOOK.key.intensity}
          position={keyLight}
        />
        <mesh geometry={slab} material={palette.ground} />
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
        />
        {children}
      </RevealHoldContext.Provider>
    </ZonesContext.Provider>
  );
}
