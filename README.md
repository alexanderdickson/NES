# NES (for lack of a better name)

A NES emulator written in TypeScript utilising modern web technologies and with debugging tools.

## The disassembler & debugging tools

The first deliverable is a browser-based **NES ROM disassembler / explorer**. Run it with
`pnpm dev` and open the dev server URL. The app boots with a generated sample ROM already
loaded, and you can open any iNES (`.nes`) file with the **Open .nes** button.

The window is organised as a ROM-info bar plus four tabs:

### 1. Disassembly — recursive scan

The disassembler uses **recursive-descent (a.k.a. recursive traversal) disassembly** rather
than a naive linear sweep, so it can reliably tell code from data:

1. **Seed** the work queue with the three CPU vectors read from the ROM —
   RESET (`$FFFC`), NMI (`$FFFA`) and IRQ/BRK (`$FFFE`).
2. **Decode** the instruction at each address and follow control flow:
   - conditional **branches** (`BPL`, `BNE`, …) queue their target _and_ fall through;
   - **`JSR`** queues the subroutine target and continues after the call;
   - absolute **`JMP`** queues the target and stops the linear run (unconditional);
   - **`RTS` / `RTI` / `BRK`** and jam (`KIL`) opcodes stop the linear run;
   - indirect **`JMP ($xxxx)`** stops (the target can't be resolved without execution).
3. Every byte reached this way is **code**; everything else is rendered as `.byte` **data**.
4. Jump/branch/call targets become auto-generated labels: `reset` / `nmi` / `irq` for the
   vectors, `sub_XXXX` for `JSR` targets and `loc_XXXX` for branch/jump targets.

The full 6502 instruction set is decoded, including **undocumented opcodes** (flagged with a
`; undocumented` comment), all 13 addressing modes, and base cycle counts. A header shows the
resolved vectors and code/data statistics; a **Go to** box jumps to an address.

### 2. Memory — peek & poke

A paged hex viewer over the simplified CPU address space:

| Range           | Contents                                        |
| --------------- | ----------------------------------------------- |
| `$0000`–`$1FFF` | 2 KiB internal RAM, mirrored every `$0800`      |
| `$2000`–`$401F` | PPU / APU / IO registers (flat editable buffer) |
| `$4020`–`$7FFF` | expansion / PRG-RAM (flat editable buffer)      |
| `$8000`–`$FFFF` | PRG-ROM mapped from the cartridge               |

**Peek** reads the byte at an address; **poke** writes one. Clicking a byte in the dump
selects it and fills the address/value fields. Poking into the PRG window edits the ROM
buffer in place and automatically **re-runs the recursive scan**, so you can patch code and
immediately see the new disassembly.

### 3. Tiles — CHR / pattern-table viewer

CHR data is decoded into 8×8 tiles and drawn to a canvas. Each tile is 16 bytes: two
bit-planes of 8 bytes that combine into 2-bit (0–3) colour indices. Controls let you pick the
region (all CHR, pattern table 0, pattern table 1), the working palette, and the zoom level;
hovering reports the tile index and its CHR offset. ROMs that use CHR-RAM (no CHR-ROM in the
file) are detected and shown as an empty 8 KiB window.

### 4. Palettes

Shows the full NES 64-colour master palette and four editable 4-colour **working palettes**.
Click a master colour to select it, then click a palette slot to assign it. The working
palettes drive the Tiles view.

## The emulator

The **Emulator** tab runs the cartridge on a full console (`src/core/emu/`): a 6502/2A03
**CPU**, the 2C02 **PPU** rendering to a canvas, the 2A03 **APU** mixing five audio channels
through the Web Audio API, two **controllers**, and a system **bus** wiring it all together.
A companion **Audio** tab shows live per-channel level meters, per-channel mute toggles and a
mixed-output oscilloscope.

Controls: arrow keys = D-pad, `Z` = A, `X` = B, `Enter` = Start, `Shift` = Select. Audio
needs a user gesture, so click **Enable audio** once.

### Mappers

The cartridge mapper is selected automatically from the iNES header. The following are
implemented; anything else falls back to NROM behaviour so the ROM still loads (the info bar
flags it as `unsupported → NROM`):

| #   | Mapper       | Notes                                  |
| --- | ------------ | -------------------------------------- |
| 0   | NROM         | fixed PRG, fixed CHR                   |
| 1   | MMC1         | PRG/CHR banking + mirroring control    |
| 2   | UxROM        | 16K PRG bank switch, CHR-RAM           |
| 3   | CNROM        | 8K CHR bank switch                     |
| 4   | MMC3         | PRG/CHR banking + scanline IRQ         |
| 7   | AxROM        | 32K PRG bank + single-screen mirroring |
| 9   | MMC2         | CHR latch (Punch-Out!!)                |
| 10  | MMC4         | CHR latch + 16K PRG                    |
| 11  | Color Dreams | 32K PRG + 8K CHR select                |
| 66  | GxROM        | 32K PRG + 8K CHR select                |
| 71  | Camerica     | UxROM-style 16K PRG bank               |

> "Support all mappers" isn't a finite target — there are 250+ iNES mapper numbers, many
> undocumented. The set above covers the overwhelming majority of the licensed library
> (MMC1/MMC3/UxROM/NROM alone account for most games). The MMC3 scanline IRQ is clocked once
> per rendered scanline, which is accurate enough for the common cases but not a true PPU A12
> edge counter. New mappers slot in via `createMapper()` in `mappers.ts`.

### Region: NTSC & PAL

The region is detected from the iNES header (byte 9 bit 0, with byte 10 as a fallback) and
can be overridden from the **Region** selector in the emulator toolbar. PAL differs from NTSC
in several timed subsystems, all parameterised by region:

- **Console** — PAL clocks the PPU at 3.2 dots per CPU cycle (averaged as a 3,3,3,3,4
  pattern) versus 3 on NTSC.
- **PPU** — 312 scanlines (pre-render line 311) versus 262 (261) on NTSC.
- **APU** — PAL noise-period and DMC-rate tables, PAL frame-counter step cadence, and the
  1.662 MHz PAL CPU clock for sample timing.

## Architecture & reuse for the emulator

The code is split into a UI-agnostic **core** and a thin **UI** layer so that the building
blocks created for the tools can be reused directly by the eventual emulator. Nothing in
`src/core` depends on the DOM.

```
src/
  core/                 reusable, UI-agnostic engine
    types.ts            addressing modes + the Opcode shape (mnemonic, mode, cycles, legal?)
    opcodes.ts          the full 256-entry 6502 opcode table (single source of truth)
    rom.ts              iNES (.nes) parsing → { prg, chr, mapper, mirroring, … }
    memory.ts           Memory interface + AddressSpace (the CPU bus model)
    disassembler.ts     decodeInstruction() + recursive-scan disassemble()
    ppu.ts              CHR tile decoding + the NES master palette
    sampleRom.ts        generates a valid NROM test ROM
  ui/                   browser-only views built on the core
    app.ts, dom.ts, *View.ts
```

### How each core module feeds the emulator

| Module                    | Tool use today                     | Emulator use later                                            |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `opcodes.ts` / `types.ts` | mnemonic + addressing for listing  | the **CPU core** decodes from the same table (incl. `cycles`) |
| `disassembler.ts`         | recursive listing                  | `decodeInstruction()` powers the **debugger / trace logger**  |
| `memory.ts` (`Memory`)    | static address space for peek/poke | the **bus** implements the same `Memory` interface            |
| `rom.ts`                  | header info + PRG/CHR extraction   | cartridge loading & **mapper** selection                      |
| `ppu.ts`                  | tile/palette viewer                | the **PPU renderer** (tiles, palette → RGBA)                  |

The key seam is the **`Memory` interface** (`MemoryReader` / `MemoryWriter`) in
`memory.ts`. The disassembler, hex viewer and any future tracer depend only on this contract,
never on a concrete class. Today the tools use `AddressSpace` (a simplified, NROM-accurate
model); the emulator will provide a cycle-accurate `Bus` that dispatches reads/writes to the
PPU, APU and mapper. Because both satisfy `Memory`, every debugging tool works unchanged
against the live machine. Likewise `decodeInstruction()` and the opcode table (with cycle
counts) are exactly what a CPU step + disassembling trace logger need.

> The static analysis tools still use the simplified `AddressSpace` (NROM-style mapping);
> the live emulator uses the full `Bus` + mapper set documented above. Indirect `JMP` isn't
> statically followed by the disassembler.

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
