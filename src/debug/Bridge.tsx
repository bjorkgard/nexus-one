import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { installNexus, projectToPage, registerNexus } from "./nexus";

export default function Bridge() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    installNexus(window);
  }, []);

  useEffect(() => {
    const unregisters = [
      registerNexus("getCamera", () => ({
        type: camera.type,
        position: camera.position.toArray(),
        projectionMatrix: camera.projectionMatrix.toArray(),
      })),
      registerNexus("project", (worldPos) => {
        // R3F refreshes the view matrix only when it renders; a call between frames would read a stale one.
        camera.updateMatrixWorld();
        return projectToPage(camera, gl.domElement.getBoundingClientRect(), worldPos);
      }),
      registerNexus("rendererInfo", () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      })),
    ];
    return () => {
      for (const unregister of unregisters) unregister();
    };
  }, [camera, gl]);

  return null;
}
