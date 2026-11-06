import type { Question } from "../types";

export const HARD: Question[] = [
  {
    id: "cache-replay",
    title: "Replay a least-recently-used cache",
    prompt: `Simulate a fixed-size cache that evicts the **least recently used** entry when it is full. Both reading and writing a key count as using it.

\`ops\` is a list of operations: \`["put", key, value]\` or \`["get", key]\`.

Return the list of results of the \`get\` operations, in order. A miss yields \`null\` (Python: \`None\`).

\`\`\`
simulate_cache(2, [["put","a",1],["put","b",2],["get","a"],
                   ["put","c",3],["get","b"],["get","c"]])
  ->  [1, None, 3]
\`\`\`

A capacity of \`0\` means nothing is ever retained. Aim for O(1) per operation.`,
    difficulty: "hard",
    jobLevels: ["mid", "senior", "staff"],
    roles: ["backend", "infra", "general"],
    topics: ["hash map", "ordered structure", "design"],
    functionName: "simulate_cache",
    starter: {
      python: `def simulate_cache(capacity, ops):\n    """Return the results of each get op against an LRU cache of the given capacity."""\n    pass\n`,
      javascript: `function simulate_cache(capacity, ops) {\n  // Return the results of each get op against an LRU cache of the given capacity.\n}\n`,
    },
    reference: {
      python: `from collections import OrderedDict\n\ndef simulate_cache(capacity, ops):\n    cache = OrderedDict()\n    out = []\n    for op in ops:\n        if op[0] == "put":\n            key, val = op[1], op[2]\n            if key in cache:\n                cache.move_to_end(key)\n            cache[key] = val\n            while len(cache) > capacity:\n                cache.popitem(last=False)\n        else:\n            key = op[1]\n            if key in cache:\n                cache.move_to_end(key)\n                out.append(cache[key])\n            else:\n                out.append(None)\n    return out\n`,
      javascript: `function simulate_cache(capacity, ops) {\n  const cache = new Map();\n  const out = [];\n  for (const op of ops) {\n    if (op[0] === "put") {\n      const key = op[1], val = op[2];\n      if (cache.has(key)) cache.delete(key);\n      cache.set(key, val);\n      while (cache.size > capacity) cache.delete(cache.keys().next().value);\n    } else {\n      const key = op[1];\n      if (cache.has(key)) {\n        const val = cache.get(key);\n        cache.delete(key);\n        cache.set(key, val);\n        out.push(val);\n      } else {\n        out.push(null);\n      }\n    }\n  }\n  return out;\n}\n`,
    },
    tests: [
      { name: "example", args: [2, [["put", "a", 1], ["put", "b", 2], ["get", "a"], ["put", "c", 3], ["get", "b"], ["get", "c"]]], expected: [1, null, 3] },
      { name: "no ops", args: [2, []], expected: [] },
      { name: "capacity zero", args: [0, [["put", "a", 1], ["get", "a"]]], expected: [null] },
      { name: "capacity one evicts", args: [1, [["put", "a", 1], ["put", "b", 2], ["get", "a"], ["get", "b"]]], expected: [null, 2] },
      { name: "overwrite value", args: [2, [["put", "a", 1], ["put", "a", 9], ["get", "a"]]], expected: [9] },
      { name: "get refreshes recency", args: [2, [["put", "a", 1], ["put", "b", 2], ["get", "a"], ["put", "c", 3], ["get", "b"], ["get", "a"]]], expected: [1, null, 1], hidden: true },
      { name: "all misses", args: [2, [["get", "x"], ["get", "y"]]], expected: [null, null], hidden: true },
      { name: "put refreshes recency too", args: [2, [["put", "a", 1], ["put", "b", 2], ["put", "a", 3], ["put", "c", 4], ["get", "b"], ["get", "a"]]], expected: [null, 3], hidden: true },
      { name: "longer trace", args: [3, [["put", "a", 1], ["put", "b", 2], ["put", "c", 3], ["get", "a"], ["put", "d", 4], ["get", "b"], ["get", "c"], ["get", "d"], ["get", "a"]]], expected: [1, null, 3, 4, 1], hidden: true },
    ],
    comparison: "exact",
    hints: [
      "Which operations count as 'using' an entry? Settle that before you design anything.",
      "You need two things at once: O(1) lookup by key, and O(1) knowledge of which key is oldest.",
      "One structure gives you lookup, another gives you ordering. What connects them?",
      "A hash map to a doubly linked list — or, in Python, an OrderedDict with move_to_end, and in JS a Map, whose iteration order you can exploit.",
    ],
    followUps: [
      "Why does a plain array of keys not get you O(1) per operation?",
      "How would you extend this to expire entries by age as well as by recency?",
    ],
    optimal: { time: "O(1) per op", space: "O(capacity)" },
    source: "bank",
  },
  {
    id: "running-medians",
    title: "Median after every reading",
    prompt: `A monitoring agent reports the **median of everything seen so far** after each new reading. With an even count, the median is the average of the two middle values.

Return the list of medians, one per input value.

\`\`\`
running_medians([3, 1, 4, 1])  ->  [3, 2, 3, 2]
running_medians([5, 15])       ->  [5, 10]
\`\`\`

Aim for better than re-sorting on every reading.`,
    difficulty: "hard",
    jobLevels: ["senior", "staff"],
    roles: ["data", "backend", "general"],
    topics: ["two heaps", "streaming", "invariants"],
    functionName: "running_medians",
    starter: {
      python: `def running_medians(values):\n    """Median of the prefix after each value."""\n    pass\n`,
      javascript: `function running_medians(values) {\n  // Median of the prefix after each value.\n}\n`,
    },
    reference: {
      python: `import heapq\n\ndef running_medians(values):\n    low = []   # max-heap via negation\n    high = []  # min-heap\n    out = []\n    for v in values:\n        if not low or v <= -low[0]:\n            heapq.heappush(low, -v)\n        else:\n            heapq.heappush(high, v)\n        if len(low) > len(high) + 1:\n            heapq.heappush(high, -heapq.heappop(low))\n        elif len(high) > len(low):\n            heapq.heappush(low, -heapq.heappop(high))\n        if len(low) > len(high):\n            out.append(float(-low[0]))\n        else:\n            out.append((-low[0] + high[0]) / 2.0)\n    return out\n`,
      javascript: `function running_medians(values) {\n  const sorted = [];\n  const out = [];\n  for (const v of values) {\n    let lo = 0, hi = sorted.length;\n    while (lo < hi) {\n      const mid = (lo + hi) >> 1;\n      if (sorted[mid] < v) lo = mid + 1; else hi = mid;\n    }\n    sorted.splice(lo, 0, v);\n    const n = sorted.length;\n    out.push(n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2);\n  }\n  return out;\n}\n`,
    },
    tests: [
      { name: "example", args: [[3, 1, 4, 1]], expected: [3, 2, 3, 2] },
      { name: "two values", args: [[5, 15]], expected: [5, 10] },
      { name: "empty", args: [[]], expected: [] },
      { name: "single", args: [[7]], expected: [7] },
      { name: "ascending", args: [[1, 2, 3]], expected: [1, 1.5, 2] },
      { name: "descending", args: [[3, 2, 1]], expected: [3, 2.5, 2], hidden: true },
      { name: "negatives", args: [[-1, -3, -2, -4]], expected: [-1, -2, -2, -2.5], hidden: true },
      { name: "duplicates", args: [[2, 2, 2, 2]], expected: [2, 2, 2, 2], hidden: true },
      { name: "longer stream", args: [[3, 1, 4, 1, 5, 9, 2, 6]], expected: [3, 2, 3, 2, 3, 3.5, 3, 3.5], hidden: true },
    ],
    comparison: "approx",
    hints: [
      "If you had the values sorted, where exactly is the median? Now: what does inserting one new value do to that position?",
      "You never need the whole ordering — only the boundary between the lower half and the upper half.",
      "Two heaps facing each other: a max-heap of the lower half, a min-heap of the upper half.",
      "Push based on which side the value belongs to, rebalance so the sizes differ by at most one, then read the median off the tops.",
    ],
    followUps: [
      "What invariant are you maintaining between the two heaps, and where could it break?",
      "How would you handle a sliding window of the last k readings instead of the whole prefix?",
    ],
    optimal: { time: "O(n log n)", space: "O(n)" },
    source: "bank",
  },
  {
    id: "config-migrations",
    title: "Shortest migration path",
    prompt: `A config value must be migrated from \`start\` to \`target\`. One migration step changes exactly **one character**, and every intermediate value — including the final one — must appear in the \`allowed\` list. \`start\` itself need not be in the list.

Return the minimum number of steps, or \`-1\` if no path exists. If \`start\` equals \`target\`, the answer is \`0\`.

\`\`\`
min_migrations("cold", "warm", ["cord","card","ward","warm","wold","word"])
  ->  4        # cold -> cord -> word -> ward -> warm
\`\`\``,
    difficulty: "hard",
    jobLevels: ["senior", "staff"],
    roles: ["general", "backend"],
    topics: ["BFS", "implicit graphs"],
    functionName: "min_migrations",
    starter: {
      python: `def min_migrations(start, target, allowed):\n    """Fewest single-character steps from start to target through allowed values."""\n    pass\n`,
      javascript: `function min_migrations(start, target, allowed) {\n  // Fewest single-character steps from start to target through allowed values.\n}\n`,
    },
    reference: {
      python: `from collections import deque\n\ndef min_migrations(start, target, allowed):\n    if start == target:\n        return 0\n    words = set(allowed)\n    if target not in words:\n        return -1\n    letters = set(start)\n    for w in words:\n        letters.update(w)\n    queue = deque([(start, 0)])\n    seen = {start}\n    while queue:\n        cur, dist = queue.popleft()\n        for i in range(len(cur)):\n            for ch in letters:\n                if ch == cur[i]:\n                    continue\n                nxt = cur[:i] + ch + cur[i + 1:]\n                if nxt in words and nxt not in seen:\n                    if nxt == target:\n                        return dist + 1\n                    seen.add(nxt)\n                    queue.append((nxt, dist + 1))\n    return -1\n`,
      javascript: `function min_migrations(start, target, allowed) {\n  if (start === target) return 0;\n  const words = new Set(allowed);\n  if (!words.has(target)) return -1;\n  const letters = new Set(start);\n  for (const w of words) for (const c of w) letters.add(c);\n  let frontier = [[start, 0]];\n  const seen = new Set([start]);\n  while (frontier.length) {\n    const [cur, dist] = frontier.shift();\n    for (let i = 0; i < cur.length; i++) {\n      for (const ch of letters) {\n        if (ch === cur[i]) continue;\n        const nxt = cur.slice(0, i) + ch + cur.slice(i + 1);\n        if (words.has(nxt) && !seen.has(nxt)) {\n          if (nxt === target) return dist + 1;\n          seen.add(nxt);\n          frontier.push([nxt, dist + 1]);\n        }\n      }\n    }\n  }\n  return -1;\n}\n`,
    },
    tests: [
      { name: "example", args: ["cold", "warm", ["cord", "card", "ward", "warm", "wold", "word"]], expected: 4 },
      { name: "already there", args: ["abc", "abc", []], expected: 0 },
      { name: "target not allowed", args: ["abc", "abd", ["abe"]], expected: -1 },
      { name: "one step", args: ["hit", "hot", ["hot"]], expected: 1 },
      { name: "no path", args: ["aaa", "bbb", ["bbb"]], expected: -1 },
      { name: "two steps", args: ["aaa", "aab", ["aab"]], expected: 1, hidden: true },
      { name: "must route around", args: ["red", "tax", ["ted", "tex", "tax", "tad"]], expected: 3, hidden: true },
      { name: "shortest of two routes", args: ["aa", "bb", ["ab", "ba", "bb"]], expected: 2, hidden: true },
      { name: "single character values", args: ["a", "d", ["b", "c", "d"]], expected: 1, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What are the nodes and what are the edges here? Nothing in the input looks like a graph yet.",
      "You want the fewest steps, and every step costs the same. Which traversal gives you that for free?",
      "Breadth-first search over an implicit graph: neighbours are generated, not stored.",
      "From a value, generate every one-character mutation, keep the ones in the allowed set, and mark them seen as you enqueue them — not when you dequeue.",
    ],
    followUps: [
      "What is the branching factor, and how does the cost change if you search from both ends at once?",
      "Why must you mark nodes seen at enqueue time rather than dequeue time?",
    ],
    optimal: { time: "O(N * L * A)", space: "O(N * L)" },
    source: "bank",
  },
  {
    id: "weighted-patch-cost",
    title: "Cheapest patch between two strings",
    prompt: `A patch tool rewrites string \`a\` into string \`b\` using three operations with **different costs**: insert a character, delete a character, or replace one character with another.

Return the minimum total cost.

\`\`\`
min_patch_cost("kitten", "sitting", 1, 1, 1)  ->  3
min_patch_cost("a", "b", 1, 1, 5)             ->  2    # delete then insert beats replace
\`\`\`

Constraints: strings up to 1,000 characters, costs are non-negative integers.`,
    difficulty: "hard",
    jobLevels: ["senior", "staff"],
    roles: ["general", "backend", "data"],
    topics: ["dynamic programming", "edit distance"],
    functionName: "min_patch_cost",
    starter: {
      python: `def min_patch_cost(a, b, cost_insert, cost_delete, cost_replace):\n    """Minimum cost to rewrite a into b under the three weighted operations."""\n    pass\n`,
      javascript: `function min_patch_cost(a, b, cost_insert, cost_delete, cost_replace) {\n  // Minimum cost to rewrite a into b under the three weighted operations.\n}\n`,
    },
    reference: {
      python: `def min_patch_cost(a, b, cost_insert, cost_delete, cost_replace):\n    n, m = len(a), len(b)\n    prev = [j * cost_insert for j in range(m + 1)]\n    for i in range(1, n + 1):\n        cur = [i * cost_delete] + [0] * m\n        for j in range(1, m + 1):\n            if a[i - 1] == b[j - 1]:\n                cur[j] = prev[j - 1]\n            else:\n                cur[j] = min(\n                    prev[j - 1] + cost_replace,\n                    prev[j] + cost_delete,\n                    cur[j - 1] + cost_insert,\n                )\n        prev = cur\n    return prev[m]\n`,
      javascript: `function min_patch_cost(a, b, cost_insert, cost_delete, cost_replace) {\n  const n = a.length, m = b.length;\n  let prev = new Array(m + 1);\n  for (let j = 0; j <= m; j++) prev[j] = j * cost_insert;\n  for (let i = 1; i <= n; i++) {\n    const cur = new Array(m + 1);\n    cur[0] = i * cost_delete;\n    for (let j = 1; j <= m; j++) {\n      if (a[i - 1] === b[j - 1]) cur[j] = prev[j - 1];\n      else cur[j] = Math.min(prev[j - 1] + cost_replace, prev[j] + cost_delete, cur[j - 1] + cost_insert);\n    }\n    prev = cur;\n  }\n  return prev[m];\n}\n`,
    },
    tests: [
      { name: "classic", args: ["kitten", "sitting", 1, 1, 1], expected: 3 },
      { name: "replace is expensive", args: ["a", "b", 1, 1, 5], expected: 2 },
      { name: "insert only", args: ["", "abc", 1, 1, 1], expected: 3 },
      { name: "delete only", args: ["abc", "", 1, 1, 1], expected: 3 },
      { name: "identical strings", args: ["same", "same", 5, 5, 5], expected: 0 },
      { name: "both empty", args: ["", "", 3, 4, 5], expected: 0, hidden: true },
      { name: "replace is cheap", args: ["abc", "abd", 10, 10, 1], expected: 1, hidden: true },
      { name: "transposition costs two", args: ["ab", "ba", 1, 1, 1], expected: 2, hidden: true },
      { name: "asymmetric costs", args: ["horse", "ros", 1, 1, 1], expected: 3, hidden: true },
      { name: "free inserts", args: ["ab", "aXbY", 0, 7, 7], expected: 0, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "Suppose you already knew the answer for every pair of prefixes. How would you get the answer for one character more?",
      "Look at the last character of each string. What are your options, and what subproblem does each one leave behind?",
      "A table indexed by (prefix of a, prefix of b), with the three operations as the three transitions.",
      "Matching characters cost nothing and move diagonally; otherwise take the cheapest of replace, delete, insert. Fill the first row and column with the cost of building from empty.",
    ],
    followUps: [
      "You are using O(m) memory instead of O(n*m). What do you lose by doing that?",
      "How would the recurrence change if you also allowed swapping two adjacent characters?",
    ],
    optimal: { time: "O(n*m)", space: "O(min(n, m))" },
    source: "bank",
  },
  {
    id: "weighted-scheduling",
    title: "Most valuable non-overlapping schedule",
    prompt: `You are given jobs as \`[start, end, value]\`. You may run any set of jobs that do not overlap; a job ending exactly when another starts is fine.

Return the maximum total value.

\`\`\`
max_schedule_value([[1,3,50],[2,5,20],[4,6,70]])  ->  120
\`\`\`

Constraints: up to 100,000 jobs, \`start <= end\`, values are non-negative integers. A quadratic solution will not be accepted.`,
    difficulty: "hard",
    jobLevels: ["senior", "staff"],
    roles: ["general", "backend", "data"],
    topics: ["dynamic programming", "binary search", "sorting"],
    functionName: "max_schedule_value",
    starter: {
      python: `def max_schedule_value(jobs):\n    """Maximum total value of a non-overlapping subset of [start, end, value] jobs."""\n    pass\n`,
      javascript: `function max_schedule_value(jobs) {\n  // Maximum total value of a non-overlapping subset of [start, end, value] jobs.\n}\n`,
    },
    reference: {
      python: `import bisect\n\ndef max_schedule_value(jobs):\n    if not jobs:\n        return 0\n    ordered = sorted(jobs, key=lambda j: (j[1], j[0]))\n    ends = [j[1] for j in ordered]\n    dp = [0] * (len(ordered) + 1)\n    for i, job in enumerate(ordered):\n        start, _end, value = job[0], job[1], job[2]\n        k = bisect.bisect_right(ends, start, 0, i)\n        dp[i + 1] = max(dp[i], dp[k] + value)\n    return dp[len(ordered)]\n`,
      javascript: `function max_schedule_value(jobs) {\n  if (jobs.length === 0) return 0;\n  const ordered = [...jobs].sort((a, b) => a[1] - b[1] || a[0] - b[0]);\n  const ends = ordered.map((j) => j[1]);\n  const dp = new Array(ordered.length + 1).fill(0);\n  for (let i = 0; i < ordered.length; i++) {\n    const start = ordered[i][0], value = ordered[i][2];\n    let lo = 0, hi = i;\n    while (lo < hi) {\n      const mid = (lo + hi) >> 1;\n      if (ends[mid] <= start) lo = mid + 1; else hi = mid;\n    }\n    dp[i + 1] = Math.max(dp[i], dp[lo] + value);\n  }\n  return dp[ordered.length];\n}\n`,
    },
    tests: [
      { name: "example", args: [[[1, 3, 50], [2, 5, 20], [4, 6, 70]]], expected: 120 },
      { name: "empty", args: [[]], expected: 0 },
      { name: "single job", args: [[[0, 1, 5]]], expected: 5 },
      { name: "touching jobs both run", args: [[[1, 2, 10], [2, 3, 10]]], expected: 20 },
      { name: "identical spans", args: [[[1, 5, 10], [1, 5, 3]]], expected: 10 },
      { name: "two small beat one big", args: [[[1, 10, 5], [2, 3, 6], [4, 5, 7]]], expected: 13, hidden: true },
      { name: "zero values", args: [[[1, 2, 0], [1, 2, 5]]], expected: 5, hidden: true },
      { name: "unsorted input", args: [[[6, 9, 60], [1, 3, 20], [3, 10, 100], [2, 5, 20], [4, 6, 70]]], expected: 150, hidden: true },
      { name: "all overlapping", args: [[[0, 10, 1], [1, 9, 2], [2, 8, 3]]], expected: 3, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "Sorting by start time is the obvious move. Try sorting by end time instead and see what becomes easy.",
      "For a job you decide to run, which earlier jobs are still available to you?",
      "'The last job that finishes at or before this one starts' — that is a search over a sorted array.",
      "Sort by end, keep dp[i] = best value using the first i jobs, and for each job binary search the ends array for the latest compatible prefix.",
    ],
    followUps: [
      "Why does sorting by end time make the compatible prefix contiguous?",
      "How would you recover the actual set of jobs, not just the total value?",
    ],
    optimal: { time: "O(n log n)", space: "O(n)" },
    source: "bank",
  },
  {
    id: "rack-reservoir",
    title: "Water trapped between racks",
    prompt: `Server racks of varying heights stand side by side, each one unit wide. Rain falls; water pools in the dips between taller racks and runs off the ends.

Return the total units of water trapped.

\`\`\`
trapped_units([0,1,0,2,1,0,1,3,2,1,2,1])  ->  6
trapped_units([4,2,0,3,2,5])              ->  9
\`\`\`

Aim for a single pass with constant extra space.`,
    difficulty: "hard",
    jobLevels: ["senior", "staff"],
    roles: ["general", "infra"],
    topics: ["two pointers", "prefix maxima"],
    functionName: "trapped_units",
    starter: {
      python: `def trapped_units(heights):\n    """Total units of water trapped between the bars."""\n    pass\n`,
      javascript: `function trapped_units(heights) {\n  // Total units of water trapped between the bars.\n}\n`,
    },
    reference: {
      python: `def trapped_units(heights):\n    left, right = 0, len(heights) - 1\n    left_max = right_max = 0\n    total = 0\n    while left < right:\n        if heights[left] < heights[right]:\n            if heights[left] >= left_max:\n                left_max = heights[left]\n            else:\n                total += left_max - heights[left]\n            left += 1\n        else:\n            if heights[right] >= right_max:\n                right_max = heights[right]\n            else:\n                total += right_max - heights[right]\n            right -= 1\n    return total\n`,
      javascript: `function trapped_units(heights) {\n  let left = 0, right = heights.length - 1;\n  let leftMax = 0, rightMax = 0, total = 0;\n  while (left < right) {\n    if (heights[left] < heights[right]) {\n      if (heights[left] >= leftMax) leftMax = heights[left];\n      else total += leftMax - heights[left];\n      left++;\n    } else {\n      if (heights[right] >= rightMax) rightMax = heights[right];\n      else total += rightMax - heights[right];\n      right--;\n    }\n  }\n  return total;\n}\n`,
    },
    tests: [
      { name: "classic", args: [[0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]], expected: 6 },
      { name: "deep basin", args: [[4, 2, 0, 3, 2, 5]], expected: 9 },
      { name: "empty", args: [[]], expected: 0 },
      { name: "single bar", args: [[3]], expected: 0 },
      { name: "ascending", args: [[1, 2, 3]], expected: 0 },
      { name: "descending", args: [[3, 2, 1]], expected: 0, hidden: true },
      { name: "simple well", args: [[5, 0, 5]], expected: 5, hidden: true },
      { name: "two wells", args: [[2, 0, 2, 0, 2]], expected: 4, hidden: true },
      { name: "flat", args: [[3, 3, 3]], expected: 0, hidden: true },
      { name: "plateau walls", args: [[5, 5, 1, 1, 5, 5]], expected: 8, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "For one single column, what determines how much water sits on top of it?",
      "It is the smaller of the tallest bar to its left and the tallest bar to its right, minus its own height.",
      "You could precompute those two arrays. Then think about whether you need both in full at the same time.",
      "Two pointers walking inward: whichever side is shorter is the side whose answer is already determined, so process that one and move it.",
    ],
    followUps: [
      "Why is it safe to process the shorter side without knowing the other side's true maximum yet?",
      "How would this change if the racks had different widths?",
    ],
    optimal: { time: "O(n)", space: "O(1)" },
    source: "bank",
  },
];
