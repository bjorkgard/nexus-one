import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

// Allow-list: a file in a zone may import only inside its allowed folders; static specifiers only.
// Resolved: relative (`.`) and root-absolute (`/`) specifiers, with any `?query` or `#hash` removed.
// Bare and `node:` specifiers belong to no-restricted-imports and import/no-nodejs-modules.

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

// Allowed target folders per importer zone; files in no zone (electron/, lint/, root) are unchecked.
function zoneOf(importer) {
  if (inside(importer, "src/shared"))
    return { allowed: ["src/shared"], messageId: "outsideShared" };
  if (inside(importer, "src")) return { allowed: ["src"], messageId: "outsideSrc" };
  if (inside(importer, "collector")) {
    return { allowed: ["collector", "src/shared"], messageId: "outsideCollector", collector: true };
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
// Every `?` counts as a wildcard in a glob (never as a query), so the prefix stops there.
function globPrefix(pattern) {
  const firstMagic = pattern.search(/[*{[?(]/);
  if (firstMagic === -1) return { prefix: pattern, rest: "" };
  const cut = Math.max(pattern.lastIndexOf("/", firstMagic), 0);
  return { prefix: pattern.slice(0, cut), rest: pattern.slice(cut) };
}

const noCrossZone = defineRule({
  meta: {
    messages: {
      outsideShared: "src/shared/ is a leaf module: it may import only other src/shared/ files.",
      outsideSrc:
        "src/ may import only other src/ files; Node-only code belongs in collector/ and Electron code in electron/.",
      outsideCollector:
        "collector/ may import only collector/ and src/shared/ files; other src/ code belongs to the browser.",
      nonStatic:
        "Non-static import in a fenced zone; use a string literal so the module fence can check it.",
      glob: "import.meta.glob in a fenced zone must use relative or root-absolute patterns and no `base` option.",
      createRequire: "createRequire is banned in collector/; it would bypass the module fence.",
    },
  },
  create(context) {
    const importer = toRepoPath(context.filename);
    const zone = zoneOf(importer);
    if (!zone) return {};
    const dir = path.dirname(context.filename);

    // Resolves a relative or root-absolute path; null for anything else.
    function resolveFrom(specifier) {
      if (specifier.startsWith(".")) return toRepoPath(path.resolve(dir, specifier));
      if (specifier.startsWith("/")) return toRepoPath(path.join(repoRoot, specifier));
      return null;
    }

    function checkTarget(target, node) {
      if (!zone.allowed.some((folder) => inside(target, folder))) {
        context.report({ node, messageId: zone.messageId });
      }
    }

    function checkSpecifier(specifier, node) {
      const target = resolveFrom(specifier.replace(/[?#][\s\S]*$/, ""));
      if (target !== null) checkTarget(target, node);
    }

    // For import(), require() and new URL(): the specifier must be a static string.
    function check(node) {
      if (!node) return;
      const specifier = stringValue(node);
      if (specifier === null) context.report({ node, messageId: "nonStatic" });
      else checkSpecifier(specifier, node);
    }

    function checkGlobPattern(node) {
      const raw = stringValue(node);
      if (raw === null) {
        context.report({ node, messageId: "nonStatic" });
        return;
      }
      const pattern = (raw.startsWith("!") ? raw.slice(1) : raw).replace(/#[\s\S]*$/, "");
      if (!/^(\.\.?\/|\/)/.test(pattern)) {
        context.report({ node, messageId: "glob" });
        return;
      }
      const { prefix, rest } = globPrefix(pattern);
      // `..` after a wildcard could climb out of the checked prefix.
      if (/(^|[/{,])\.\.([/},]|$)/.test(rest)) {
        context.report({ node, messageId: "glob" });
        return;
      }
      const target = resolveFrom(prefix === "" ? "/" : prefix);
      if (target !== null) checkTarget(target, node);
    }

    function checkGlobOptions(node) {
      if (!node) return;
      if (node.type !== "ObjectExpression") {
        context.report({ node, messageId: "glob" });
        return;
      }
      for (const property of node.properties) {
        const key = property.type === "Property" ? property.key : null;
        const name =
          key && (key.type === "Identifier" && !property.computed ? key.name : stringValue(key));
        if (key === null || name === null || name === "base") {
          context.report({ node: property, messageId: "glob" });
        }
      }
    }

    function checkGlob(node) {
      const [patterns, options] = node.arguments;
      if (!patterns) return;
      if (patterns.type === "ArrayExpression") {
        for (const element of patterns.elements) {
          if (element) checkGlobPattern(element);
        }
      } else {
        checkGlobPattern(patterns);
      }
      checkGlobOptions(options);
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
      ImportSpecifier(node) {
        const imported = node.imported;
        if (zone.collector && (imported.name ?? imported.value) === "createRequire") {
          context.report({ node, messageId: "createRequire" });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier" && callee.name === "require") {
          check(node.arguments[0]);
        } else if (isImportMeta(callee, "glob")) {
          checkGlob(node);
        } else if (
          zone.collector &&
          callee.type === "MemberExpression" &&
          (callee.computed ? stringValue(callee.property) : callee.property.name) ===
            "createRequire"
        ) {
          context.report({ node, messageId: "createRequire" });
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
