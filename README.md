# Nexus One

The Nexus One shell: a React + React Three Fiber + Tailwind app built with [Vite+](https://viteplus.dev/).

## Getting started

Install the Vite+ CLI (`vp`) using the [official installation guide](https://viteplus.dev/guide/), then clone the repository and install dependencies:

```sh
git clone https://github.com/bjorkgard/nexus-one.git
cd nexus-one
vp install
```

The project uses npm, with its version declared in `package.json`. Run `vp install` again after pulling dependency changes.

Start the development server:

```sh
vp run dev
```

Open the local URL printed in the terminal. Changes to source files update the app through hot module replacement.

## Commands

- `vp run dev` — Start the development server.
- `vp check` — Check formatting, lint rules, and TypeScript types.
- `vp test` — Run tests. No test files are included yet, so this currently exits with code 1.
- `vp run build` — Run the TypeScript compiler checks and create a production build in `dist/`.
- `vp run preview` — Serve the production build locally after building.

Use `vp run <name>` for scripts defined in `package.json`. Built-in commands such as `vp check` and `vp test` run directly.

## Project structure

- `index.html` — HTML entry point.
- `src/main.tsx` — Application entry; mounts React into `#app`.
- `src/App.tsx` — Root component with the 3D canvas and its error boundary.
- `src/style.css` — Tailwind import and base layout styles.
- `src/world/` — Geometry.
- `src/sim/` — Simulation and animation state.
- `src/ui/` — Dashboard.
- `src/data/` — Client store and data sources.
- `src/shared/` — Types and schema shared with `collector/`; imports no React, Three, Node, or other `src/` folders; ESM only (no `require`).
- `collector/` — Node-only code; imports no React, Three, Electron, or `src/` except `src/shared/`; ESM only (no `require`).
- `electron/` — Electron main and preload.
- Module fences: `src/` cannot import Node built-ins, `collector/`, or `electron/`. Lint (`vp check`) enforces them; relative imports are checked on the resolved path by `lint/module-fences.js`.
- `lint/` — Local Oxlint plugin with the module-fence rule.
- `vite.config.ts` — Vite+ configuration, plugins, formatting, linting, type checking, and staged-file checks.
- `tsconfig.json` — TypeScript compiler configuration.
- `.vite-hooks/pre-commit` — Runs checks on staged files before committing.
- `TODOS.md` — Deferred work.
- `CHANGELOG.md` — Release notes.
- `AGENTS.md` — Vite+ toolchain instructions for coding agents.
- `CLAUDE.md` — Project rules for Claude Code, including where plan reviews are stored.
- `docs/PLAN.md` — Phased build plan.
- `docs/plans/` — Per-task plan and review files.

## Development checks

Before committing changes, run:

```sh
vp check
vp test
vp run build
```

The pre-commit hook runs `vp staged`, which applies `vp check --fix` to staged files. Review any automatic fixes before pushing.

Keep credentials out of version control. `.env` and `.env.*` files are ignored, except `.env.example`, which should contain placeholders only. Dependencies (`node_modules/`) and build output (`dist/`) are also ignored.
