import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(projectRoot, "node_modules", "maplibre-gl", "dist");
const targetDir = join(projectRoot, "public", "vendor", "maplibre");
const workerFiles = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
];

await mkdir(targetDir, { recursive: true });
await Promise.all(
  workerFiles.map((file) => copyFile(join(sourceDir, file), join(targetDir, file))),
);

console.log(`Copied MapLibre worker modules to ${targetDir}`);
