import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const htmlEntries = Object.fromEntries([
  ...readdirSync(root)
    .filter((name) => name.endsWith(".html"))
    .map((name) => [name.replace(/\.html$/, ""), resolve(root, name)]),
  ...readdirSync(resolve(root, "admin"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => [`admin-${name.replace(/\.html$/, "")}`, resolve(root, "admin", name)])
]);

export default defineConfig({
  root,
  publicDir: false,
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: htmlEntries
    }
  }
});
