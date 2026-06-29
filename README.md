# NES (for lack of a better name)

A NES emulator written in TypeScript utilising modern web technologies and with debugging tools.

## Disassembler

The first tool is a browser-based **NES ROM disassembler / explorer** (`pnpm dev`). It loads
iNES (`.nes`) ROMs (or a built-in generated sample ROM) and provides:

- **Recursive-descent disassembly** — seeds from the RESET/NMI/IRQ vectors and follows
  `JSR`/`JMP`/branches to classify bytes as code vs. data, auto-generating `sub_`/`loc_`
  labels. Unreached bytes are shown as `.byte` data. The full 6502 instruction set is
  supported, including undocumented opcodes (flagged in the listing).
- **Memory peek/poke** — a paged hex viewer over the CPU address space
  (`$0000–$1FFF` RAM mirrored, IO registers, PRG-ROM at `$8000–$FFFF`). Click a byte to
  select it, then peek/poke values. Poking PRG-ROM re-runs the disassembly.
- **Tile (CHR) viewer** — decodes CHR pattern tables into 8×8 tiles rendered on a canvas,
  with selectable pattern table, palette and zoom.
- **Palette viewer** — the full NES 64-colour master palette plus editable 4-colour
  working palettes that drive the tile viewer.

## Tech stack

- **TypeScript** (vanilla, no UI framework)
- **[Vite](https://vite.dev/)** for the dev server and bundling
- **[tsgo](https://github.com/microsoft/typescript-go)** (`@typescript/native-preview`) for type checking
- **[Oxlint](https://oxc.rs/docs/guide/usage/linter)** for linting
- **[Oxfmt](https://oxc.rs/docs/guide/usage/formatter)** for formatting
- **[pnpm](https://pnpm.io/)** as the package manager

## Getting started

Requires Node.js >= 22 and pnpm.

```bash
pnpm install
pnpm dev
```

## Scripts

| Command          | Description                                        |
| ---------------- | -------------------------------------------------- |
| `pnpm dev`       | Start the Vite dev server                          |
| `pnpm build`     | Type check (tsgo) and bundle for production        |
| `pnpm preview`   | Preview the production build                       |
| `pnpm typecheck` | Type check with tsgo                               |
| `pnpm lint`      | Lint with Oxlint (`pnpm lint:fix` to autofix)      |
| `pnpm fmt`       | Format with Oxfmt (`pnpm fmt:check` to check only) |
| `pnpm check`     | Run typecheck + lint + format check                |

## PR preview deployments

Every pull request is built and deployed to a temporary GitHub Pages URL by the
[`PR Preview`](.github/workflows/pr-preview.yml) workflow. The preview link is
posted as a comment on the PR and removed automatically when the PR is closed.

Preview URL pattern:

```
https://<owner>.github.io/<repo>/pr-preview/pr-<number>/
```

### One-time setup (repo admin)

The workflow needs GitHub Pages enabled before previews can publish:

1. **Settings → Actions → General → Workflow permissions** → enable
   _Read and write permissions_.
2. Push/merge once so the `gh-pages` branch is created (the first PR run will
   create it).
3. **Settings → Pages → Build and deployment** → Source: _Deploy from a branch_,
   Branch: `gh-pages` / `/ (root)`.

The repo must be public (or on a plan that allows Pages) for the preview URLs to
be reachable.

See [glossary.md](./glossary.md) for project terminology.
