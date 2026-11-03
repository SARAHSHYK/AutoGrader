
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";

export const SHIM_HEADER = path.join(ROOT, "agent", "runtime", "ag_shim.h");
const SHIM_SOURCE = path.join(ROOT, "agent", "runtime", "ag_shim.c");

export const TOOLS = {
  cc: process.env.CC || "gcc",
  cppcheck: process.env.CPPCHECK || "cppcheck",
  gcov: process.env.GCOV || "gcov",
  size: "size",
};

const OUTPUT_CAP = 1 << 20;
const STACK_BYTES = 8 * 1024 * 1024;
const MEMORY_EXIT = 77;

const CRASH_CODES = {
  3221225477: "access violation (invalid memory read or write)",
  3221225725: "stack overflow",
  3221225501: "illegal instruction (sanitizer trap)",
  3221225620: "integer divide by zero",
  3221226505: "stack buffer overrun detected",
  3221226356: "heap corruption",
};
const CRASH_SIGNALS = {
  SIGSEGV: CRASH_CODES[3221225477],
  SIGBUS: CRASH_CODES[3221225477],
  SIGILL: CRASH_CODES[3221225501],
  SIGFPE: "arithmetic error (e.g. divide by zero)",
  SIGABRT: "abort() called",
};

export function exec(cmd, args, { cwd, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "";
    let child;
    try { child = spawn(cmd, args, { cwd, windowsHide: true }); }
    catch (e) { return resolve({ code: -1, stdout, stderr: e.message, missing: true }); }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: e.message, missing: e.code === "ENOENT" }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

export async function compile(workDir, { source = "prog.c", out, flags = [], shim = false, objectOnly = false, link = [] }) {
  const args = [...flags];
  if (shim) args.push("-include", SHIM_HEADER);
  if (objectOnly) args.push("-c", source, "-o", out);
  else {
    args.push(source, "-o", out);
    if (shim) args.push(await shimObject(workDir));
    if (process.platform === "win32") args.push(`-Wl,--stack,${STACK_BYTES}`);
    args.push(...link, "-lm");
  }
  const res = await exec(TOOLS.cc, args, { cwd: workDir });
  if (res.missing) throw new Error(`C compiler "${TOOLS.cc}" not found — install gcc and put it on PATH (or set CC in .env).`);
  return { ok: res.code === 0, stderr: res.stderr, diagnostics: parseDiagnostics(res.stderr, source) };
}

export async function link(workDir, { objects, out, flags = [] }) {
  const args = [...objects, await shimObject(workDir), ...flags, "-o", out, "-lm"];
  if (process.platform === "win32") args.push(`-Wl,--stack,${STACK_BYTES}`);
  const res = await exec(TOOLS.cc, args, { cwd: workDir });
  return { ok: res.code === 0, stderr: res.stderr };
}

async function shimObject(workDir) {
  const obj = path.join(workDir, "ag_shim.o");
  if (!fs.existsSync(obj)) {
    const res = await exec(TOOLS.cc, ["-O2", "-c", SHIM_SOURCE, "-o", obj], { cwd: workDir });
    if (res.code !== 0) throw new Error(`could not build the allocation shim: ${res.stderr.slice(0, 300)}`);
  }
  return obj;
}

export function parseDiagnostics(stderr, source = "prog.c") {
  const out = [];
  const re = /^(.*?):(\d+):(\d+): (fatal error|error|warning): (.*?)(?: \[([^\]]+)\])?\s*$/gm;
  let m;
  while ((m = re.exec(stderr))) {
    if (path.basename(m[1]) !== source) continue;
    out.push({ line: Number(m[2]), col: Number(m[3]), kind: m[4] === "warning" ? "warning" : "error", message: m[5], flag: m[6] || null });
  }
  return out;
}

export async function staticBytes(exe) {
  const res = await exec(TOOLS.size, [exe]);
  const m = res.stdout.split("\n")[1]?.trim().split(/\s+/);
  return m ? Number(m[1]) + Number(m[2]) : 0;
}

export function run(exe, { input = "", timeLimitS, memoryLimitMb, cwd, reportPath, env: extraEnv = {} }) {
  return new Promise((resolve) => {
    const env = {
      PATH: process.env.PATH || "",
      ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot || "" } : {}),
      AG_HEAP_LIMIT: String(Math.round(memoryLimitMb * 1024 * 1024)),
      ...(reportPath ? { AG_REPORT: reportPath } : {}),
      ...extraEnv,
    };
    if (reportPath) fs.rmSync(reportPath, { force: true });

    let stdout = "", stderr = "", killedFor = null;
    const t0 = process.hrtime.bigint();
    const child = spawn(exe, [], { cwd, env, windowsHide: true });
    const kill = (why) => { if (!killedFor) { killedFor = why; child.kill("SIGKILL"); } };
    const timer = setTimeout(() => kill("timeout"), timeLimitS * 1000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > OUTPUT_CAP) { stdout = stdout.slice(0, OUTPUT_CAP); kill("output_limit"); }
    });
    child.stderr.on("data", (d) => { if (stderr.length < 65536) stderr += d; });
    child.stdin.on("error", () => { });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ status: "crash", crash: `could not start: ${e.message}`, exitCode: null, stdout, stderr, timeMs: 0 });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const timeMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const memory = readReport(reportPath);
      const base = { exitCode: code, stdout, stderr, timeMs, memory };
      if (killedFor) return resolve({ ...base, status: killedFor });
      if (code === MEMORY_EXIT && stderr.includes("AG_MEMORY_LIMIT_EXCEEDED")) return resolve({ ...base, status: "memory_limit" });
      const crash = (signal && (CRASH_SIGNALS[signal] || `killed by ${signal}`)) || CRASH_CODES[code];
      if (crash) return resolve({ ...base, status: "crash", crash });
      resolve({ ...base, status: "ok" });
    });
    child.stdin.end(input);
  });
}

function readReport(reportPath) {
  if (!reportPath || !fs.existsSync(reportPath)) return null;
  try { return JSON.parse(fs.readFileSync(reportPath, "utf8")); }
  catch { return null; }
}

export async function toolVersions() {
  const first = (s) => (s || "").split("\n")[0].trim();
  const [gcc, cppcheck, gcov] = await Promise.all([
    exec(TOOLS.cc, ["-dumpfullversion"]),
    exec(TOOLS.cppcheck, ["--version"]),
    exec(TOOLS.gcov, ["--version"]),
  ]);
  return {
    gcc: gcc.code === 0 ? first(gcc.stdout) : null,
    cppcheck: cppcheck.code === 0 ? first(cppcheck.stdout).replace(/^Cppcheck\s*/i, "") : null,
    gcov: gcov.code === 0 ? (first(gcov.stdout).match(/(\d+\.\d+(?:\.\d+)?)\s*$/) || [])[1] || first(gcov.stdout) : null,
    node: process.versions.node,
    platform: process.platform,
  };
}
