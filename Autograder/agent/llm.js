
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./paths.js";

const CACHE_DIR = path.join(ROOT, ".cache", "llm");
const host = () => process.env.OLLAMA_HOST || "http://localhost:11434";
export const defaultModel = () => process.env.OLLAMA_MODEL || "llama3.2:3b";

export async function ollamaStatus() {
  try {
    const r = await fetch(`${host()}/api/tags`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { running: false, models: [] };
    return { running: true, models: ((await r.json()).models || []).map((m) => m.name) };
  } catch {
    return { running: false, models: [] };
  }
}

const matches = (available, wanted) => available.some((m) => m === wanted || m === `${wanted}:latest`);

export async function resolveModel(requested) {
  const { running, models } = await ollamaStatus();
  if (!running) return null;
  if (requested && matches(models, requested)) return { model: requested, substituted: false };
  if (matches(models, defaultModel())) return { model: defaultModel(), substituted: Boolean(requested) };
  return null;
}

export async function callModel({ model, system, user, temperature = 0, seed = 42, maxTokens = 600 }) {
  const key = crypto.createHash("sha256").update(JSON.stringify({ model, system, user, temperature, seed, maxTokens })).digest("hex");
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(file)) return { text: JSON.parse(fs.readFileSync(file, "utf8")).text, cached: true };

  const r = await fetch(`${host()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      stream: false,
      format: "json",
      options: { temperature, seed, num_predict: maxTokens },
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const text = (await r.json()).message?.content || "";

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ model, temperature, seed, text }, null, 2));
  return { text, cached: false };
}

export function extractJson(text) {
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}
