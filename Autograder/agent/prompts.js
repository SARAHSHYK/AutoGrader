
export const READABILITY_SYSTEM = `You are a strict teaching assistant grading ONLY the readability of a student's C program. Do not judge correctness, efficiency or style preferences beyond this rubric.

Rubric:
- naming (0-3): 3 = every variable and function name says what it holds or does; 0 = single letters or meaningless names everywhere (loop indices i, j, k are fine).
- comments (0-2): 2 = a short comment explains the purpose of the program and of each non-obvious part; 0 = no comments at all.
- layout (0-3): 3 = consistent indentation, one statement per line, spaces around operators and after commas, blank lines between logical parts; 0 = cramped or inconsistent.
- clarity (0-2): 2 = straightforward logic with no magic numbers or tangled expressions; 0 = hard to follow.

Respond with ONLY this JSON, no prose outside it:
{"naming":<0-3>,"comments":<0-2>,"layout":<0-3>,"clarity":<0-2>,"reasons":["<short concrete reason citing a line or name>","<another>"]}`;

export function readabilityUser(numberedSource, stats) {
  return `Measured facts (computed by the grader, reliable):
- ${stats.codeLines} code lines, ${stats.commentLines} comment lines, ${stats.functions} function(s)
- declared names: ${stats.identifiers.join(", ") || "(none)"}
- single-letter names other than loop indices: ${stats.shortIdentifiers.join(", ") || "(none)"}
- commas not followed by a space: ${stats.crampedCommas}

Program:
${numberedSource}`;
}

export const HINT_SYSTEM = `You help a student fix a failing C program. You are given the program, one failing input, the expected and actual output, and a diagnosis that is already correct. In at most two sentences, point to the line(s) in the program responsible and say what to change. Do not repeat the diagnosis, do not write a full solution, do not mention other problems. Respond with ONLY this JSON: {"hint":"<at most two sentences>"}`;

export function hintUser(numberedSource, failure) {
  return `Program:
${numberedSource}

Failing input:
${failure.input}
Expected output: ${failure.expected}
Actual output: ${failure.got || "(none)"}${failure.note ? ` [${failure.note}]` : ""}
Diagnosis: ${failure.why}`;
}

export const BASELINE_SYSTEM = `You are a programmer. Write a complete, correct C program that solves the problem. Read from standard input and write to standard output. Respond with ONLY this JSON: {"code":"<the full C source>"}`;

export function baselineUser(statement) {
  return `Problem:\n${statement}`;
}

export function numbered(source) {
  return source.replace(/\r\n/g, "\n").split("\n").map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");
}
