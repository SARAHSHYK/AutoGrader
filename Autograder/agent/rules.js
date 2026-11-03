
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { analyzerExists } from "./analyzers/index.js";

export function loadRules(rulesPath) {
  const abs = path.resolve(rulesPath);
  let rules;
  try { rules = JSON.parse(fs.readFileSync(abs, "utf8")); }
  catch (e) { throw new Error(`cannot read rules file ${path.basename(abs)}: ${e.message}`); }

  const errors = [];
  if (typeof rules.problem !== "string" || !rules.problem) errors.push(`"problem" must be a non-empty string`);
  if (!(rules.time_limit_s > 0)) errors.push(`"time_limit_s" must be a positive number`);
  if (!(rules.memory_limit_mb > 0)) errors.push(`"memory_limit_mb" must be a positive number`);
  if (!Array.isArray(rules.metrics) || !rules.metrics.length) errors.push(`"metrics" must be a non-empty list`);
  if (rules.reference !== undefined && sourceText(rules.reference) === null) errors.push(`"reference" must be C source: a string or a list of lines`);

  const names = new Set();
  let total = 0;
  for (const [i, m] of (rules.metrics || []).entries()) {
    const where = `metrics[${i}]${m?.name ? ` (${m.name})` : ""}`;
    if (!m || typeof m.name !== "string" || !m.name) { errors.push(`${where}: "name" is required`); continue; }
    if (names.has(m.name)) errors.push(`${where}: duplicate metric name`);
    names.add(m.name);
    if (!analyzerExists(m.analyzer)) errors.push(`${where}: unknown analyzer "${m.analyzer}" (no file agent/analyzers/${m.analyzer}.js)`);
    if (typeof m.weight !== "number" || m.weight < 0) errors.push(`${where}: "weight" must be a number ≥ 0`);
    else total += m.weight;
  }
  if (Math.abs(total - 1) > 1e-6 && rules.metrics?.length) errors.push(`weights sum to ${total.toFixed(4)}, they must sum to 1.00`);

  if (errors.length) throw new Error(`invalid rules file ${path.basename(abs)}:\n  - ${errors.join("\n  - ")}`);

  return {
    ...rules,
    seed: rules.seed ?? 42,
    metrics: rules.metrics.map((m) => ({ ...m, params: m.params || {} })),
    file: path.basename(abs),
    hash: `sha256:${crypto.createHash("sha256").update(canonical(rules)).digest("hex")}`,
  };
}

export function sourceText(v) {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((l) => typeof l === "string")) return v.join("\n") + "\n";
  return null;
}

export function hiddenTests(rules) {
  return rules.metrics.find((m) => m.analyzer === "io_tests")?.params.tests || [];
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
