import type { Question } from "../types";

export const MEDIUM: Question[] = [
  {
    id: "rate-limit-replay",
    title: "Replay a rate limiter",
    prompt: `An API rate limiter allows each user at most \`limit\` **accepted** requests in any sliding window of \`window\` seconds. A request at time \`t\` is rejected if the user already has \`limit\` accepted requests with timestamps in the half-open interval \`(t - window, t]\`. Rejected requests do **not** count toward the limit.

Given \`events\` as \`[timestamp, user_id]\` pairs sorted by timestamp ascending, return the **indices** of the rejected requests, in increasing order.

\`\`\`
rejected_requests([[0,"a"],[1,"a"],[2,"a"],[3,"b"],[11,"a"]], 10, 2)
  ->  [2]
\`\`\`

Constraints: timestamps are non-negative integers, up to 100,000 events.`,
    difficulty: "medium",
    jobLevels: ["mid", "senior"],
    roles: ["backend", "infra", "general"],
    topics: ["sliding window", "hash map", "queue"],
    functionName: "rejected_requests",
    starter: {
      python: `def rejected_requests(events, window, limit):\n    """Return indices of requests rejected by a per-user sliding-window limiter."""\n    pass\n`,
      javascript: `function rejected_requests(events, window, limit) {\n  // Return indices of requests rejected by a per-user sliding-window limiter.\n}\n`,
    },
    reference: {
      python: `from collections import deque\n\ndef rejected_requests(events, window, limit):\n    per_user = {}\n    rejected = []\n    for i, pair in enumerate(events):\n        t, user = pair[0], pair[1]\n        q = per_user.setdefault(user, deque())\n        while q and q[0] <= t - window:\n            q.popleft()\n        if len(q) >= limit:\n            rejected.append(i)\n        else:\n            q.append(t)\n    return rejected\n`,
      javascript: `function rejected_requests(events, window, limit) {\n  const perUser = new Map();\n  const rejected = [];\n  for (let i = 0; i < events.length; i++) {\n    const t = events[i][0], user = events[i][1];\n    if (!perUser.has(user)) perUser.set(user, []);\n    const q = perUser.get(user);\n    let head = 0;\n    while (head < q.length && q[head] <= t - window) head++;\n    if (head > 0) q.splice(0, head);\n    if (q.length >= limit) rejected.push(i);\n    else q.push(t);\n  }\n  return rejected;\n}\n`,
    },
    tests: [
      { name: "example", args: [[[0, "a"], [1, "a"], [2, "a"], [3, "b"], [11, "a"]], 10, 2], expected: [2] },
      { name: "no events", args: [[], 10, 1], expected: [] },
      { name: "limit never reached", args: [[[0, "a"], [100, "a"]], 10, 1], expected: [] },
      { name: "users are independent", args: [[[0, "a"], [0, "b"], [0, "a"]], 5, 1], expected: [2] },
      { name: "rejections do not count", args: [[[0, "a"], [0, "a"], [0, "a"], [6, "a"]], 5, 1], expected: [1, 2] },
      { name: "window boundary is exclusive", args: [[[0, "a"], [10, "a"]], 10, 1], expected: [], hidden: true },
      { name: "just inside the window", args: [[[0, "a"], [9, "a"]], 10, 1], expected: [1], hidden: true },
      { name: "limit zero rejects all", args: [[[0, "a"], [1, "b"]], 5, 0], expected: [0, 1], hidden: true },
      { name: "burst then recovery", args: [[[0, "u"], [1, "u"], [2, "u"], [3, "u"], [20, "u"], [21, "u"]], 10, 3], expected: [3], hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What exactly is in the window when a request arrives — all prior requests, or only some of them?",
      "Each user has their own limit. What does that tell you about the shape of your state?",
      "Within one user, timestamps arrive sorted, so the entries leaving the window always leave from the front.",
      "Keep a deque of accepted timestamps per user; evict from the front while the head is at or before t - window, then compare the length to the limit.",
    ],
    followUps: [
      "What is the amortized cost per event, and why is it not O(window)?",
      "How would you approximate this with fixed memory per user, and what accuracy do you give up?",
    ],
    optimal: { time: "O(n) amortized", space: "O(users * limit)" },
    source: "bank",
  },
  {
    id: "merge-maintenance-windows",
    title: "Merge maintenance windows",
    prompt: `Teams file maintenance windows as \`[start, end]\` minute offsets. Windows that overlap **or touch** should be announced as one window.

Return the merged windows sorted by start time.

\`\`\`
merge_windows([[5, 8], [1, 3], [3, 4], [10, 12]])
  ->  [[1, 4], [5, 8], [10, 12]]
\`\`\`

Constraints: \`start <= end\`, integers, up to 100,000 windows.`,
    difficulty: "medium",
    jobLevels: ["entry", "mid", "senior"],
    roles: ["general", "backend", "infra"],
    topics: ["intervals", "sorting"],
    functionName: "merge_windows",
    starter: {
      python: `def merge_windows(windows):\n    """Merge overlapping or touching [start, end] windows, sorted by start."""\n    pass\n`,
      javascript: `function merge_windows(windows) {\n  // Merge overlapping or touching [start, end] windows, sorted by start.\n}\n`,
    },
    reference: {
      python: `def merge_windows(windows):\n    if not windows:\n        return []\n    ordered = sorted(windows, key=lambda w: (w[0], w[1]))\n    out = [[ordered[0][0], ordered[0][1]]]\n    for start, end in ordered[1:]:\n        if start <= out[-1][1]:\n            if end > out[-1][1]:\n                out[-1][1] = end\n        else:\n            out.append([start, end])\n    return out\n`,
      javascript: `function merge_windows(windows) {\n  if (windows.length === 0) return [];\n  const ordered = [...windows].sort((a, b) => a[0] - b[0] || a[1] - b[1]);\n  const out = [[ordered[0][0], ordered[0][1]]];\n  for (let i = 1; i < ordered.length; i++) {\n    const [start, end] = ordered[i];\n    const last = out[out.length - 1];\n    if (start <= last[1]) { if (end > last[1]) last[1] = end; }\n    else out.push([start, end]);\n  }\n  return out;\n}\n`,
    },
    tests: [
      { name: "example", args: [[[5, 8], [1, 3], [3, 4], [10, 12]]], expected: [[1, 4], [5, 8], [10, 12]] },
      { name: "empty", args: [[]], expected: [] },
      { name: "single", args: [[[2, 5]]], expected: [[2, 5]] },
      { name: "fully contained", args: [[[1, 10], [3, 4]]], expected: [[1, 10]] },
      { name: "identical", args: [[[1, 2], [1, 2]]], expected: [[1, 2]] },
      { name: "touching endpoints merge", args: [[[1, 2], [2, 3]]], expected: [[1, 3]], hidden: true },
      { name: "zero-length windows", args: [[[4, 4], [1, 1], [4, 6]]], expected: [[1, 1], [4, 6]], hidden: true },
      { name: "chain collapses to one", args: [[[1, 3], [2, 6], [5, 9], [8, 11]]], expected: [[1, 11]], hidden: true },
      { name: "reverse order input", args: [[[9, 10], [6, 7], [3, 4], [0, 1]]], expected: [[0, 1], [3, 4], [6, 7], [9, 10]], hidden: true },
    ],
    comparison: "exact",
    hints: [
      "Does 'touching' mean [1,2] and [2,3] merge? Ask, and decide before you code.",
      "If the input were already sorted by start, what would the algorithm look like?",
      "Sort by start, then sweep, keeping only the last merged window open.",
      "A new window extends the open one when its start is at or before the open window's end — and remember the open end can already be larger than the new end.",
    ],
    followUps: [
      "What dominates the runtime, and what if the input arrived already sorted?",
      "How would you support removing a window later without re-merging everything?",
    ],
    optimal: { time: "O(n log n)", space: "O(n)" },
    source: "bank",
  },
  {
    id: "dependency-order",
    title: "Deterministic build order",
    prompt: `A build system has packages and dependency edges. Each edge \`[a, b]\` means **a must be built before b**.

Return a valid build order. When several packages are ready at the same time, build the **alphabetically smallest** first, so the answer is deterministic. If the dependencies contain a cycle, return an empty list.

\`\`\`
build_order(["web", "api", "db", "util"], [["db","api"],["api","web"],["util","api"]])
  ->  ["db", "util", "api", "web"]
\`\`\``,
    difficulty: "medium",
    jobLevels: ["mid", "senior"],
    roles: ["backend", "infra", "general"],
    topics: ["topological sort", "graphs", "heap"],
    functionName: "build_order",
    starter: {
      python: `def build_order(packages, edges):\n    """Lexicographically smallest topological order, or [] on a cycle."""\n    pass\n`,
      javascript: `function build_order(packages, edges) {\n  // Lexicographically smallest topological order, or [] on a cycle.\n}\n`,
    },
    reference: {
      python: `import heapq\n\ndef build_order(packages, edges):\n    indegree = {p: 0 for p in packages}\n    out = {p: [] for p in packages}\n    for a, b in edges:\n        out[a].append(b)\n        indegree[b] += 1\n    ready = [p for p in packages if indegree[p] == 0]\n    heapq.heapify(ready)\n    order = []\n    while ready:\n        p = heapq.heappop(ready)\n        order.append(p)\n        for nxt in out[p]:\n            indegree[nxt] -= 1\n            if indegree[nxt] == 0:\n                heapq.heappush(ready, nxt)\n    return order if len(order) == len(packages) else []\n`,
      javascript: `function build_order(packages, edges) {\n  const indegree = new Map(packages.map((p) => [p, 0]));\n  const out = new Map(packages.map((p) => [p, []]));\n  for (const [a, b] of edges) {\n    out.get(a).push(b);\n    indegree.set(b, indegree.get(b) + 1);\n  }\n  const ready = packages.filter((p) => indegree.get(p) === 0).sort();\n  const order = [];\n  while (ready.length) {\n    const p = ready.shift();\n    order.push(p);\n    for (const nxt of out.get(p)) {\n      const d = indegree.get(nxt) - 1;\n      indegree.set(nxt, d);\n      if (d === 0) {\n        let i = 0;\n        while (i < ready.length && ready[i] < nxt) i++;\n        ready.splice(i, 0, nxt);\n      }\n    }\n  }\n  return order.length === packages.length ? order : [];\n}\n`,
    },
    tests: [
      { name: "example", args: [["web", "api", "db", "util"], [["db", "api"], ["api", "web"], ["util", "api"]]], expected: ["db", "util", "api", "web"] },
      { name: "no edges sorts alphabetically", args: [["c", "a", "b"], []], expected: ["a", "b", "c"] },
      { name: "empty", args: [[], []], expected: [] },
      { name: "simple cycle", args: [["a", "b"], [["a", "b"], ["b", "a"]]], expected: [] },
      { name: "single package", args: [["solo"], []], expected: ["solo"] },
      { name: "tie broken by name", args: [["z", "y", "x"], [["z", "x"]]], expected: ["y", "z", "x"], hidden: true },
      { name: "chain", args: [["d", "c", "b", "a"], [["a", "b"], ["b", "c"], ["c", "d"]]], expected: ["a", "b", "c", "d"], hidden: true },
      { name: "cycle hidden among valid nodes", args: [["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["c", "b"], ["a", "d"]]], expected: [], hidden: true },
      { name: "diamond", args: [["a", "b", "c", "d"], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]], expected: ["a", "b", "c", "d"], hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What makes a package buildable right now?",
      "Count, for each package, how many things must be built before it. What happens to those counts as you build?",
      "This is a topological sort. The tie-break requirement changes which structure holds the ready set.",
      "Kahn's algorithm with a min-heap for the ready set; if you emit fewer packages than you started with, there is a cycle.",
    ],
    followUps: [
      "How would you report which packages are in the cycle rather than just failing?",
      "How would you parallelize the build, and what would you return instead of a flat list?",
    ],
    optimal: { time: "O((V + E) log V)", space: "O(V + E)" },
    source: "bank",
  },
  {
    id: "longest-distinct-run",
    title: "Longest run of distinct codes",
    prompt: `A sensor emits a stream of string codes. Return the length of the longest **contiguous** stretch in which no code repeats.

\`\`\`
longest_distinct_run(["a","b","c","a","b","b"])  ->  3      # a,b,c
longest_distinct_run(["x","x","x"])              ->  1
\`\`\``,
    difficulty: "medium",
    jobLevels: ["entry", "mid", "senior"],
    roles: ["general", "data", "backend"],
    topics: ["sliding window", "hash map"],
    functionName: "longest_distinct_run",
    starter: {
      python: `def longest_distinct_run(codes):\n    """Length of the longest contiguous stretch with no repeated code."""\n    pass\n`,
      javascript: `function longest_distinct_run(codes) {\n  // Length of the longest contiguous stretch with no repeated code.\n}\n`,
    },
    reference: {
      python: `def longest_distinct_run(codes):\n    last = {}\n    start = 0\n    best = 0\n    for i, c in enumerate(codes):\n        if c in last and last[c] >= start:\n            start = last[c] + 1\n        last[c] = i\n        if i - start + 1 > best:\n            best = i - start + 1\n    return best\n`,
      javascript: `function longest_distinct_run(codes) {\n  const last = new Map();\n  let start = 0, best = 0;\n  for (let i = 0; i < codes.length; i++) {\n    const c = codes[i];\n    if (last.has(c) && last.get(c) >= start) start = last.get(c) + 1;\n    last.set(c, i);\n    if (i - start + 1 > best) best = i - start + 1;\n  }\n  return best;\n}\n`,
    },
    tests: [
      { name: "example", args: [["a", "b", "c", "a", "b", "b"]], expected: 3 },
      { name: "all same", args: [["x", "x", "x"]], expected: 1 },
      { name: "empty", args: [[]], expected: 0 },
      { name: "all distinct", args: [["p", "q", "r", "s"]], expected: 4 },
      { name: "single", args: [["only"]], expected: 1 },
      { name: "repeat far behind window", args: [["a", "b", "a", "c", "d", "e"]], expected: 5, hidden: true },
      { name: "best run at the end", args: [["a", "a", "b", "c", "d"]], expected: 4, hidden: true },
      { name: "alternating pair", args: [["a", "b", "a", "b", "a"]], expected: 2, hidden: true },
      { name: "multi-char codes", args: [["cpu", "mem", "cpu", "disk", "net", "mem"]], expected: 4, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "When you hit a repeat, does the whole window have to reset?",
      "The window only ever needs to shrink from the left. Where exactly should its left edge move to?",
      "Remember the last index at which you saw each code.",
      "If the previous occurrence is inside the current window, move the start to just past it — otherwise leave the start alone.",
    ],
    followUps: [
      "Why is this linear rather than quadratic, given the start pointer moves too?",
      "What changes if you were allowed up to k repeats inside the window?",
    ],
    optimal: { time: "O(n)", space: "O(distinct codes)" },
    source: "bank",
  },
  {
    id: "group-variants",
    title: "Group spelling variants",
    prompt: `Two identifiers are **variants** of each other if one is a rearrangement of the other's characters.

Group the input into variant groups. Sort each group alphabetically, then sort the groups by their first element.

\`\`\`
group_variants(["listen","silent","enlist","google","gogole","cat"])
  ->  [["cat"], ["enlist","listen","silent"], ["gogole","google"]]
\`\`\``,
    difficulty: "medium",
    jobLevels: ["entry", "mid"],
    roles: ["general", "backend"],
    topics: ["hash map", "canonical keys", "sorting"],
    functionName: "group_variants",
    starter: {
      python: `def group_variants(words):\n    """Group rearrangements together; groups sorted, and sorted by first element."""\n    pass\n`,
      javascript: `function group_variants(words) {\n  // Group rearrangements together; groups sorted, and sorted by first element.\n}\n`,
    },
    reference: {
      python: `def group_variants(words):\n    buckets = {}\n    for w in words:\n        key = "".join(sorted(w))\n        buckets.setdefault(key, []).append(w)\n    groups = [sorted(g) for g in buckets.values()]\n    groups.sort(key=lambda g: g[0])\n    return groups\n`,
      javascript: `function group_variants(words) {\n  const buckets = new Map();\n  for (const w of words) {\n    const key = [...w].sort().join("");\n    if (!buckets.has(key)) buckets.set(key, []);\n    buckets.get(key).push(w);\n  }\n  const groups = [...buckets.values()].map((g) => g.sort());\n  groups.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));\n  return groups;\n}\n`,
    },
    tests: [
      { name: "example", args: [["listen", "silent", "enlist", "google", "gogole", "cat"]], expected: [["cat"], ["enlist", "listen", "silent"], ["gogole", "google"]] },
      { name: "empty", args: [[]], expected: [] },
      { name: "no groups", args: [["ab", "cd"]], expected: [["ab"], ["cd"]] },
      { name: "single", args: [["x"]], expected: [["x"]] },
      { name: "exact duplicates stay together", args: [["ab", "ab"]], expected: [["ab", "ab"]] },
      { name: "empty strings", args: [["", "", "a"]], expected: [["", ""], ["a"]], hidden: true },
      { name: "repeated letters matter", args: [["aab", "aba", "abb"]], expected: [["aab", "aba"], ["abb"]], hidden: true },
      { name: "length differs", args: [["abc", "ab", "cba"]], expected: [["ab"], ["abc", "cba"]], hidden: true },
    ],
    comparison: "exact",
    hints: [
      "Two variants differ in order but agree on something. What is that something?",
      "You need a value that is identical for every member of a group and different across groups.",
      "Sorting the characters of a word gives you such a key.",
      "Bucket by the sorted-character key, then apply the two sorting rules the prompt specifies.",
    ],
    followUps: [
      "The sorted-string key costs O(k log k) per word. What key would be O(k)?",
      "What changes if comparison had to ignore case and non-letters?",
    ],
    optimal: { time: "O(n k log k)", space: "O(n k)" },
    source: "bank",
  },
  {
    id: "top-errors",
    title: "Top error codes",
    prompt: `Given a list of error codes emitted by a service, return the \`k\` most frequent. Break ties by code, alphabetically ascending. If there are fewer than \`k\` distinct codes, return all of them.

\`\`\`
top_errors(["500","404","500","403","404","500"], 2)  ->  ["500", "404"]
top_errors(["b","a"], 2)                              ->  ["a", "b"]
\`\`\``,
    difficulty: "medium",
    jobLevels: ["entry", "mid"],
    roles: ["general", "backend", "data", "infra"],
    topics: ["counting", "sorting", "tie-breaking"],
    functionName: "top_errors",
    starter: {
      python: `def top_errors(codes, k):\n    """The k most frequent codes, ties broken alphabetically ascending."""\n    pass\n`,
      javascript: `function top_errors(codes, k) {\n  // The k most frequent codes, ties broken alphabetically ascending.\n}\n`,
    },
    reference: {
      python: `def top_errors(codes, k):\n    counts = {}\n    for c in codes:\n        counts[c] = counts.get(c, 0) + 1\n    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))\n    return [c for c, _ in ordered[:k]]\n`,
      javascript: `function top_errors(codes, k) {\n  const counts = new Map();\n  for (const c of codes) counts.set(c, (counts.get(c) || 0) + 1);\n  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));\n  return ordered.slice(0, k).map((e) => e[0]);\n}\n`,
    },
    tests: [
      { name: "example", args: [["500", "404", "500", "403", "404", "500"], 2], expected: ["500", "404"] },
      { name: "all tied", args: [["b", "a"], 2], expected: ["a", "b"] },
      { name: "k larger than distinct", args: [["a", "a", "b"], 5], expected: ["a", "b"] },
      { name: "k is zero", args: [["a", "b"], 0], expected: [] },
      { name: "empty input", args: [[], 3], expected: [] },
      { name: "tie decides the cutoff", args: [["c", "b", "a", "a"], 2], expected: ["a", "b"], hidden: true },
      { name: "single code", args: [["x", "x", "x"], 1], expected: ["x"], hidden: true },
      { name: "lexicographic not numeric", args: [["10", "9", "10", "9", "100"], 2], expected: ["10", "9"], hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What happens when two codes have the same count? Pin that down before coding.",
      "You need counts first. What is the natural structure for that?",
      "One comparison key can express both rules at once.",
      "Sort the (code, count) pairs by count descending then code ascending, and take the first k.",
    ],
    followUps: [
      "Sorting is O(m log m) in the number of distinct codes. Can you do better when k is small?",
      "How would you maintain this over a stream where old events expire?",
    ],
    optimal: { time: "O(n + m log m)", space: "O(m)" },
    source: "bank",
  },
  {
    id: "spiral-seating",
    title: "Spiral seating order",
    prompt: `An event seats guests in a rectangular grid, filling it in a clockwise spiral: across the top row, down the right column, back along the bottom, up the left, then inward.

Given the grid of seat labels, return them in the order they are filled.

\`\`\`
spiral_order([[1,2,3],[4,5,6],[7,8,9]])  ->  [1,2,3,6,9,8,7,4,5]
\`\`\`

The grid is rectangular; it may be empty.`,
    difficulty: "medium",
    jobLevels: ["entry", "mid", "senior"],
    roles: ["general", "frontend"],
    topics: ["matrix", "boundaries"],
    functionName: "spiral_order",
    starter: {
      python: `def spiral_order(grid):\n    """Return grid values in clockwise spiral order."""\n    pass\n`,
      javascript: `function spiral_order(grid) {\n  // Return grid values in clockwise spiral order.\n}\n`,
    },
    reference: {
      python: `def spiral_order(grid):\n    if not grid or not grid[0]:\n        return []\n    top, bottom = 0, len(grid) - 1\n    left, right = 0, len(grid[0]) - 1\n    out = []\n    while top <= bottom and left <= right:\n        for c in range(left, right + 1):\n            out.append(grid[top][c])\n        top += 1\n        for r in range(top, bottom + 1):\n            out.append(grid[r][right])\n        right -= 1\n        if top <= bottom:\n            for c in range(right, left - 1, -1):\n                out.append(grid[bottom][c])\n            bottom -= 1\n        if left <= right:\n            for r in range(bottom, top - 1, -1):\n                out.append(grid[r][left])\n            left += 1\n    return out\n`,
      javascript: `function spiral_order(grid) {\n  if (grid.length === 0 || grid[0].length === 0) return [];\n  let top = 0, bottom = grid.length - 1, left = 0, right = grid[0].length - 1;\n  const out = [];\n  while (top <= bottom && left <= right) {\n    for (let c = left; c <= right; c++) out.push(grid[top][c]);\n    top++;\n    for (let r = top; r <= bottom; r++) out.push(grid[r][right]);\n    right--;\n    if (top <= bottom) {\n      for (let c = right; c >= left; c--) out.push(grid[bottom][c]);\n      bottom--;\n    }\n    if (left <= right) {\n      for (let r = bottom; r >= top; r--) out.push(grid[r][left]);\n      left++;\n    }\n  }\n  return out;\n}\n`,
    },
    tests: [
      { name: "3x3", args: [[[1, 2, 3], [4, 5, 6], [7, 8, 9]]], expected: [1, 2, 3, 6, 9, 8, 7, 4, 5] },
      { name: "empty grid", args: [[]], expected: [] },
      { name: "single cell", args: [[[7]]], expected: [7] },
      { name: "single row", args: [[[1, 2, 3, 4]]], expected: [1, 2, 3, 4] },
      { name: "single column", args: [[[1], [2], [3]]], expected: [1, 2, 3] },
      { name: "row of empties", args: [[[], []]], expected: [], hidden: true },
      { name: "2x4", args: [[[1, 2, 3, 4], [5, 6, 7, 8]]], expected: [1, 2, 3, 4, 8, 7, 6, 5], hidden: true },
      { name: "4x3", args: [[[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]], expected: [1, 2, 3, 6, 9, 12, 11, 10, 7, 4, 5, 8], hidden: true },
      { name: "3x2", args: [[[1, 2], [3, 4], [5, 6]]], expected: [1, 2, 4, 6, 5, 3], hidden: true },
    ],
    comparison: "exact",
    hints: [
      "What state describes 'the part of the grid I have not visited yet'?",
      "Four boundaries — top, bottom, left, right — that close inward.",
      "The two inner passes need guards. Think about a grid that is one row tall.",
      "After walking the top row and right column, check that a row and a column still remain before walking back and up.",
    ],
    followUps: [
      "Which test case catches the missing guard on the bottom and left passes?",
      "How would you generalize this to spiral outward from the center?",
    ],
    optimal: { time: "O(rows * cols)", space: "O(1) extra" },
    source: "bank",
  },
  {
    id: "min-truck-capacity",
    title: "Smallest truck that finishes on time",
    prompt: `Packages sit on a conveyor **in a fixed order** and must be shipped in that order. Each day a truck is loaded with a contiguous run of packages from the front, and the run's total weight may not exceed the truck's capacity.

Return the **smallest capacity** that lets you ship everything within \`days\` days.

\`\`\`
min_capacity([1,2,3,4,5,6,7,8,9,10], 5)  ->  15
min_capacity([3,2,2,4,1,4], 3)           ->  6
\`\`\`

Constraints: weights are positive integers, \`1 <= days <= len(loads)\`.`,
    difficulty: "medium",
    jobLevels: ["mid", "senior", "staff"],
    roles: ["general", "backend", "infra"],
    topics: ["binary search on the answer", "greedy check"],
    functionName: "min_capacity",
    starter: {
      python: `def min_capacity(loads, days):\n    """Smallest per-day capacity that ships loads in order within days days."""\n    pass\n`,
      javascript: `function min_capacity(loads, days) {\n  // Smallest per-day capacity that ships loads in order within days days.\n}\n`,
    },
    reference: {
      python: `def min_capacity(loads, days):\n    def fits(cap):\n        used = 1\n        current = 0\n        for w in loads:\n            if current + w > cap:\n                used += 1\n                current = 0\n            current += w\n        return used <= days\n\n    lo = max(loads) if loads else 0\n    hi = sum(loads)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if fits(mid):\n            hi = mid\n        else:\n            lo = mid + 1\n    return lo\n`,
      javascript: `function min_capacity(loads, days) {\n  const fits = (cap) => {\n    let used = 1, current = 0;\n    for (const w of loads) {\n      if (current + w > cap) { used += 1; current = 0; }\n      current += w;\n    }\n    return used <= days;\n  };\n  let lo = loads.length ? Math.max(...loads) : 0;\n  let hi = loads.reduce((a, b) => a + b, 0);\n  while (lo < hi) {\n    const mid = Math.floor((lo + hi) / 2);\n    if (fits(mid)) hi = mid; else lo = mid + 1;\n  }\n  return lo;\n}\n`,
    },
    tests: [
      { name: "example one", args: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5], expected: 15 },
      { name: "example two", args: [[3, 2, 2, 4, 1, 4], 3], expected: 6 },
      { name: "one day", args: [[1, 2, 3], 1], expected: 6 },
      { name: "one package per day", args: [[3, 1, 4], 3], expected: 4 },
      { name: "single package", args: [[9], 1], expected: 9 },
      { name: "equal weights", args: [[5, 5, 5, 5], 2], expected: 10, hidden: true },
      { name: "one heavy package forces a bigger truck", args: [[1, 1, 100, 1], 2], expected: 101, hidden: true },
      { name: "more days than needed", args: [[2, 2, 2], 3], expected: 2, hidden: true },
      { name: "uneven split", args: [[7, 2, 5, 10, 8], 2], expected: 18, hidden: true },
    ],
    comparison: "exact",
    hints: [
      "Suppose someone hands you a capacity. How expensive is it to check whether it works?",
      "Is the check monotonic — if capacity C works, does C + 1 work?",
      "That monotonicity means you can search over the answer instead of constructing it.",
      "Binary search capacity between max(loads) and sum(loads), using a greedy left-to-right packing as the feasibility test.",
    ],
    followUps: [
      "Why is the lower bound max(loads) and not 1?",
      "What is the total complexity, counting both the search and the check?",
    ],
    optimal: { time: "O(n log(sum))", space: "O(1)" },
    source: "bank",
  },
];
