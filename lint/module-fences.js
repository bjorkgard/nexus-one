import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";
import { globSync } from "tinyglobby";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

// Allow-list: a file in a zone may import only inside its allowed folders; static specifiers only.
// Resolved: relative (`.`) and root-absolute (`/`) specifiers, with any `?query` or `#hash` removed.
// A root-absolute path is fenced when its first segment is an entry in ROOT_ENTRIES (or such an
// entry without its last extension, as `/vite.config` resolves to vite.config.ts), when it is `/`,
// or when it resolves outside the repo. Any other root-absolute path is a Vite publicDir
// (`public/`) asset URL and is allowed; the disk is not read, so the folder need not exist.
// Every static specifier but `node:` is also run through Vite's own resolver
// (lint/module-fences-resolver.js, the project's vite.config.ts, client and ssr environments), and the
// file Vite loads is fenced too. Vite normalizes `..` after a `?`/`#`, follows the importer's package.json
// `browser` and `imports` maps and takes absolute disk paths, which the hand-written resolution misses.
// The hand-written resolution stays as a superset (public/ URLs, files Vite does not resolve, .d.ts,
// package.json entry fields). If the resolver fails or times out, the import is reported.
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

// Vite resolves an import of `x.js` to an existing `x.ts` (and `.mjs` to `.mts`, `.cjs` to `.cts`),
// and tries that swap before the plain extensions.
const SOURCE_SWAPS = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

// A type-only import may resolve to a declaration file. They come after every runtime file, so they
// never change which file wins when a runtime file exists.
const DECLARATION_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts"];
const DECLARATION_SWAPS = { ".js": ".d.ts", ".jsx": ".d.ts", ".mjs": ".d.mts", ".cjs": ".d.cts" };

// First existing file among the `.js` -> `.ts` swap of `absolute`, `absolute` + extension, then (for a
// directory) `absolute/index` + extension; declaration files last.
function probeFile(absolute, withIndex = true) {
  const extension = path.extname(absolute);
  const stem = absolute.slice(0, absolute.length - extension.length);
  const candidates = [
    ...(SOURCE_SWAPS[extension] ?? []).map((swap) => `${stem}${swap}`),
    ...PROBE_EXTENSIONS.map((probe) => `${absolute}${probe}`),
  ];
  const declarations = [
    ...DECLARATION_EXTENSIONS.map((probe) => `${absolute}${probe}`),
    ...(DECLARATION_SWAPS[extension] ? [`${stem}${DECLARATION_SWAPS[extension]}`] : []),
  ];
  if (withIndex) {
    candidates.push(...PROBE_EXTENSIONS.map((probe) => path.join(absolute, `index${probe}`)));
    declarations.push(
      ...DECLARATION_EXTENSIONS.map((probe) => path.join(absolute, `index${probe}`)),
    );
  }
  candidates.push(...declarations);
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

// The rule is synchronous but Vite's resolver is not: a worker runs it, and Atomics.wait blocks
// until the worker answers. One worker per process, started on first use; it never keeps the process alive.
const RESOLVE_TIMEOUT_MS = 60_000;
let worker = null;
let requestId = 0;

function startWorker() {
  const signal = new SharedArrayBuffer(4);
  const { port1, port2 } = new MessageChannel();
  const thread = new Worker(new URL("./module-fences-resolver.js", import.meta.url), {
    workerData: { signal, port: port2, root: repoRoot },
    transferList: [port2],
  });
  const started = { thread, port: port1, flag: new Int32Array(signal) };
  thread.unref();
  port1.unref();
  // a dead worker is replaced on the next call; the pending call times out and fails closed
  thread.on("error", () => {
    if (worker === started) worker = null;
  });
  thread.on("exit", () => {
    if (worker === started) worker = null;
  });
  return started;
}

// Ids Vite resolves `specifier` to from `importer`, one per environment (null: not resolved).
// Throws when the worker fails or does not answer within `timeoutMs`.
export function viteResolve(specifier, importer, timeoutMs = RESOLVE_TIMEOUT_MS) {
  worker ??= startWorker();
  const current = worker;
  const id = ++requestId;
  Atomics.store(current.flag, 0, 0);
  current.thread.postMessage({ id, specifier, importer });
  if (Atomics.wait(current.flag, 0, 0, timeoutMs) === "timed-out") {
    if (worker === current) worker = null;
    void current.thread.terminate();
    throw new Error(`Vite resolver timed out after ${timeoutMs} ms`);
  }
  const reply = receiveMessageOnPort(current.port)?.message;
  if (!reply || reply.id !== id) throw new Error("Vite resolver sent no matching answer");
  if (reply.error) throw new Error(reply.error);
  return reply.ids;
}

let resolveImpl = viteResolve;

// For tests: swaps the resolver, returns the previous one.
export function setResolveImpl(impl) {
  const previous = resolveImpl;
  resolveImpl = impl;
  return previous;
}

// The id itself and, for an id that kept a `?query` or `#hash`, each prefix cut before one.
function fileCandidates(id) {
  const candidates = [id];
  for (const match of id.matchAll(/[?#]/g)) candidates.push(id.slice(0, match.index));
  return candidates;
}

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

// Looks through the wrappers around an expression: `a?.b`, `(0, a.b)` and parentheses.
function unwrap(node) {
  let current = node;
  for (;;) {
    if (current.type === "ChainExpression" || current.type === "ParenthesizedExpression") {
      current = current.expression;
    } else if (current.type === "SequenceExpression") {
      current = current.expressions[current.expressions.length - 1];
    } else {
      return current;
    }
  }
}

// Whether `import.meta.url` is read anywhere in the expression (under `as`, `!`, `?? ""`, a template,
// a ternary, `String(...)`, a `<string>` cast and the like): it still gives the importer's URL.
function hasImportMetaUrl(node) {
  if (isImportMeta(node, "url")) return true;
  return Object.entries(node).some(
    ([key, value]) =>
      key !== "parent" &&
      (Array.isArray(value) ? value : [value]).some(
        (child) =>
          child !== null &&
          typeof child === "object" &&
          typeof child.type === "string" &&
          hasImportMetaUrl(child),
      ),
  );
}

// Every string in a package.json entry value (`exports` may nest conditions and arrays).
function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value !== null && typeof value === "object")
    return Object.values(value).flatMap(collectStrings);
  return [];
}

// Files a folder's package.json can name as its entry: `exports` (its `.` entry), `browser` (a string
// or every value of a map), `module`, `jsnext:main`, `jsnext`, `main`, `types` and `typings`. An entry
// that is itself a folder with a package.json is followed the same way; `seen` stops a cycle. A superset
// of what Vite picks. A missing or non-file package.json names nothing; a file that is not valid JSON
// (after Vite's BOM strip) fails closed: it names the filesystem root, which lies outside every zone,
// so the importing specifier is reported with the zone's message.
function packageEntries(folder, seen = new Set()) {
  const real = realPath(folder);
  if (seen.has(real)) return [];
  seen.add(real);
  const file = path.join(real, "package.json");
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return [];
  let entries;
  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    const exported =
      manifest.exports && typeof manifest.exports === "object" && "." in manifest.exports
        ? manifest.exports["."]
        : manifest.exports;
    entries = [
      ...collectStrings(exported),
      ...collectStrings(manifest.browser),
      ...collectStrings(manifest.module),
      ...collectStrings(manifest["jsnext:main"]),
      ...collectStrings(manifest.jsnext),
      ...collectStrings(manifest.main),
      ...collectStrings(manifest.types),
      ...collectStrings(manifest.typings),
    ].map((entry) => path.resolve(real, entry));
  } catch {
    return [path.parse(real).root];
  }
  return entries.flatMap((entry) => [entry, ...packageEntries(entry, seen)]);
}

function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
      glob: "import.meta.glob in a fenced zone must use relative or root-absolute patterns without `#`, and no `base` option.",
      globOptions: "glob options must be a literal object without `base`.",
      outsideRepo:
        "{{file}} is outside the repo root, so the module fence cannot place it in a zone.",
      resolverFailed:
        "The module fence could not run Vite's resolver, so it cannot check this import; failing closed.",
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
    const importerFile = realPath(context.filename);
    const dir = path.dirname(importerFile);

    // Resolves a relative or root-absolute path; null for anything else. `probe` adds the
    // extension/index probing of a module specifier; a glob prefix is the directory searched.
    // A module specifier is percent-decoded first, as Vite does; a glob prefix is read literally.
    function resolveFrom(specifier, probe = true) {
      if (specifier.startsWith(".")) return toRepoPath(path.resolve(dir, specifier), probe);
      if (specifier.startsWith("/")) {
        const decoded = probe ? decodePath(specifier) : specifier;
        // `/@fs/<absolute path>` serves any file on disk, so it is never a public/ URL
        if (decoded.startsWith("/@fs/")) return toRepoPath(path.resolve(decoded.slice(4)), probe);
        const target = toRepoPath(path.join(repoRoot, decoded), probe);
        const [first] = target.split("/");
        return target === "" || leavesRepo(target) || FENCED_FIRST_SEGMENTS.has(first)
          ? target
          : null;
      }
      return null;
    }

    // Repo paths of the package.json entries of a specifier that names a folder.
    function packageTargets(specifier) {
      const decoded = decodePath(specifier);
      const absolute = specifier.startsWith(".")
        ? path.resolve(dir, specifier)
        : decoded.startsWith("/@fs/")
          ? path.resolve(decoded.slice(4))
          : path.join(repoRoot, decoded);
      return packageEntries(absolute).map((entry) => toRepoPath(entry, true));
    }

    function isAllowed(target) {
      // The root package.json is JSON only, so every zone may read it.
      return target === "package.json" || zone.allowed.some((folder) => inside(target, folder));
    }

    // Repo paths of the files Vite loads for a specifier; null when the resolver failed. Every
    // specifier goes to Vite: the importer's package.json `browser` map can redirect a bare name. Only
    // an id that is a file on disk counts (a public/ URL id such as `/logo.svg` is not). A bare name
    // that lands in node_modules or outside the repo is an npm package, not a zone import.
    const viteCache = new Map();
    function viteTargets(specifier) {
      // `node:` builtins cannot be redirected by a package.json map
      if (specifier.startsWith("node:")) return [];
      if (!viteCache.has(specifier)) {
        const pathLike = /^([./#]|[A-Za-z]:[\\/]|file:)/.test(specifier);
        let targets;
        try {
          targets = resolveImpl(specifier, importerFile)
            .filter((id) => typeof id === "string" && !id.startsWith("\0") && path.isAbsolute(id))
            .flatMap(fileCandidates)
            .filter((file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile())
            .map((file) => toRepoPath(file))
            .filter(
              (target) => pathLike || !(leavesRepo(target) || inside(target, "node_modules")),
            );
        } catch {
          targets = null;
        }
        viteCache.set(specifier, targets);
      }
      return viteCache.get(specifier);
    }

    function checkSpecifier(specifier, node) {
      // A data: module carries its own imports (`export * from '/electron/x.ts'`) that the bundler
      // resolves but Vite's resolver does not see, so it cannot be fenced.
      if (/^data:/i.test(specifier)) {
        context.report({ node, messageId: "nonStatic" });
        return;
      }
      const viaVite = viteTargets(specifier);
      if (viaVite === null) {
        context.report({ node, messageId: "resolverFailed" });
        return;
      }
      if (viaVite.some((candidate) => !isAllowed(candidate))) {
        context.report({ node, messageId: zone.messageId });
        return;
      }
      const clean = specifier.replace(/[?#][\s\S]*$/, "");
      const target = resolveFrom(clean);
      if (target === null) return;
      if ([target, ...packageTargets(clean)].some((candidate) => !isAllowed(candidate))) {
        context.report({ node, messageId: zone.messageId });
      }
    }

    // For import(), require() and new URL(): the specifier must be a static string.
    function check(node) {
      if (!node) return;
      const specifier = stringValue(node);
      if (specifier === null) context.report({ node, messageId: "nonStatic" });
      else checkSpecifier(specifier, node);
    }

    function checkGlobPattern(node) {
      const pattern = stringValue(node);
      if (pattern === null) {
        context.report({ node, messageId: "nonStatic" });
        return;
      }
      // A `!` exclude cannot add files, so it needs no zone check.
      if (pattern.startsWith("!")) return;
      // Vite keeps a `#` and joins the raw glob, so `./a#/../x` climbs out of what the fence reads.
      if (pattern.includes("#") || !/^(\.\.?\/|\/)/.test(pattern)) {
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
      if (target === null) return;
      if (!isAllowed(target)) {
        context.report({ node, messageId: zone.messageId });
        return;
      }
      // A matched file may be a symlink into another zone, so each one is fenced by its real path.
      // tinyglobby is Vite's matcher and walks into linked folders; `dot` makes it a superset.
      const cwd = pattern.startsWith("/") ? repoRoot : dir;
      const leaks = globSync(pattern.startsWith("/") ? pattern.slice(1) : pattern, {
        cwd,
        absolute: true,
        dot: true,
        expandDirectories: false,
      }).some(
        (file) =>
          fs.statSync(file, { throwIfNoEntry: false })?.isFile() && !isAllowed(toRepoPath(file)),
      );
      if (leaks) context.report({ node, messageId: zone.messageId });
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

    // The key name of a destructuring property; null when it cannot be read.
    function patternKey(property) {
      const key = property.type === "Property" ? property.key : null;
      return key && (key.type === "Identifier" && !property.computed ? key.name : stringValue(key));
    }

    // Climbs out of the wrappers `unwrap` looks through; returns the outermost node still holding `node`.
    function outermost(node) {
      let current = node;
      for (;;) {
        const parent = current.parent;
        if (
          parent &&
          (parent.type === "ChainExpression" ||
            parent.type === "ParenthesizedExpression" ||
            (parent.type === "SequenceExpression" &&
              parent.expressions[parent.expressions.length - 1] === current))
        ) {
          current = parent;
        } else {
          return current;
        }
      }
    }

    // `import.meta.resolve` and `import.meta.glob` are read only as the direct callee of a call, and a
    // bare `import.meta` only as a member object or as the source of a destructuring that names other
    // keys. Any other use (an alias, an argument, a default, a `??` operand) hides the call from the
    // rule, so it is reported. `import.meta.url`, `.env`, `.hot` and the like stay plain reads.
    function checkMetaUse(node) {
      if (node.meta.name !== "import") return;
      const member = node.parent;
      if (member && member.type === "MemberExpression" && member.object === node) {
        const name = member.computed ? stringValue(member.property) : member.property.name;
        const whole = outermost(member);
        const parent = whole.parent;
        // a call reports an unreadable key (`name === null`) at its callee
        if (name === "resolve" || name === "glob" || name === null) {
          if (!(parent && parent.type === "CallExpression" && parent.callee === whole)) {
            context.report({ node: member, messageId: "nonStatic" });
          }
        }
        return;
      }
      const whole = outermost(node);
      const parent = whole.parent;
      const target =
        parent &&
        ((parent.type === "VariableDeclarator" && parent.init === whole && parent.id) ||
          (parent.type === "AssignmentExpression" && parent.right === whole && parent.left) ||
          (parent.type === "AssignmentPattern" && parent.right === whole && parent.left));
      if (target && target.type === "ObjectPattern") {
        for (const property of target.properties) {
          const name = patternKey(property);
          // `url` too: `new URL(x, url)` would otherwise hide the import from the base-URL check
          if (name === null || name === "resolve" || name === "glob" || name === "url") {
            context.report({ node: property, messageId: "nonStatic" });
          }
        }
      } else {
        context.report({ node, messageId: "nonStatic" });
      }
    }

    return {
      MetaProperty: checkMetaUse,
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
        const target = unwrap(callee);
        if (callee.type === "Identifier" && callee.name === "require") {
          check(node.arguments[0]);
        } else if (isImportMeta(target, "glob")) {
          checkGlob(node);
        } else if (isImportMeta(target, "resolve")) {
          check(node.arguments[0]);
        } else if (isDynamicImportMeta(target)) {
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
        const [specifier, argument] = node.arguments;
        if (node.callee.type !== "Identifier" || node.callee.name !== "URL" || !argument) return;
        if (hasImportMetaUrl(argument)) check(specifier);
      },
    };
  },
});

export default definePlugin({
  meta: { name: "module-fences" },
  rules: { "no-cross-zone": noCrossZone },
});
