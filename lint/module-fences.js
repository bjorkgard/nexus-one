import path from "node:path";
import { fileURLToPath } from "node:url";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Repo-relative, lower-cased, `/`-separated; lower-case because macOS paths are case-insensitive.
function toRepoPath(absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join("/").toLowerCase();
}

function inside(target, folder) {
  return target === folder || target.startsWith(`${folder}/`);
}

function escapesRepo(target) {
  return target === ".." || target.startsWith("../") || path.isAbsolute(target);
}

function violation(importer, target) {
  if (escapesRepo(target)) {
    return "This import escapes the repo; keep imports inside the project.";
  }
  if (inside(importer, "src/shared") && !inside(target, "src/shared")) {
    return "src/shared/ is a leaf module: it may import only other src/shared/ files. Move shared types into src/shared/.";
  }
  if (inside(importer, "src") && (inside(target, "collector") || inside(target, "electron"))) {
    return "src/ runs in the browser; Node-only code lives in collector/ and Electron main and preload code in electron/. Share data through src/shared types.";
  }
  if (inside(importer, "collector") && inside(target, "src") && !inside(target, "src/shared")) {
    return "collector/ may import src/ only through src/shared; other src/ code belongs to the browser.";
  }
  return null;
}

function stringValue(node) {
  return node && node.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

const noCrossZone = defineRule({
  meta: { messages: { fence: "{{ message }}" } },
  create(context) {
    const importer = toRepoPath(context.filename);

    function check(sourceNode) {
      const specifier = stringValue(sourceNode);
      if (specifier === null || !specifier.startsWith(".")) return;
      const target = toRepoPath(path.resolve(path.dirname(context.filename), specifier));
      const message = violation(importer, target);
      if (message) context.report({ node: sourceNode, messageId: "fence", data: { message } });
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          check(node.arguments[0]);
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "module-fences" },
  rules: { "no-cross-zone": noCrossZone },
});
