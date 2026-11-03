
export const USEFULNESS = [
  {
    use_case: "Weekly lab grading in a large course",
    example: "A course with 300 students submits the 'add two integers' lab. The instructor uploads the rules once and each student's .c file; every student gets a grade and, when their program is wrong, the exact input that breaks it (e.g. 2147483647 1) with the expected output beside what they printed.",
    benefit: "Hours of manual running and checking become one unattended click, and every student is judged by identical tests and thresholds.",
  },
  {
    use_case: "Coding-interview and hiring screens",
    example: "A company runs 500 candidate submissions for an 'add two integers safely' task. The agent ranks them by correctness, edge-case handling and memory safety, and gives a per-metric score for each.",
    benefit: "Fast first-round filtering where every rejection can be justified metric by metric.",
  },
  {
    use_case: "Plagiarism and LLM-copy triage for instructors",
    example: "A submission reaches similarity 0.93 with a solution collected from a tutorial site (threshold 0.85), so the agent flags it. The instructor reviews only the flagged pairs instead of all 300 submissions.",
    benefit: "Saves review time by narrowing manual checking to suspicious cases; the human still makes the call.",
  },
  {
    use_case: "Changing the grading policy without touching code, with an audit trail",
    example: "Mid-semester the instructor raises memory_safety from 10% to 20% and adds 'whitespace' to the edge cases by editing rules/add.json, then regrades the whole class. Every report carries the rules_hash, so any grade can be traced to the exact rules and tests that produced it.",
    benefit: "Policy changes are a JSON edit, regrades are reproducible, and grade disputes can be settled by re-running.",
  },
];

export const LIMITATIONS = [
  {
    limitation: "Tests and generated cases cannot prove correctness",
    example: "A submission contains `if (a == 1000000) return 0;` — a bug that fires only for that one value. No hidden test uses it, and the generated 'typical' values stay within ±1000, so the agent reports 10/10 tests and 100% of corner cases for a program that is wrong.",
    mitigation: "Add the problem's real input bounds to input_spec so random values cover the full range, and raise random_trials; a proof of correctness is still out of reach.",
  },
  {
    limitation: "Complexity is estimated from a few sizes, so close classes blur",
    example: "A merge-sort submission does n·log n work, but with sizes [500, 1000, 2000, 4000] a straight line fits its operation counts within the 0.001 R² tie margin, so the agent reports O(n) — better than the truth. Conversely, an algorithm that only turns quadratic above n = 10,000 is reported O(n) if no size reaches that point.",
    mitigation: "Use sizes that span several orders of magnitude and include the largest n the problem allows.",
  },
  {
    limitation: "Reads of uninitialised variables are not detected",
    example: "`int sum; for (i = 0; i < n; i++) sum += a[i];` never sets sum to 0. AddressSanitizer, UBSan and LeakSanitizer do not track uninitialised memory, so if the leftover value happens to be 0 on the grading machine, every test passes and memory_safety reports 10/10 for a program that is wrong on another machine.",
    mitigation: "gcc's -Wmaybe-uninitialized (syntax metric) and cppcheck (structure metric) often catch it; for certainty add a valgrind --track-origins run or clang's MemorySanitizer.",
  },
  {
    limitation: "Similarity is a signal, not evidence — it misfires both ways",
    example: "False positive: for a three-line problem like adding two integers, two honest students who both write the textbook scanf/printf version can exceed 0.85 and get flagged. False negative: a student who copies a solution but turns the loop into recursion and splits it across helper functions drops below the threshold and is not flagged.",
    mitigation: "Keep a human in the loop for every flag, include the reference and common boilerplate as base code, and tune flag_threshold per problem size.",
  },
];
