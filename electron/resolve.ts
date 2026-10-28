import fs from "node:fs";
import path from "node:path";

export const APP_SCHEME = "app";
export const APP_ORIGIN = "app://nexus";

// Segment-aware: a file named `..foo` is inside, `..` and `../x` are not.
function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// Absolute path of the regular file under `root` that `url` names, or null.
function resolveAppFile(url: string, root: string, realRoot: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.host !== "nexus") return null;
    const pathname = decodeURIComponent(parsed.pathname);
    // statSync throws on NUL even with throwIfNoEntry: false.
    if (pathname.includes("\0")) return null;
    const target = path.join(root, pathname === "/" ? "index.html" : pathname);
    if (!isInside(root, target)) return null;
    // A symlink inside root can point outside it; compare the resolved paths.
    if (!isInside(realRoot, fs.realpathSync(target))) return null;
    return fs.statSync(target, { throwIfNoEntry: false })?.isFile() ? target : null;
  } catch {
    return null;
  }
}

export function createAppHandler(
  root: string,
  fetchFile: (file: string) => Promise<Response>,
  log: (message: string, error: unknown) => void,
): (request: Request) => Promise<Response> {
  const realRoot = fs.realpathSync(root);
  return async (request) => {
    const file = resolveAppFile(request.url, root, realRoot);
    if (file === null) return new Response(null, { status: 404 });
    try {
      return await fetchFile(file);
    } catch (error) {
      log(file, error);
      return new Response(null, { status: 500 });
    }
  };
}
