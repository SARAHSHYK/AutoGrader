
import crypto from "node:crypto";

const PREVIEW = 240;

export function normalizeOutput(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n+$/, "");
}

const tokens = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean);

export function sameOutput(expected, got, mode = "lines") {
  if (mode === "exact") return expected === got;
  if (mode === "tokens") return tokens(expected).join(" ") === tokens(got).join(" ");
  return normalizeOutput(expected) === normalizeOutput(got);
}

export function preview(text, max = PREVIEW) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max)}… [${s.length.toLocaleString("en-US")} bytes total]`;
}

const CATEGORY_HINTS = {
  zero: "This case feeds zeros.",
  negatives: "This case feeds negative numbers.",
  int_overflow: "This case sits at the edge of the 32-bit int range (INT_MIN / INT_MAX).",
  boundaries: "This case uses the smallest and largest values the input allows.",
  empty: "This case has an empty list (n = 0).",
  single: "This case has exactly one element.",
  large: "This case uses the largest input size the problem allows.",
  whitespace: "Same kind of values as a normal case, but with extra spaces, tabs or blank lines, or no trailing newline.",
  duplicates: "Every element in this case is the same value.",
  sorted: "The list in this case is already sorted.",
  reverse: "The list in this case is in reverse order.",
};

const wrap32 = (big) => ((big + 2n ** 31n) % 2n ** 32n + 2n ** 32n) % 2n ** 32n - 2n ** 31n;
const isInt = (t) => /^[-+]?\d+$/.test(t);

export function explainMismatch({ expected, run, category, timeLimitS }) {
  const hint = CATEGORY_HINTS[category] ? ` ${CATEGORY_HINTS[category]}` : "";
  if (run.status === "timeout") {
    return `The program did not finish within ${timeLimitS}s — an infinite loop, a read that waits for input that never comes, or an algorithm too slow for this input.${hint}`;
  }
  if (run.status === "output_limit") return `The program printed more than 1 MB — almost certainly a print inside an endless loop.${hint}`;
  if (run.status === "memory_limit") return `The program allocated more heap than the memory limit allows.${hint}`;
  if (run.status === "crash") {
    const detail = {
      "access violation (invalid memory read or write)": "it read or wrote memory it doesn't own — e.g. scanf without &, an index past the end of an array, or a NULL/uninitialised pointer",
      "stack overflow": "the stack ran out — unbounded recursion or a very large local array",
      "integer divide by zero": "it divided an integer by zero",
      "illegal instruction (sanitizer trap)": "undefined behaviour was trapped (e.g. signed integer overflow)",
      "stack buffer overrun detected": "it wrote past the end of a local array",
    }[run.crash] || run.crash;
    return `The program crashed: ${detail}.${hint}`;
  }

  const exp = tokens(expected), got = tokens(run.stdout);
  if (!got.length) return `The program printed nothing; expected "${preview(normalizeOutput(expected), 60)}".${hint}`;
  if (exp.join(" ") === got.join(" ")) {
    return `The values are right but the layout differs (spacing or line breaks) — print exactly the format the problem asks for.${hint}`;
  }
  const k = exp.findIndex((t, i) => t !== got[i]);
  const at = k === -1 ? Math.min(exp.length, got.length) : k;
  const e = exp[at], g = got[at];
  if (e === undefined) return `The program printed extra output after the expected answer ("${preview(g, 40)}").${hint}`;
  if (g === undefined) return `The output stops early: token ${at + 1} ("${e}") is missing.${hint}`;
  if (isInt(e) && isInt(g)) {
    const E = BigInt(e), G = BigInt(g);
    const outside = E > 2147483647n || E < -2147483648n;
    if (outside && wrap32(E) === G) {
      return `The true answer ${e} does not fit in a 32-bit int, and the program printed ${g} — exactly the wrapped-around value. That is signed integer overflow (undefined behaviour in C). Compute in long long and print with %lld, or check the range before the operation.${hint}`;
    }
    if (E - G === 1n || G - E === 1n) return `Off by one: expected ${e}, got ${g} — check loop bounds (< vs <=) and the starting value.${hint}`;
    if (E === -G) return `Sign error: expected ${e}, got ${g}.${hint}`;
  }
  return `Output differs at value ${at + 1}: expected "${preview(e, 40)}", got "${preview(g, 40)}".${hint}`;
}

export const inputId = (input) => crypto.createHash("sha256").update(input).digest("hex").slice(0, 12);

export function makeFailure({ label, category, input, expected, run, timeLimitS }) {
  return {
    label,
    category,
    input: preview(input),
    input_bytes: Buffer.byteLength(input),
    input_id: inputId(input),
    expected: preview(normalizeOutput(expected)),
    got: run.status === "ok" ? preview(normalizeOutput(run.stdout)) : "",
    status: run.status,
    note: run.status === "ok" ? null : run.status === "crash" ? `crash: ${run.crash}` : run.status.replace("_", " "),
    why: explainMismatch({ expected, run, category, timeLimitS }),
  };
}
