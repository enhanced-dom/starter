Scaffolds a new `@enhanced-dom/*` package: `package.json`, `README.md`, `LICENSE.md`, `.gitignore`, and the lint config `.mjs` files, wired for this monorepo's conventions.

## Usage

```
@enhanced-dom-starter <folder> -name <name> [-description <text>] [-type node|browser|isomorphic]
  [-tests jest] [-css] [-react] [-webcomponent] [-demo] [-standalone]
```

- `<folder>` — destination directory (created if missing). Writes always overwrite.
- `-name` — package name, scoped to `@enhanced-dom` unless already scoped (e.g. `-name widget` → `@enhanced-dom/widget`).
- `-description` — package description, used in `package.json` and `README.md`.
- `-type` — `node`, `browser`, or `isomorphic` (default). Forwarded into `configure-build` (`@enhanced-dom-bootstrap-tsconfig`).
- `-tests jest` — adds `@enhanced-dom/jest`, a `test` script, and `test/jest.config.mjs` + `test/tsconfig.json`.
- `-css` — adds stylelint + typed-styles configs for `.pcss` files, and the webpack toolchain.
- `-react` — adds `@enhanced-dom/react` and a `.tsx` entry.
- `-webcomponent` — adds `@enhanced-dom/webcomponent` and a custom-element entry (skipped if `-react` is also set; react's entry wins).
- `-demo` — adds a webpack dev-server app under `demo/` plus `demo`/`docs` scripts.
- `-standalone` — adds `@vercel/ncc` and bundles the build output into a single file (`package` script), instead of `npm pack`.

### Example

```
@enhanced-dom-starter ../widget -name widget -description "A widget" -type browser -tests jest -css -react -demo
```

## Getting started

After scaffolding, `cd` into the new folder and run `npm install` — its `prepare` script then generates `tsconfig.json`, `.fallowrc.json`, `.npmrc`, `.nvmrc`, `.husky/`, and `CLAUDE.md`/`.claude`/`.devcontainer`.
