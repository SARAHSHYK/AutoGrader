
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export function analyzerExists(name) {
  return typeof name === "string" && /^[a-z][a-z0-9_]*$/.test(name) && name !== "index" && fs.existsSync(path.join(DIR, `${name}.js`));
}

export async function loadAnalyzer(name) {
  const mod = await import(pathToFileURL(path.join(DIR, `${name}.js`)).href);
  return mod.default;
}

export function listAnalyzers() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".js") && f !== "index.js").map((f) => f.slice(0, -3)).sort();
}
