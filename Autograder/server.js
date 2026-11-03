
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { ROOT, relPath } from "./agent/paths.js";
import { gradeSubmission } from "./agent/coordinator.js";
import { toolVersions } from "./agent/sandbox.js";
import { ollamaStatus, defaultModel } from "./agent/llm.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8788;
const UPLOADS_DIR = path.join(ROOT, "uploads");

app.get("/api/health", async (req, res) => {
  const [tools, ollama] = await Promise.all([toolVersions(), ollamaStatus()]);
  const model = defaultModel();
  res.json({
    gcc: tools.gcc, cppcheck: tools.cppcheck, gcov: tools.gcov,
    ollamaRunning: ollama.running,
    ollamaModel: model,
    ollamaModelAvailable: ollama.models.some((m) => m === model || m === `${model}:latest`),
  });
});

const printLog = (entry) => console.log(`  [${entry.kind}] ${entry.msg}`);

app.post("/api/grade", (req, res) => withUploads(req, res, async (target) => {
  const { report, text, files } = await gradeSubmission({ ...target, onLog: printLog });
  return { report, text, files: { json: relPath(files.json), txt: relPath(files.txt) } };
}));

function saveUploads(body = {}) {
  const { rulesName, rulesContent, sourceName, source } = body;
  if (typeof rulesContent !== "string" || !rulesContent.trim()) return { error: "Upload a rules file (.json)." };
  if (typeof source !== "string" || !source.trim()) return { error: "Upload a C file (.c)." };
  const clean = (name, ext, fallback) => (String(name || fallback).replace(/[^\w.-]/g, "_").replace(new RegExp(`\\${ext}$`, "i"), "") || fallback) + ext;

  let problem = "unknown";
  try { problem = String(JSON.parse(rulesContent).problem || problem); } catch {}
  const dir = path.join(UPLOADS_DIR, problem.replace(/[^\w.-]/g, "_"));
  fs.mkdirSync(path.join(dir, "rules"), { recursive: true });
  const rulesPath = path.join(dir, "rules", clean(rulesName, ".json", "rules"));
  const submissionPath = path.join(dir, clean(sourceName, ".c", "submission"));
  fs.writeFileSync(rulesPath, rulesContent);
  fs.writeFileSync(submissionPath, source);
  return { rulesPath, submissionPath, corpusDir: dir };
}

let busy = false;

async function withUploads(req, res, fn) {
  const target = saveUploads(req.body);
  if (target.error) return res.status(400).json({ error: target.error });
  if (busy) return res.status(409).json({ error: "The grader is busy with another job — try again in a moment." });
  busy = true;
  try {
    res.json(await fn(target));
  } catch (e) {
    console.log(`  [error] ${e.message}`);
    res.status(400).json({ error: e.message });
  } finally {
    busy = false;
  }
}

app.listen(PORT, () => {
  console.log(`AutoGrader server on http://localhost:${PORT}`);
  console.log(`  open the web UI at http://localhost:5174`);
});
