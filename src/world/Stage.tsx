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

// Dev-only URL parameters: `?floors=<n>` overrides the floor count, `?zones=1` frames the campus box.
function readDevParams(): { floors: number; zonesOverlay: boolean } {
  if (!import.meta.env.DEV) return { floors: DEFAULT_FLOORS, zonesOverlay: false };
  const params = new URLSearchParams(location.search);
  const floors = params.get("floors");
  return {
    floors: floors === null ? DEFAULT_FLOORS : Number(floors),
    zonesOverlay: params.get("zones") === "1",
  };
}

// Top face in the slab's top colour, the four side faces in its side colour; one geometry, one material.
function createSlabGeometry(): BoxGeometry {
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

export function Stage({ children, onReady }: { children?: ReactNode; onReady?: () => void }) {
  const size = useThree((s) => s.size);
  const activeCamera = useThree((s) => s.camera);
  const cameraRef = useRef<OrthographicCameraImpl>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const fitted = useRef(false);
  const signalled = useRef(false);

  // Built in render, not at import: a bad `?floors` throws into CanvasErrorBoundary instead of a blank page.
  const { floors, zonesOverlay } = useMemo(() => readDevParams(), []);
  const zones = useMemo(() => createZoneRegistry({ floors }), [floors]);
  const zonesValue = useMemo(() => ({ registry: zones, zonesOverlay }), [zones, zonesOverlay]);
  const bounds = useMemo(() => framingBounds({ zonesOverlay, floors }), [zonesOverlay, floors]);
  // Derived in render (zero-size viewport keeps the previous zoom); the effect below applies it to the camera.
  const nextZoom = fitZoom(bounds, size);
  if (nextZoom !== null && nextZoom !== zoom) setZoom(nextZoom);
  const slab = useMemo(() => createSlabGeometry(), []);
  useEffect(() => () => slab.dispose(), [slab]);

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
    signalled.current = true;
    requestAnimationFrame(() => onReady?.());
  });

  const cellThickness =
    LOOK.gridCellThickness * (zoom === null ? 0 : cellOpacity(zoom * GROUND_EDGE_PX_PER_ZOOM));
  const half = LOOK.slabSize / 2;

  return (
    <ZonesContext.Provider value={zonesValue}>
      <OrthographicCamera ref={cameraRef} makeDefault />
      <hemisphereLight
        args={[LOOK.hemisphere.sky, LOOK.hemisphere.ground, LOOK.hemisphere.intensity]}
      />
      <directionalLight color={LOOK.key.color} intensity={LOOK.key.intensity} position={keyLight} />
      <mesh geometry={slab}>
        <meshStandardMaterial vertexColors roughness={LOOK.slabRoughness} />
      </mesh>
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
    </ZonesContext.Provider>
  );
}
