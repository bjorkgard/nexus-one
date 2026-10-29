import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Vector3 } from "three";
import type { Camera } from "three";
import { installNexus, projectToPage, readRendererInfo, registerNexus } from "./nexus";

// Stage writes the look-at point to camera.userData.target; null until a camera has one.
function readTarget(camera: Camera): [number, number, number] | null {
  const target: unknown = camera.userData.target;
  if (!Array.isArray(target) || target.length !== 3 || !target.every(Number.isFinite)) return null;
  return [target[0], target[1], target[2]];
}

export default function Bridge() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    installNexus(window);
  }, []);

  useEffect(() => {
    const unregisters = [
      registerNexus("getCamera", () => {
        camera.updateMatrixWorld();
        return {
          type: camera.type,
          position: camera.position.toArray(),
          direction: camera.getWorldDirection(new Vector3()).toArray(),
          target: readTarget(camera),
          zoom: camera.zoom,
          projectionMatrix: camera.projectionMatrix.toArray(),
        };
      }),
      registerNexus("project", (worldPos) => {
        // R3F refreshes the view matrix only when it renders; a call between frames would read a stale one.
        camera.updateMatrixWorld();
        return projectToPage(camera, gl.domElement.getBoundingClientRect(), worldPos);
      }),
      registerNexus("rendererInfo", () => readRendererInfo(gl)),
    ];
    return () => {
      for (const unregister of unregisters) unregister();
    };
  }, [camera, gl]);

  return null;
}
