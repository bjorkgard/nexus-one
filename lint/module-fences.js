import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

// Allow-list: a file in a zone may import only inside its allowed folders; static specifiers only.
// Resolved: relative (`.`) and root-absolute (`/`) specifiers, with any `?query` or `#hash` removed.
// A root-absolute path is fenced when its first segment is an entry in ROOT_ENTRIES (or such an
// entry without its last extension, as `/vite.config` resolves to vite.config.ts), when it is `/`,
// or when it resolves outside the repo. Any other root-absolute path is a Vite publicDir
// (`public/`) asset URL and is allowed; the disk is not read, so the folder need not exist.
// Bare and `node:` specifiers belong to no-restricted-imports and import/no-nodejs-modules.

// Lower-case root entries: every tracked root entry (`git ls-files`; a unit test guards it) plus
// the untracked folders git, Claude Code (agent worktrees), a build, an install or a test run creates.
export const ROOT_ENTRIES = new Set([
  ".github",
  ".gitignore",
  ".gstack",
  ".vite-hooks",
  ".vscode",
  "agents.md",
  "changelog.md",
  "claude.md",
  "readme.md",
  "todos.md",
  "collector",
  "docs",
  "e2e",
  "electron",
  "index.html",
  "lint",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "playwright.electron.config.ts",
  "src",
  "test",
  "tsconfig.json",
  "vite.config.ts",
  ".git",
  ".claude",
  "dist",
  "dist-electron",
  "release",
  "node_modules",
  "test-results",
  "playwright-report",
]);

const FENCED_FIRST_SEGMENTS = new Set(
  [...ROOT_ENTRIES].flatMap((entry) => [entry, path.parse(entry).name]),
);

// Vite's default resolve.extensions, in its order.
const PROBE_EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"];

// First existing file among `absolute` + extension, then (for a directory) `absolute/index` + extension.
function probeFile(absolute, withIndex = true) {
  const candidates = PROBE_EXTENSIONS.map((extension) => `${absolute}${extension}`);
  if (withIndex) {
    candidates.push(
      ...PROBE_EXTENSIONS.map((extension) => path.join(absolute, `index${extension}`)),
    );
  }
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync.native(candidate);
      // Vite accepts only regular files (following symlinks), never a directory
      if (fs.statSync(real).isFile()) return real;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// Follows symlinks; for a missing file, resolves the deepest existing parent and appends the rest.
// With `probe`, the extensions a bundler would add are tried first, so an extensionless import of a
// file symlink resolves through the link. That includes an existing directory: Vite resolves a
// sibling `absolute` + extension file, then `absolute/index` + extension, before the directory itself.
function realPath(absolute, probe = false) {
  const rest = [];
  let current = absolute;
  for (;;) {
    try {
      if (probe && current === absolute && fs.statSync(current).isDirectory()) {
        const found = probeFile(absolute);
        if (found !== null) return found;
      }
      return path.join(fs.realpathSync.native(current), ...rest);
    } catch {
      if (probe && current === absolute) {
        const found = probeFile(absolute, false);
        if (found !== null) return found;
      }
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

const repoRoot = realPath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

// Repo-relative, lower-cased, `/`-separated; lower-case because macOS paths are case-insensitive.
function toRepoPath(absolute, probe = false) {
  return path.relative(repoRoot, realPath(absolute, probe)).split(path.sep).join("/").toLowerCase();
}

// A repo path that climbs out of the root (or, on Windows, sits on another drive).
function leavesRepo(target) {
  return target === ".." || target.startsWith("../") || path.isAbsolute(target);
}

function inside(target, folder) {
  return target === folder || target.startsWith(`${folder}/`);
}

// Allowed target folders per importer zone; files in no zone (lint/, root) are unchecked.
function zoneOf(importer) {
  if (inside(importer, "src/shared"))
    return { allowed: ["src/shared"], messageId: "outsideShared" };
  if (inside(importer, "src")) return { allowed: ["src"], messageId: "outsideSrc" };
  if (inside(importer, "collector")) {
    return {
      allowed: ["collector", "src/shared"],
      messageId: "outsideCollector",
      createRequireMessageId: "createRequire",
    };
  }
  if (inside(importer, "electron")) {
    return {
      allowed: ["electron", "src/shared"],
      messageId: "outsideElectron",
      createRequireMessageId: "electronCreateRequire",
    };
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

function isImportMetaMember(node) {
  return (
    node.type === "MemberExpression" &&
    node.object.type === "MetaProperty" &&
    node.object.meta.name === "import"
  );
}

// Matches `import.meta.x` and `import.meta["x"]`.
function isImportMeta(node, property) {
  return (
    isImportMetaMember(node) &&
    (node.computed ? stringValue(node.property) : node.property.name) === property
  );
}

// `import.meta[key]` with a key the rule cannot read.
function isDynamicImportMeta(node) {
  return isImportMetaMember(node) && node.computed && stringValue(node.property) === null;
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
      outsideElectron:
        "electron/ may import only electron/ and src/shared/; renderer code stays in src/.",
      nonStatic:
        "Non-static import in a fenced zone; use a string literal so the module fence can check it.",
      glob: "import.meta.glob in a fenced zone must use relative or root-absolute patterns and no `base` option.",
      globOptions: "glob options must be a literal object without `base`.",
      outsideRepo:
        "{{file}} is outside the repo root, so the module fence cannot place it in a zone.",
      createRequire: "createRequire is banned in collector/; it would bypass the module fence.",
      electronCreateRequire:
        "createRequire is banned in electron/; it would bypass the module fence.",
    },
  },
  create(context) {
    const importer = toRepoPath(context.filename);
    if (leavesRepo(importer)) {
      return {
        Program: (node) =>
          context.report({ node, messageId: "outsideRepo", data: { file: context.filename } }),
      };
    }
    const zone = zoneOf(importer);
    if (!zone) return {};
    // Relative specifiers resolve from the real directory, so a symlinked importer dir is seen through.
    const dir = path.dirname(realPath(context.filename));

    // Resolves a relative or root-absolute path; null for anything else. `probe` adds the
    // extension/index probing of a module specifier; a glob prefix is the directory searched.
    function resolveFrom(specifier, probe = true) {
      if (specifier.startsWith(".")) return toRepoPath(path.resolve(dir, specifier), probe);
      if (specifier.startsWith("/")) {
        const target = toRepoPath(path.join(repoRoot, specifier), probe);
        const [first] = target.split("/");
        return target === "" || leavesRepo(target) || FENCED_FIRST_SEGMENTS.has(first)
          ? target
          : null;
      }
      return null;
    }

    function checkTarget(target, node) {
      // The root package.json is JSON only, so every zone may read it.
      if (target === "package.json") return;
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
      // A `!` exclude cannot add files, so it needs no zone check.
      if (raw.startsWith("!")) return;
      const pattern = raw.replace(/#[\s\S]*$/, "");
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
      const target = resolveFrom(prefix === "" ? "/" : prefix, false);
      if (target !== null) checkTarget(target, node);
    }

    function checkGlobOptions(node) {
      if (!node) return;
      if (node.type !== "ObjectExpression") {
        context.report({ node, messageId: "globOptions" });
        return;
      }
      for (const property of node.properties) {
        const key = property.type === "Property" ? property.key : null;
        const name =
          key && (key.type === "Identifier" && !property.computed ? key.name : stringValue(key));
        if (key === null || name === null) {
          context.report({ node: property, messageId: "globOptions" });
        } else if (name === "base") {
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
        if (zone.createRequireMessageId && (imported.name ?? imported.value) === "createRequire") {
          context.report({ node, messageId: zone.createRequireMessageId });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier" && callee.name === "require") {
          check(node.arguments[0]);
        } else if (isImportMeta(callee, "glob")) {
          checkGlob(node);
        } else if (isImportMeta(callee, "resolve")) {
          check(node.arguments[0]);
        } else if (isDynamicImportMeta(callee)) {
          context.report({ node: callee, messageId: "nonStatic" });
        } else if (
          zone.createRequireMessageId &&
          callee.type === "MemberExpression" &&
          (callee.computed ? stringValue(callee.property) : callee.property.name) ===
            "createRequire"
        ) {
          context.report({ node, messageId: zone.createRequireMessageId });
        }
      },
      NewExpression(node) {
        const [specifier, base] = node.arguments;
        if (node.callee.type !== "Identifier" || node.callee.name !== "URL" || !base) return;
        if (isImportMeta(base, "url")) check(specifier);
        else if (isDynamicImportMeta(base)) context.report({ node: base, messageId: "nonStatic" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "module-fences" },
  rules: { "no-cross-zone": noCrossZone },
});
