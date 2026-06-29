import { defineConfig } from "vite";

export default defineConfig({
  // Allow CI (PR previews / Pages) to override the base path so assets resolve
  // under a subdirectory such as /NES/pr-preview/pr-15/.
  base: process.env.BASE_PATH ?? "/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
