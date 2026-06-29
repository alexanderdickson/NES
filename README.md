# NES (for lack of a better name)

A NES emulator written in TypeScript utilising modern web technologies and with debugging tools.

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

See [glossary.md](./glossary.md) for project terminology.
