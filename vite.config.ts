import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/block-memory-game/" : "/",
  plugins: [svelte()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
}));
