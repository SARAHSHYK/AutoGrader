
import { CATEGORIES, generateCases, randomCases } from "../inputs.js";
import { sameOutput, makeFailure } from "../judge.js";

export default {
  kind: "execution",
  requires: ["reference", "input_spec"],

  async run(ctx, params) {
    const wanted = params.cases || ["zero", "negatives", "int_overflow"];
    const { cases, notApplicable } = generateCases(ctx.rules.input_spec, wanted, ctx.seed);

    const perCategory = {};
    const failures = [];
    let passed = 0, judged = 0;
    for (const c of cases) {
      const verdict = await judge(ctx, c, params.compare);
      if (!verdict) continue;
      judged++;
      const pc = (perCategory[c.category] ||= { passed: 0, total: 0 });
      pc.total++;
      if (verdict.ok) { passed++; pc.passed++; } else failures.push(verdict.failure);
    }
    ctx.log({ kind: "observe", msg: `edge_case_runner: ${passed}/${judged} graded corner cases pass (${wanted.join(", ")}).` });

    const others = CATEGORIES.filter((c) => !wanted.includes(c));
    const extra = [
      ...generateCases(ctx.rules.input_spec, others, ctx.seed).cases,
      ...randomCases(ctx.rules.input_spec, params.random_trials ?? 40, ctx.seed),
    ];
    const counter = [];
    for (const c of extra) {
      const verdict = await judge(ctx, c, params.compare);
      if (verdict && !verdict.ok) counter.push({ ...verdict.failure, category: c.category });
    }
    const seen = new Set();
    const counterTests = counter
      .sort((a, b) => a.input_bytes - b.input_bytes || a.label.localeCompare(b.label))
      .filter((f) => (seen.has(f.category) ? false : seen.add(f.category)))
      .slice(0, params.max_reported ?? 5)
      .map((f) => ({ ...f, label: `Counter-test: ${f.label.replace(/^Edge /, "")}` }));
    ctx.log({ kind: "observe", msg: `counter-test search: ${extra.length} extra inputs tried, ${counter.length} disagree with the reference.` });

    const failedCats = Object.entries(perCategory).filter(([, v]) => v.passed < v.total).map(([k]) => k);
    return {
      score: judged ? passed / judged : 1,
      verdict: failedCats.length ? `fails on ${failedCats.join(", ")}` : `all ${judged} corner cases pass`,
      feedback: (failedCats.length
        ? `${passed}/${judged} corner cases pass; failing categories: ${failedCats.join(", ")}.`
        : `All ${judged} graded corner cases pass.`)
        + (counter.length ? ` The counter-test search found ${counter.length} more failing input(s) outside the graded categories (reported, not scored).` : "")
        + (notApplicable.length ? ` Not applicable to this input format: ${notApplicable.join(", ")}.` : ""),
      evidence: {
        cases_passed: passed, cases_total: judged, per_category: perCategory,
        not_applicable: notApplicable, failing: failures,
        counter_search: { inputs_tried: extra.length, failing: counter.length, reported: counterTests },
      },
      failures: [...failures, ...counterTests],
    };
  },
};

async function judge(ctx, c, compare) {
  const ref = await ctx.runReference(c.input);
  if (ref.status !== "ok") return null;
  const got = await ctx.runStudent(c.input);
  if (got.status === "ok" && sameOutput(ref.stdout, got.stdout, compare)) return { ok: true };
  return {
    ok: false,
    failure: makeFailure({ label: `Edge ${c.label}`, category: c.category, input: c.input, expected: ref.stdout, run: got, timeLimitS: ctx.timeLimitS }),
  };
}
