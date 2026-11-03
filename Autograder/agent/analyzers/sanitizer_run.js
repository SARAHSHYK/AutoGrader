
import path from "node:path";
import { compile, run } from "../sandbox.js";
import { hiddenTests } from "../rules.js";
import { generateCases } from "../inputs.js";
import { preview, inputId } from "../judge.js";

const UB_CHECKS = [
  "signed-integer-overflow", "integer-divide-by-zero", "shift", "bounds", "null",
  "vla-bound", "float-cast-overflow", "pointer-overflow", "alignment", "return", "unreachable",
];
const UB_TEXT = {
  "signed-integer-overflow": "signed integer overflow",
  "integer-divide-by-zero": "integer division by zero",
  shift: "invalid shift (negative or too large shift amount)",
  bounds: "array index out of bounds",
  null: "NULL pointer dereference",
  "vla-bound": "variable-length array with non-positive size",
  "float-cast-overflow": "float-to-int conversion overflow",
  "pointer-overflow": "pointer arithmetic overflow",
  alignment: "misaligned memory access",
  return: "function reached its end without returning a value",
  unreachable: "reached __builtin_unreachable()",
};
const SAFE_CASES = ["zero", "negatives", "int_overflow", "boundaries", "empty", "single", "whitespace"];

export default {
  kind: "execution",

  async run(ctx, params) {
    const flags = String(params.flags || "-fsanitize=address,undefined").split(/\s+/).filter(Boolean);
    const penalty = params.penalty_per_issue ?? 0.25;
    const inputs = collectInputs(ctx);

    const native = process.platform !== "win32"
      && (await compile(ctx.workDir, { out: "san_native", flags: ["-O1", "-g", "-fno-omit-frame-pointer", "-std=c11", ...flags], shim: true })).ok;
    const mode = native ? "native" : "portable";
    const exe = native ? path.join(ctx.workDir, "san_native") : await buildPortable(ctx);
    ctx.log({ kind: "tool", msg: `sanitizer_run: ${mode} mode (${native ? `${flags.join(" ")} + allocation shim` : "UBSan trap + stack protector + allocation shim"}), ${inputs.length} inputs.` });

    const issues = new Map();
    const byInput = {};
    const note = (key, text, input, extra = {}) => {
      byInput[inputId(input)] ||= text;
      if (!issues.has(key)) issues.set(key, { kind: key, message: text, input: preview(input, 120), ...extra });
    };
    const ubBuilds = new Map();
    const reportPath = path.join(ctx.workDir, "san_report.json");

    for (const { label, input } of inputs) {
      const r = await run(exe, { input, timeLimitS: ctx.timeLimitS * 3, memoryLimitMb: ctx.memoryLimitMb, cwd: ctx.workDir, reportPath, env: native ? SANITIZER_ENV : {} });

      if (native) {
        const found = parseNative(r.stderr);
        for (const f of found) note(f.kind, f.message, input, { on: label });
        if (!found.length && r.status === "crash") note(`crash:${r.crash}`, r.crash, input, { on: label });
      } else if (r.status === "crash" && r.crash.startsWith("illegal instruction")) {
        const check = await identifyTrap(ctx, input, ubBuilds);
        note(`ubsan:${check || "unknown"}`, `undefined behaviour: ${check ? UB_TEXT[check] : "trapped by UBSan"}`, input, { on: label });
      } else if (r.status === "crash") {
        note(`crash:${r.crash}`, r.crash, input, { on: label });
      }
      if (r.status === "memory_limit") note("memory_limit", `heap use exceeded ${ctx.memoryLimitMb} MB`, input, { on: label });
      if (r.status === "timeout") note("timeout", `did not finish within ${ctx.timeLimitS * 3}s with the checks compiled in`, input, { on: label });

      const mem = r.memory;
      if (mem?.exit === "normal" && mem.live_bytes > 0) {
        const sites = mem.leaks.map((l) => `line ${l.line}: ${l.bytes} byte(s) in ${l.blocks} block(s)`).join("; ");
        note("leak", `memory leak: ${mem.live_bytes} byte(s) never freed (${sites})`, input, { on: label, leaks: mem.leaks });
      }
      if (mem?.double_free_lines?.length) note("double_free", `double free at line ${mem.double_free_lines.join(", ")}`, input, { on: label });
    }

    const list = [...issues.values()];
    ctx.log({ kind: "observe", msg: `sanitizer_run: ${list.length ? list.map((i) => i.kind).join(", ") : "no diagnostics"}.` });
    return {
      score: Math.max(0, 1 - penalty * list.length),
      verdict: list.length ? list.map((i) => shortLabel(i.kind)).join(", ") : `${native ? "ASan/UBSan/leak checks" : "UBSan/stack/heap checks"} clean`,
      feedback: list.length
        ? `${list.map((i) => `${i.message} (input: ${JSON.stringify(i.input.trim().slice(0, 40))})`).join("; ")}.`
        : `No undefined behaviour, invalid memory access or leaks on ${inputs.length} inputs.`,
      evidence: { mode, flags: native ? `${flags.join(" ")} + allocation shim` : "-fsanitize=undefined -fsanitize-undefined-trap-on-error -fstack-protector-all + allocation shim", inputs_run: inputs.length, issues: list },
      suggestions: list.map(suggestionFor).filter(Boolean),
      diagnostics_by_input: byInput,
    };
  },
};

const SANITIZER_ENV = {
  ASAN_OPTIONS: "detect_leaks=0:abort_on_error=0:symbolize=1:allocator_may_return_null=1",
  UBSAN_OPTIONS: "print_stacktrace=0:halt_on_error=0",
};

const UBSAN_KINDS = [
  [/signed integer overflow|negation of .* cannot be represented/, "ubsan:signed-integer-overflow"],
  [/division by zero/, "ubsan:integer-divide-by-zero"],
  [/shift exponent|left shift of/, "ubsan:shift"],
  [/index .* out of bounds/, "ubsan:bounds"],
  [/insufficient space for an object/, "asan:buffer-overflow"],
  [/null pointer/, "ubsan:null"],
  [/misaligned address/, "ubsan:alignment"],
  [/variable length array bound/, "ubsan:vla-bound"],
  [/is outside the range of representable values/, "ubsan:float-cast-overflow"],
  [/pointer index expression/, "ubsan:pointer-overflow"],
];

function parseNative(stderr) {
  const out = [];
  const lineIn = (text) => (text.match(/prog\.c:(\d+)/) || [])[1];
  const noAddresses = (s) => s.replace(/0x[0-9a-f]+/gi, "<address>");

  const asan = stderr.match(/ERROR: AddressSanitizer: ([\w-]+)([^\n]*)\n([\s\S]*?)(?:\n\n|$)/);
  if (asan) {
    const [, type, rest, frames] = asan;
    const line = lineIn(frames);
    const at = line ? ` at line ${line}` : "";
    if (type === "SEGV") {
      const nullPage = /zero page|address 0x0{6,}\b/.test(stderr);
      out.push({ kind: nullPage ? "ubsan:null" : "crash:access violation (invalid memory read or write)", message: `${nullPage ? "NULL pointer dereference" : "invalid memory access (segmentation fault)"}${at}` });
    } else if (type === "double-free") {
      out.push({ kind: "double_free", message: `double free${at}` });
    } else if (type === "stack-overflow") {
      out.push({ kind: "crash:stack overflow", message: `stack overflow${at} (unbounded recursion or a huge local array)` });
    } else if (/buffer-overflow/.test(type)) {
      out.push({ kind: "asan:buffer-overflow", message: `${type.replace(/-/g, " ")}${at}: read or write past the end of an array` });
    } else if (/use-after-free/.test(type)) {
      out.push({ kind: "asan:use-after-free", message: `use of memory after free()${at}` });
    } else {
      out.push({ kind: `asan:${type}`, message: noAddresses(`AddressSanitizer: ${type}${rest.trim() ? ` ${rest.trim()}` : ""}${at}`) });
    }
  }

  for (const m of stderr.matchAll(/prog\.c:(\d+):\d+: runtime error: ([^\n]+)/g)) {
    const kind = UBSAN_KINDS.find(([re]) => re.test(m[2]))?.[1] || "ubsan:other";
    out.push({ kind, message: `undefined behaviour at line ${m[1]}: ${noAddresses(m[2].trim())}` });
  }
  return out;
}

function collectInputs(ctx) {
  const out = hiddenTests(ctx.rules).map((t, i) => ({ label: `test ${String(i + 1).padStart(2, "0")}`, input: t.input }));
  if (ctx.rules.input_spec) {
    for (const c of generateCases(ctx.rules.input_spec, SAFE_CASES, ctx.seed).cases) out.push({ label: c.label, input: c.input });
  }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.input) ? false : seen.add(x.input)));
}

async function buildPortable(ctx) {
  const res = await compile(ctx.workDir, {
    out: "san_portable.exe",
    flags: ["-O1", "-std=c11", "-fsanitize=undefined", "-fsanitize-undefined-trap-on-error", "-fstack-protector-all"],
    shim: true,
  });
  if (!res.ok) throw new Error(`sanitizer build failed: ${res.stderr.slice(0, 200)}`);
  return path.join(ctx.workDir, "san_portable.exe");
}

async function identifyTrap(ctx, input, builds) {
  for (const check of UB_CHECKS) {
    if (!builds.has(check)) {
      const out = `ub_${check}.exe`;
      const res = await compile(ctx.workDir, { out, flags: ["-O1", "-std=c11", `-fsanitize=${check}`, "-fsanitize-undefined-trap-on-error"], shim: true });
      builds.set(check, res.ok ? path.join(ctx.workDir, out) : null);
    }
    const exe = builds.get(check);
    if (!exe) continue;
    const r = await run(exe, { input, timeLimitS: ctx.timeLimitS * 3, memoryLimitMb: ctx.memoryLimitMb, cwd: ctx.workDir });
    if (r.status === "crash" && r.crash.startsWith("illegal instruction")) return check;
  }
  return null;
}

function shortLabel(kind) {
  if (kind.startsWith("ubsan:")) return UB_TEXT[kind.slice(6)] || "undefined behaviour";
  if (kind.startsWith("crash:")) return kind.slice(6).split(" (")[0];
  return { leak: "memory leak", double_free: "double free", memory_limit: "memory limit", timeout: "timeout",
    "asan:buffer-overflow": "buffer overflow", "asan:use-after-free": "use after free" }[kind] || kind.replace(/^asan:/, "");
}

function suggestionFor(issue) {
  if (issue.kind === "leak") {
    const lines = (issue.leaks || []).map((l) => l.line).join(", ");
    return `Free every block you allocate${lines ? ` (allocated at line ${lines})` : ""} before the program ends.`;
  }
  if (issue.kind === "double_free") return "Free each block exactly once; set the pointer to NULL after free().";
  if (issue.kind === "ubsan:signed-integer-overflow") return "Signed overflow is undefined behaviour: compute in a wider type (long long) or check the range before the operation.";
  if (issue.kind === "ubsan:bounds" || issue.kind === "asan:buffer-overflow" || issue.kind.startsWith("crash:access")) return "Check every array index and pointer before use — the program touched memory outside what it owns.";
  if (issue.kind === "ubsan:null") return "Make sure every pointer points to real memory (malloc it or point it at a variable) before reading or writing through it.";
  if (issue.kind === "asan:use-after-free") return "Don't use a block after free(); free it only when you are completely done with it.";
  if (issue.kind === "ubsan:integer-divide-by-zero" || issue.kind.startsWith("crash:integer divide")) return "Guard divisions and modulo against a zero divisor.";
  if (issue.kind.startsWith("crash:stack overflow")) return "Avoid unbounded recursion and very large local arrays (allocate them with malloc).";
  return null;
}
