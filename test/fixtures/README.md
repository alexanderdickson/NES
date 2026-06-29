# Test fixtures

## nestest

- `nestest.nes` — the `nestest` CPU test ROM by **kevtris**, the de-facto 6502 conformance
  test for NES emulators. It is freely distributable for emulator testing/development.
- `nestest.log.gz` — gzip-compressed reference execution log (state recorded before every
  instruction) used as the golden trace by `test/cpu.nestest.test.ts`. Compressed to keep the
  repository small; it is decompressed in-memory at test time.

These files are third-party artifacts included only for automated testing.
