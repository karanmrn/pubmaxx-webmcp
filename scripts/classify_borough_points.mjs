import { readFileSync } from "node:fs";

import { boroughForPoint, loadBoroughIndex } from "./lib/boroughFromPoint.mjs";

const points = JSON.parse(readFileSync(0, "utf8"));
if (!Array.isArray(points)) throw new Error("Expected a JSON array of [lat,lng] points");
const index = loadBoroughIndex();
process.stdout.write(JSON.stringify(points.map(([lat, lng]) => boroughForPoint(lat, lng, index))));
