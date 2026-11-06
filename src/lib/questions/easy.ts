import type { Question } from "../types";

export const EASY: Question[] = [
  {
    id: "shelf-capacity",
    title: "Shelf capacity",
    prompt: `A warehouse shelf holds a fixed total weight. You are handed a pile of boxes and you may load them in any order you like.

Return the **largest number of boxes** you can put on the shelf without exceeding its capacity.

\`\`\`
max_boxes([4, 1, 3, 2], 6)  ->  3      # 1 + 2 + 3
max_boxes([5, 5, 5], 4)     ->  0
\`\`\`

Constraints: weights are positive integers, capacity is a non-negative integer, up to 10,000 boxes.`,
    difficulty: "easy",
    jobLevels: ["intern", "entry"],
    roles: ["general", "backend"],
    topics: ["greedy", "sorting"],
    functionName: "max_boxes",
    starter: {
      python: `def max_boxes(weights, capacity):\n    """Return the largest number of boxes that fit within capacity."""\n    pass\n`,
      javascript: `function max_boxes(weights, capacity) {\n  // Return the largest number of boxes that fit within capacity.\n}\n`,
    },
    reference: {
      python: `def max_boxes(weights, capacity):\n    total = 0\n    count = 0\n    for w in sorted(weights):\n        if total + w > capacity:\n            break\n        total += w\n        count += 1\n    return count\n`,
      javascript: `function max_boxes(weights, capacity) {\n  const sorted = [...weights].sort((a, b) => a - b);\n  let total = 0, count = 0;\n  for (const w of sorted) {\n    if (total + w > capacity) break;\n    total += w;\n    count += 1;\n  }\n  return count;\n}\n`,
    },
    tests: [
      { name: "example", args: [[4, 1, 3, 2], 6], expected: 3 },
      { name: "nothing fits", args: [[5, 5, 5], 4], expected: 0 },
      { name: "empty pile", args: [[], 10], expected: 0 },
      { name: "exact fit", args: [[2, 3, 5], 10], expected: 3 },
      { name: "single box", args: [[7], 7], expected: 1 },
      { name: "zero capacity", args: [[1, 2], 0], expected: 0, hidden: true },
      { name: "duplicates", args: [[3, 3, 3, 3], 9], expected: 3, hidden: true },
      { name: "large", args: [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 50], 8], expected: 8, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "Does the order you load the boxes in change how many fit?",
      "If two loadings use the same total weight, which one gives you more boxes?",
      "You want the lightest boxes first. What does that suggest doing to the list before you loop?",
      "Sort ascending, then accumulate while the running total stays within capacity.",
    ],
    followUps: [
      "What is the time complexity, and what dominates it?",
      "What changes if boxes have both a weight and a value and you want maximum value?",
    ],
    optimal: { time: "O(n log n)", space: "O(n)" },
    source: "bank",
  },
  {
    id: "log-dedupe",
    title: "Deduplicate an event stream",
    prompt: `A logging pipeline emits event names with inconsistent casing. Return the event names with duplicates removed, **preserving the order of first appearance** and keeping the casing of that first appearance. Two names are duplicates if they match ignoring case.

\`\`\`
dedupe_events(["Login", "login", "Retry", "LOGIN", "retry"])
  ->  ["Login", "Retry"]
\`\`\``,
    difficulty: "easy",
    jobLevels: ["intern", "entry"],
    roles: ["general", "backend", "infra"],
    topics: ["hash set", "strings"],
    functionName: "dedupe_events",
    starter: {
      python: `def dedupe_events(events):\n    """Return events without case-insensitive duplicates, first-seen order."""\n    pass\n`,
      javascript: `function dedupe_events(events) {\n  // Return events without case-insensitive duplicates, first-seen order.\n}\n`,
    },
    reference: {
      python: `def dedupe_events(events):\n    seen = set()\n    out = []\n    for e in events:\n        key = e.lower()\n        if key not in seen:\n            seen.add(key)\n            out.append(e)\n    return out\n`,
      javascript: `function dedupe_events(events) {\n  const seen = new Set();\n  const out = [];\n  for (const e of events) {\n    const key = e.toLowerCase();\n    if (!seen.has(key)) { seen.add(key); out.push(e); }\n  }\n  return out;\n}\n`,
    },
    tests: [
      { name: "example", args: [["Login", "login", "Retry", "LOGIN", "retry"]], expected: ["Login", "Retry"] },
      { name: "empty", args: [[]], expected: [] },
      { name: "all unique", args: [["a", "b", "c"]], expected: ["a", "b", "c"] },
      { name: "all same", args: [["X", "x", "X"]], expected: ["X"] },
      { name: "keeps first casing", args: [["ERROR", "error"]], expected: ["ERROR"] },
      { name: "empty string", args: [["", "", "a"]], expected: ["", "a"], hidden: true },
      { name: "mixed separators", args: [["a_b", "A_B", "ab"]], expected: ["a_b", "ab"], hidden: true },
      { name: "long stream", args: [["p", "q", "P", "r", "Q", "s", "R", "t"]], expected: ["p", "q", "r", "s", "t"], hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What exactly makes two events 'the same' here?",
      "You need to remember what you have already emitted. What structure gives you O(1) membership checks?",
      "The thing you store for comparison does not have to be the thing you output.",
      "Keep a set of lowercased names seen so far; append the original string the first time its lowercase form is new.",
    ],
    followUps: [
      "How would you handle a stream too large to hold in memory?",
      "What if 'duplicate' also had to ignore surrounding whitespace and underscores?",
    ],
    optimal: { time: "O(n)", space: "O(n)" },
    source: "bank",
  },
  {
    id: "balanced-delimiters",
    title: "Balanced delimiters",
    prompt: `A config format uses three kinds of delimiters: \`()\`, \`[]\`, and \`{}\`. Return \`True\` if every opener is closed by the matching closer in the right order, and \`False\` otherwise. Characters other than these six are ignored.

\`\`\`
is_balanced("a(b[c]{d})")  ->  True
is_balanced("([)]")        ->  False
is_balanced("(((")         ->  False
\`\`\``,
    difficulty: "easy",
    jobLevels: ["intern", "entry", "mid"],
    roles: ["general", "backend"],
    topics: ["stack", "strings"],
    functionName: "is_balanced",
    starter: {
      python: `def is_balanced(text):\n    """Return True if (), [] and {} are correctly nested."""\n    pass\n`,
      javascript: `function is_balanced(text) {\n  // Return true if (), [] and {} are correctly nested.\n}\n`,
    },
    reference: {
      python: `def is_balanced(text):\n    pairs = {")": "(", "]": "[", "}": "{"}\n    stack = []\n    for ch in text:\n        if ch in "([{":\n            stack.append(ch)\n        elif ch in pairs:\n            if not stack or stack.pop() != pairs[ch]:\n                return False\n    return len(stack) == 0\n`,
      javascript: `function is_balanced(text) {\n  const pairs = { ")": "(", "]": "[", "}": "{" };\n  const stack = [];\n  for (const ch of text) {\n    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);\n    else if (ch in pairs) {\n      if (stack.pop() !== pairs[ch]) return false;\n    }\n  }\n  return stack.length === 0;\n}\n`,
    },
    tests: [
      { name: "nested with noise", args: ["a(b[c]{d})"], expected: true },
      { name: "interleaved", args: ["([)]"], expected: false },
      { name: "unclosed", args: ["((("], expected: false },
      { name: "empty", args: [""], expected: true },
      { name: "no delimiters", args: ["hello world"], expected: true },
      { name: "closer first", args: [")("], expected: false, hidden: true },
      { name: "deep nesting", args: ["{[()()]}"], expected: true, hidden: true },
      { name: "trailing closer", args: ["()]"], expected: false, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What has to be true about the most recent unclosed opener when you meet a closer?",
      "You only ever care about the innermost open delimiter. What structure gives you that?",
      "A stack. Push openers; on a closer, pop and check the match.",
      "Do not forget the end condition: leftover openers on the stack mean unbalanced.",
    ],
    followUps: [
      "What if quoted strings could contain unbalanced delimiters that should be ignored?",
      "How would you report the index of the first offending character?",
    ],
    optimal: { time: "O(n)", space: "O(n)" },
    source: "bank",
  },
  {
    id: "largest-swing",
    title: "Largest upward swing",
    prompt: `You are given temperature readings in chronological order. Find the largest increase from an earlier reading to a later one.

Return \`0\` if the readings never increase.

\`\`\`
largest_swing([7, 1, 5, 3, 6, 4])  ->  5      # 1 -> 6
largest_swing([9, 7, 4])           ->  0
\`\`\``,
    difficulty: "easy",
    jobLevels: ["intern", "entry", "mid"],
    roles: ["general", "data"],
    topics: ["single pass", "running minimum"],
    functionName: "largest_swing",
    starter: {
      python: `def largest_swing(readings):\n    """Largest later-minus-earlier increase, or 0 if none."""\n    pass\n`,
      javascript: `function largest_swing(readings) {\n  // Largest later-minus-earlier increase, or 0 if none.\n}\n`,
    },
    reference: {
      python: `def largest_swing(readings):\n    best = 0\n    lowest = None\n    for r in readings:\n        if lowest is None or r < lowest:\n            lowest = r\n        elif r - lowest > best:\n            best = r - lowest\n    return best\n`,
      javascript: `function largest_swing(readings) {\n  let best = 0;\n  let lowest = null;\n  for (const r of readings) {\n    if (lowest === null || r < lowest) lowest = r;\n    else if (r - lowest > best) best = r - lowest;\n  }\n  return best;\n}\n`,
    },
    tests: [
      { name: "example", args: [[7, 1, 5, 3, 6, 4]], expected: 5 },
      { name: "monotonic decrease", args: [[9, 7, 4]], expected: 0 },
      { name: "empty", args: [[]], expected: 0 },
      { name: "single", args: [[3]], expected: 0 },
      { name: "flat", args: [[2, 2, 2]], expected: 0 },
      { name: "negatives", args: [[-5, -2, -9, -1]], expected: 8, hidden: true },
      { name: "peak then bigger swing", args: [[3, 10, 1, 20]], expected: 19, hidden: true },
      { name: "increase at the end", args: [[5, 4, 3, 2, 1, 100]], expected: 99, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "Can the later reading in the best pair come before the earlier one? What does that rule out?",
      "Walking left to right, what is the only thing about the past you need to remember?",
      "Track the smallest value seen so far and the best difference so far.",
      "One pass: update the running minimum, otherwise update the best difference against it.",
    ],
    followUps: [
      "What is the complexity, and why can you not do better than linear?",
      "What if you could take two non-overlapping swings and wanted the best combined total?",
    ],
    optimal: { time: "O(n)", space: "O(1)" },
    source: "bank",
  },
  {
    id: "roster-gap",
    title: "The missing seat",
    prompt: `A conference assigns seat numbers \`1\` through \`n\`. You are handed the list of seats that were claimed — every seat except exactly one, in arbitrary order. The list has \`n - 1\` entries.

Return the seat number nobody claimed.

\`\`\`
missing_seat([3, 1, 4, 5])  ->  2      # n is 5
missing_seat([1])           ->  2      # n is 2
\`\`\``,
    difficulty: "easy",
    jobLevels: ["intern", "entry"],
    roles: ["general"],
    topics: ["math", "arithmetic series"],
    functionName: "missing_seat",
    starter: {
      python: `def missing_seat(claimed):\n    """Return the one seat in 1..n that is not in claimed (len(claimed) == n - 1)."""\n    pass\n`,
      javascript: `function missing_seat(claimed) {\n  // Return the one seat in 1..n that is not in claimed (claimed.length === n - 1).\n}\n`,
    },
    reference: {
      python: `def missing_seat(claimed):\n    n = len(claimed) + 1\n    return n * (n + 1) // 2 - sum(claimed)\n`,
      javascript: `function missing_seat(claimed) {\n  const n = claimed.length + 1;\n  let total = (n * (n + 1)) / 2;\n  for (const c of claimed) total -= c;\n  return total;\n}\n`,
    },
    tests: [
      { name: "example", args: [[3, 1, 4, 5]], expected: 2 },
      { name: "two seats", args: [[1]], expected: 2 },
      { name: "missing first", args: [[2, 3]], expected: 1 },
      { name: "missing last", args: [[1, 2, 3]], expected: 4 },
      { name: "only seat", args: [[]], expected: 1 },
      { name: "shuffled", args: [[5, 2, 6, 1, 3]], expected: 4, hidden: true },
      { name: "larger", args: [[1, 2, 3, 4, 5, 6, 7, 9, 10]], expected: 8, hidden: true },
      { name: "missing middle of ten", args: [[10, 9, 8, 7, 6, 4, 3, 2, 1]], expected: 5, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What is n, given the length of the list?",
      "If you added up all the seats that should exist, and all the seats that do exist, what is the difference?",
      "There is a closed form for 1 + 2 + ... + n.",
      "Return n*(n+1)/2 minus the sum of the list.",
    ],
    followUps: [
      "Can you do it without the sum formula, in O(1) extra space?",
      "What changes if two seats are missing instead of one?",
    ],
    optimal: { time: "O(n)", space: "O(1)" },
    source: "bank",
  },
  {
    id: "column-widths",
    title: "Column widths for a ragged table",
    prompt: `You are rendering a plain-text table. Given rows of string cells — rows may have **different lengths** — return the display width of each column, where a column's width is the length of the longest cell in it. Rows that are too short simply do not contribute to the later columns.

The returned list has as many entries as the longest row.

\`\`\`
column_widths([["id", "name"], ["1", "alexandra", "extra"], ["22"]])
  ->  [2, 9, 5]
\`\`\``,
    difficulty: "easy",
    jobLevels: ["intern", "entry"],
    roles: ["general", "frontend", "data"],
    topics: ["arrays", "edge cases"],
    functionName: "column_widths",
    starter: {
      python: `def column_widths(rows):\n    """Width of each column, where width is the longest cell in that column."""\n    pass\n`,
      javascript: `function column_widths(rows) {\n  // Width of each column, where width is the longest cell in that column.\n}\n`,
    },
    reference: {
      python: `def column_widths(rows):\n    widths = []\n    for row in rows:\n        for i, cell in enumerate(row):\n            if i >= len(widths):\n                widths.append(len(cell))\n            elif len(cell) > widths[i]:\n                widths[i] = len(cell)\n    return widths\n`,
      javascript: `function column_widths(rows) {\n  const widths = [];\n  for (const row of rows) {\n    for (let i = 0; i < row.length; i++) {\n      const len = row[i].length;\n      if (i >= widths.length) widths.push(len);\n      else if (len > widths[i]) widths[i] = len;\n    }\n  }\n  return widths;\n}\n`,
    },
    tests: [
      { name: "example", args: [[["id", "name"], ["1", "alexandra", "extra"], ["22"]]], expected: [2, 9, 5] },
      { name: "empty table", args: [[]], expected: [] },
      { name: "one row", args: [[["a", "bb", "ccc"]]], expected: [1, 2, 3] },
      { name: "empty cells", args: [[["", ""], ["x", ""]]], expected: [1, 0] },
      { name: "empty rows", args: [[[], [], ["ab"]]], expected: [2] },
      { name: "later row is longest", args: [[["a"], ["aa"], ["aaa"]]], expected: [3], hidden: true },
      { name: "first row shortest", args: [[["x"], ["y", "zzzz"]]], expected: [1, 4], hidden: true },
      { name: "ragged descending", args: [[["aaaa", "bb", "c"], ["a"], ["", "bbbbb"]]], expected: [4, 5, 1], hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What should happen when a row is shorter than the widest row seen so far?",
      "You do not know how many columns there are until you have seen every row.",
      "Grow the result list as you encounter longer rows.",
      "For each cell at index i: extend the widths list if i is past its end, otherwise take the max.",
    ],
    followUps: [
      "What is the complexity in terms of total cells?",
      "How would you change this if cells could contain multi-byte or wide characters?",
    ],
    optimal: { time: "O(total cells)", space: "O(columns)" },
    source: "bank",
  },
  {
    id: "longest-uptime",
    title: "Longest uptime streak",
    prompt: `A health checker records one boolean per minute: \`true\` means the service answered, \`false\` means it did not. Return the length of the longest unbroken run of \`true\`.

\`\`\`
longest_uptime([True, True, False, True, True, True, False])  ->  3
longest_uptime([False, False])                                ->  0
\`\`\``,
    difficulty: "easy",
    jobLevels: ["intern", "entry"],
    roles: ["general", "infra"],
    topics: ["single pass", "counters"],
    functionName: "longest_uptime",
    starter: {
      python: `def longest_uptime(pings):\n    """Length of the longest unbroken run of True."""\n    pass\n`,
      javascript: `function longest_uptime(pings) {\n  // Length of the longest unbroken run of true.\n}\n`,
    },
    reference: {
      python: `def longest_uptime(pings):\n    best = 0\n    run = 0\n    for p in pings:\n        if p:\n            run += 1\n            if run > best:\n                best = run\n        else:\n            run = 0\n    return best\n`,
      javascript: `function longest_uptime(pings) {\n  let best = 0, run = 0;\n  for (const p of pings) {\n    if (p) { run += 1; if (run > best) best = run; }\n    else run = 0;\n  }\n  return best;\n}\n`,
    },
    tests: [
      { name: "example", args: [[true, true, false, true, true, true, false]], expected: 3 },
      { name: "all down", args: [[false, false]], expected: 0 },
      { name: "empty", args: [[]], expected: 0 },
      { name: "all up", args: [[true, true, true]], expected: 3 },
      { name: "single up", args: [[true]], expected: 1 },
      { name: "streak at the end", args: [[true, false, true, true]], expected: 2, hidden: true },
      { name: "alternating", args: [[true, false, true, false, true]], expected: 1, hidden: true },
      { name: "streak at the start", args: [[true, true, true, true, false, true]], expected: 4, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What do you need to remember as you walk the list?",
      "There are two counters, not one. What is the difference between them?",
      "A current run length and the best run length seen so far.",
      "Reset the current run to zero on a false; update the best whenever the current run grows.",
    ],
    followUps: [
      "How would you also return the start index of that longest streak?",
      "What if the input were a stream you could only read once?",
    ],
    optimal: { time: "O(n)", space: "O(1)" },
    source: "bank",
  },
];
