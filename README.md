# Nexus One

A TypeScript web starter built with [Vite+](https://viteplus.dev/). The current app includes a starter page, static assets, and an interactive counter.

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
- `src/main.ts` — Starter page markup and application initialization.
- `src/counter.ts` — Interactive counter behavior.
- `src/style.css` — Application styles, responsive layouts, and light/dark themes.
- `src/assets/` — Assets imported by the application.
- `public/` — Static files served directly.
- `vite.config.ts` — Vite+ configuration, formatting, linting, type checking, and staged-file checks.
- `tsconfig.json` — TypeScript compiler configuration.
- `.vite-hooks/pre-commit` — Runs checks on staged files before committing.

## Development checks

Before committing changes, run:

```sh
vp check
vp test
vp run build
```

The pre-commit hook runs `vp staged`, which applies `vp check --fix` to staged files. Review any automatic fixes before pushing.

Keep credentials out of version control. `.env` and `.env.*` files are ignored, except `.env.example`, which should contain placeholders only. Dependencies (`node_modules/`) and build output (`dist/`) are also ignored.
