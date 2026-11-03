
import { sameOutput, makeFailure } from "../judge.js";

export default {
  kind: "execution",

  async run(ctx, params) {
    const tests = params.tests;
    if (!Array.isArray(tests) || !tests.length) throw new Error(`params.tests must be a non-empty list of { "input", "output" }`);
    tests.forEach((t, i) => {
      if (typeof t?.input !== "string" || typeof t?.output !== "string") throw new Error(`params.tests[${i}] needs string "input" and "output"`);
    });

    const failures = [];
    let passed = 0;
    for (const [i, t] of tests.entries()) {
      const run = await ctx.runStudent(t.input);
      if (run.status === "ok" && sameOutput(t.output, run.stdout, params.compare)) { passed++; continue; }
      const label = `Test ${String(i + 1).padStart(2, "0")}`;
      failures.push(makeFailure({ label, category: "hidden_test", input: t.input, expected: t.output, run, timeLimitS: ctx.timeLimitS }));
    }

    const total = tests.length;
    ctx.log({ kind: "observe", msg: `io_tests: ${passed}/${total} hidden tests pass.` });
    const first = failures[0];
    return {
      score: passed / total,
      verdict: `${passed} of ${total} tests pass`,
      feedback: failures.length
        ? `${passed}/${total} tests pass. First failure: ${first.label} — ${first.why.split(". ")[0]}.`
        : `All ${total} hidden tests pass.`,
      evidence: { tests_passed: passed, tests_total: total, failing: failures },
      failures,
    };
  },
};
