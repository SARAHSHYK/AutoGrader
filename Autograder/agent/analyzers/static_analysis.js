
import { exec, TOOLS } from "../sandbox.js";
import { findFunctions } from "../cparse.js";

const DEFAULT_PENALTIES = { cyclomatic: 0.2, length: 0.2, error: 0.2, warning: 0.1, style: 0.05, performance: 0.05, portability: 0.05 };
const IGNORED_IDS = new Set(["missingIncludeSystem", "missingInclude", "checkersReport", "normalCheckLevelMaxBranches", "unmatchedSuppression", "toomanyconfigs"]);

export default {
  kind: "source",

  async run(ctx, params) {
    const maxCyclo = params.max_cyclomatic ?? 10;
    const maxLen = params.max_function_length ?? 50;
    const pen = { ...DEFAULT_PENALTIES, ...(params.penalties || {}) };

    const functions = findFunctions(ctx.source).map((f) => ({ name: f.name, line: f.startLine, nloc: f.nloc, cyclomatic: f.cyclomatic }));
    const tooComplex = functions.filter((f) => f.cyclomatic > maxCyclo);
    const tooLong = functions.filter((f) => f.nloc > maxLen);

    const cpp = await runCppcheck(ctx.workDir);
    ctx.log({
      kind: "observe",
      msg: `static_analysis: ${functions.length} function(s); cppcheck ${cpp.available ? `${cpp.issues.length} issue(s)` : "not installed"}; ${tooComplex.length} over cyclomatic ${maxCyclo}, ${tooLong.length} over ${maxLen} lines.`,
    });

    let deduction = tooComplex.length * pen.cyclomatic + tooLong.length * pen.length;
    for (const i of cpp.issues) deduction += pen[i.severity] ?? 0.05;
    const score = functions.length ? Math.max(0, 1 - deduction) : 0;

    const findings = [
      ...tooComplex.map((f) => `${f.name}() has cyclomatic complexity ${f.cyclomatic} (max ${maxCyclo})`),
      ...tooLong.map((f) => `${f.name}() is ${f.nloc} lines long (max ${maxLen})`),
      ...cpp.issues.map((i) => `line ${i.line}: ${i.message} [cppcheck ${i.severity}/${i.id}]`),
    ];
    return {
      score,
      verdict: !functions.length ? "no functions found" : findings.length ? `${findings.length} structural issue(s)` : "within all thresholds",
      feedback: findings.length ? `${findings.slice(0, 3).join("; ")}.` : `Every function is within cyclomatic ${maxCyclo} and ${maxLen} lines; cppcheck reports nothing.`,
      evidence: {
        thresholds: { max_cyclomatic: maxCyclo, max_function_length: maxLen },
        functions,
        cppcheck: cpp.available ? cpp.issues : "not installed",
      },
      suggestions: [
        ...tooComplex.map((f) => `Split ${f.name}() (complexity ${f.cyclomatic}) into smaller functions, each with one job.`),
        ...tooLong.map((f) => `Shorten ${f.name}() (${f.nloc} lines) by moving steps into helper functions.`),
        ...cpp.issues.slice(0, 3).map((i) => `Line ${i.line}: ${i.message}.`),
      ],
    };
  },
};

async function runCppcheck(workDir) {
  const res = await exec(TOOLS.cppcheck, [
    "--enable=warning,style,performance,portability", "--std=c11", "--quiet", "--inline-suppr",
    "--template={line}|{severity}|{id}|{message}", "prog.c",
  ], { cwd: workDir });
  if (res.missing) return { available: false, issues: [] };
  const issues = res.stderr.split(/\r?\n/).map((l) => l.split("|")).filter((p) => p.length >= 4 && /^\d+$/.test(p[0]))
    .map(([line, severity, id, ...msg]) => ({ line: Number(line), severity, id, message: msg.join("|") }))
    .filter((i) => i.severity !== "information" && !IGNORED_IDS.has(i.id));
  return { available: true, issues };
}
