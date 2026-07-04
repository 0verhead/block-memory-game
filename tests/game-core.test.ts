import { describe, expect, it } from "vitest";
import { MODES, buildPattern, evaluateCount, evaluatePattern, getLevelConfig, pointsForRound } from "../src/lib/game-core";

describe("game difficulty", () => {
  it.each([MODES.COUNT, MODES.PATTERN])("%s gets harder every level", (mode) => {
    let previous = getLevelConfig(1, mode);

    for (let level = 2; level <= 60; level += 1) {
      const config = getLevelConfig(level, mode);

      expect(config.mode).toBe(mode);
      expect(config.totalCells).toBeGreaterThanOrEqual(config.activeCount);
      expect(config.previewMs).toBeGreaterThanOrEqual(mode === MODES.PATTERN ? 700 : 600);
      expect(config.difficultyScore).toBeGreaterThan(previous.difficultyScore);
      expect(config.activeCount).toBeGreaterThan(previous.activeCount);

      previous = config;
    }
  });
});

describe("pattern generation", () => {
  it("creates deterministic unique pattern indices for a seed", () => {
    const pattern = buildPattern(16, 6, 1234);

    expect(pattern).toHaveLength(6);
    expect(new Set(pattern)).toHaveProperty("size", 6);
    expect(pattern).toEqual(buildPattern(16, 6, 1234));
    expect(pattern.every((index) => index >= 0 && index < 16)).toBe(true);
  });
});

describe("round evaluation", () => {
  it("evaluates count guesses exactly", () => {
    expect(evaluateCount(7, 7)).toEqual({
      correct: true,
      difference: 0,
      guess: 7,
      answer: 7,
    });

    expect(evaluateCount(7, 5).correct).toBe(false);
    expect(evaluateCount(7, "x").guess).toBeNull();
    expect(evaluateCount(7, "")).toMatchObject({ correct: false, difference: 7, guess: 0 });
  });

  it("evaluates exact pattern reconstruction", () => {
    const evaluation = evaluatePattern([1, 3, 5], [1, 2, 5]);

    expect(evaluation.correct).toBe(false);
    expect(evaluation.hits).toEqual([1, 5]);
    expect(evaluation.misses).toEqual([3]);
    expect(evaluation.falsePositives).toEqual([2]);
    expect(evaluatePattern([1, 3, 5], [1, 3, 5]).correct).toBe(true);
  });
});

describe("scoring", () => {
  it("awards points only for correct answers", () => {
    expect(pointsForRound(3, MODES.COUNT, 2, true)).toBe(1025);
    expect(pointsForRound(3, MODES.COUNT, 2, false)).toBe(0);
  });
});
