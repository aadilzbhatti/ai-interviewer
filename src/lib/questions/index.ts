import type { Difficulty, InterviewConfig, Question } from "../types";
import { EASY } from "./easy";
import { MEDIUM } from "./medium";
import { HARD } from "./hard";

export const BANK: Question[] = [...EASY, ...MEDIUM, ...HARD];

export function byId(id: string): Question | undefined {
  return BANK.find((q) => q.id === id);
}

function score(q: Question, config: InterviewConfig): number {
  let s = 0;
  if (q.difficulty === config.difficulty) s += 100;
  else s += 20;
  if (q.jobLevels.includes(config.jobLevel)) s += 40;
  if (q.roles.includes(config.role)) s += 25;
  if (config.role === "general" && q.roles.includes("general")) s += 10;
  return s;
}

/**
 * Pick a question from the bank for this config. `exclude` lets the caller
 * avoid repeating questions the candidate has already seen. Among the best
 * scoring candidates the choice is random, so repeat sessions vary.
 */
export function pickFromBank(
  config: InterviewConfig,
  exclude: string[] = [],
): Question | undefined {
  const pool = BANK.filter((q) => !exclude.includes(q.id));
  if (pool.length === 0) return undefined;
  const scored = pool.map((q) => ({ q, s: score(q, config) }));
  const best = Math.max(...scored.map((x) => x.s));
  const top = scored.filter((x) => x.s === best).map((x) => x.q);
  return top[Math.floor(Math.random() * top.length)];
}

export function bankCounts(): Record<Difficulty, number> {
  return {
    easy: EASY.length,
    medium: MEDIUM.length,
    hard: HARD.length,
  };
}
