import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

// Scope: only relative specifiers (starting with `.`) are resolved. Bare, alias and root-absolute
// specifiers are not: no aliases exist, and `/x` fails TS2307.

// Follows symlinks; for a missing file, resolves the deepest existing parent and appends the rest.
function realPath(absolute) {
  const rest = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

const repoRoot = realPath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

// Repo-relative, lower-cased, `/`-separated; lower-case because macOS paths are case-insensitive.
function toRepoPath(absolute) {
  return path.relative(repoRoot, realPath(absolute)).split(path.sep).join("/").toLowerCase();
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
  if (node && node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node && node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? null;
  }
  return null;
}

function isImportMeta(node, property) {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.name === property &&
    node.object.type === "MetaProperty" &&
    node.object.meta.name === "import"
  );
}

// Static directory part of a glob: up to the last `/` before the first glob character.
function globPrefix(pattern) {
  const unnegated = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  const firstMagic = unnegated.search(/[*{[?]/);
  if (firstMagic === -1) return unnegated;
  return unnegated.slice(0, Math.max(unnegated.lastIndexOf("/", firstMagic), 0));
}

const noCrossZone = defineRule({
  meta: { messages: { fence: "{{ message }}" } },
  create(context) {
    const importer = toRepoPath(context.filename);

    function checkSpecifier(specifier, sourceNode) {
      if (specifier === null || !specifier.startsWith(".")) return;
      const target = toRepoPath(path.resolve(path.dirname(context.filename), specifier));
      const message = violation(importer, target);
      if (message) context.report({ node: sourceNode, messageId: "fence", data: { message } });
    }

    function check(sourceNode) {
      checkSpecifier(stringValue(sourceNode), sourceNode);
    }

    function checkGlob(node) {
      if (!node) return;
      const patterns = node.type === "ArrayExpression" ? node.elements : [node];
      for (const element of patterns) {
        const pattern = stringValue(element);
        if (pattern !== null) checkSpecifier(globPrefix(pattern), element);
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportType(node) {
        // oxlint exposes the specifier as `source`; `argument` (typescript-estree) is a fallback.
        const argument = node.source ?? node.argument;
        check(argument && argument.type === "TSLiteralType" ? argument.literal : argument);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          check(node.arguments[0]);
        } else if (isImportMeta(node.callee, "glob")) {
          checkGlob(node.arguments[0]);
        }
      },
      NewExpression(node) {
        const [specifier, base] = node.arguments;
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "URL" &&
          base &&
          isImportMeta(base, "url")
        ) {
          check(specifier);
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "module-fences" },
  rules: { "no-cross-zone": noCrossZone },
});
