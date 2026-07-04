export const MODES = {
  COUNT: "count",
  PATTERN: "pattern",
} as const;

export type GameMode = (typeof MODES)[keyof typeof MODES];

export type LevelConfig = {
  level: number;
  mode: GameMode;
  rows: number;
  cols: number;
  totalCells: number;
  activeCount: number;
  previewMs: number;
  difficultyScore: number;
};

export type CountEvaluation = {
  correct: boolean;
  difference: number;
  guess: number | null;
  answer: number;
};

export type PatternEvaluation = {
  correct: boolean;
  hits: number[];
  misses: number[];
  falsePositives: number[];
  answerSize: number;
  selectedSize: number;
};

export type RoundEvaluation = CountEvaluation | PatternEvaluation;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 1;
  }
  return Math.max(1, Math.floor(level));
}

export function normalizeMode(mode: string): GameMode {
  return mode === MODES.PATTERN ? MODES.PATTERN : MODES.COUNT;
}

export function getLevelConfig(level: number, mode: string): LevelConfig {
  const safeLevel = normalizeLevel(level);
  const safeMode = normalizeMode(mode);
  const base = safeMode === MODES.PATTERN ? 2 : 3;
  const densityCap = safeMode === MODES.PATTERN ? 0.56 : 0.64;
  const activeCount = base + safeLevel;
  const neededCells = Math.ceil(activeCount / densityCap);
  const cols = Math.max(3, Math.ceil(Math.sqrt(neededCells * 1.18)));
  const rows = Math.max(3, Math.ceil(neededCells / cols));
  const totalCells = rows * cols;
  const previewFloor = safeMode === MODES.PATTERN ? 700 : 600;
  const previewBonus = safeMode === MODES.PATTERN ? 240 : 0;
  const previewMs = Math.max(previewFloor, 2600 + previewBonus - (safeLevel - 1) * 90 - (totalCells - 9) * 5);
  const difficultyScore = safeLevel * 30 + activeCount * 90 + totalCells * 7 + Math.round((3000 - previewMs) / 8);

  return {
    level: safeLevel,
    mode: safeMode,
    rows,
    cols,
    totalCells,
    activeCount,
    previewMs,
    difficultyScore,
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function nextRandom() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildPattern(totalCells: number, activeCount: number, seed = Date.now()): number[] {
  const total = Math.max(1, Math.floor(totalCells));
  const count = clamp(Math.floor(activeCount), 0, total);
  const random = mulberry32(seed);
  const indices = Array.from({ length: total }, (_, index) => index);

  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = indices[index];
    indices[index] = indices[swapIndex];
    indices[swapIndex] = current;
  }

  return indices.slice(0, count).sort((a, b) => a - b);
}

export function evaluateCount(activeCount: number, guess: number | string): CountEvaluation {
  const parsed = Number(guess);
  const isWholeNumber = Number.isInteger(parsed) && parsed >= 0;
  const difference = isWholeNumber ? Math.abs(activeCount - parsed) : Infinity;

  return {
    correct: isWholeNumber && difference === 0,
    difference,
    guess: isWholeNumber ? parsed : null,
    answer: activeCount,
  };
}

function toSet(values: Iterable<number>): Set<number> {
  return new Set(Array.from(values).map(Number));
}

export function evaluatePattern(targetIndices: Iterable<number>, selectedIndices: Iterable<number>): PatternEvaluation {
  const target = toSet(targetIndices);
  const selected = toSet(selectedIndices);
  const hits: number[] = [];
  const misses: number[] = [];
  const falsePositives: number[] = [];

  target.forEach((index) => {
    if (selected.has(index)) {
      hits.push(index);
    } else {
      misses.push(index);
    }
  });

  selected.forEach((index) => {
    if (!target.has(index)) {
      falsePositives.push(index);
    }
  });

  return {
    correct: misses.length === 0 && falsePositives.length === 0,
    hits: hits.sort((a, b) => a - b),
    misses: misses.sort((a, b) => a - b),
    falsePositives: falsePositives.sort((a, b) => a - b),
    answerSize: target.size,
    selectedSize: selected.size,
  };
}

export function pointsForRound(level: number, mode: string, streak: number, correct: boolean): number {
  if (!correct) {
    return 0;
  }

  const safeLevel = normalizeLevel(level);
  const safeMode = normalizeMode(mode);
  const modeBonus = safeMode === MODES.PATTERN ? 250 : 0;
  return 500 + safeLevel * 125 + Math.max(0, streak) * 75 + modeBonus;
}
