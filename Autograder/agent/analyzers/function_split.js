
import { findFunctions } from "../cparse.js";

export default {
  kind: "source",

  async run(ctx, params) {
    const minFunctions = Math.max(1, params.min_functions ?? 2);
    const fns = findFunctions(ctx.source);
    const byName = new Map(fns.map((f) => [f.name, f]));

    const used = new Set();
    const stack = byName.has("main") ? ["main"] : [];
    while (stack.length) {
      const name = stack.pop();
      if (used.has(name)) continue;
      used.add(name);
      for (const callee of byName.get(name)?.calls || []) if (byName.has(callee)) stack.push(callee);
    }
    const unused = fns.filter((f) => !used.has(f.name)).map((f) => f.name);
    const helpers = [...used].filter((n) => n !== "main");

    const ratio = minFunctions === 1 ? 1 : Math.min(1, Math.max(0, used.size - 1) / (minFunctions - 1));
    const score = used.size ? 0.3 + 0.7 * ratio : 0;
    const main = byName.get("main");

    ctx.log({ kind: "observe", msg: `function_split: ${fns.length} function(s) defined, ${used.size} reachable from main (expected ≥ ${minFunctions}).` });
    return {
      score,
      verdict: !main ? "no main() found" : helpers.length ? `${used.size} functions in use` : "only main() defined",
      feedback: !main
        ? "No main() function was found."
        : used.size >= minFunctions
          ? `main() delegates to ${helpers.join(", ")}.`
          : `Only ${used.size} function(s) in use (expected at least ${minFunctions}); main() is ${main.nloc} lines and does all the work.${unused.length ? ` Defined but never called: ${unused.join(", ")}.` : ""}`,
      evidence: { functions_defined: fns.length, functions_used: used.size, expected_min: minFunctions, helpers, unused },
      suggestions: used.size < minFunctions && params.expect_helpers !== false
        ? ["Move the core computation out of main() into its own function (for example one that takes the inputs and returns the result), and call it from main()."]
        : [],
    };
  },
};
