<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    MODES,
    buildPattern,
    evaluateCount,
    evaluatePattern,
    getLevelConfig,
    pointsForRound,
    type GameMode,
    type LevelConfig,
    type RoundEvaluation,
  } from "./lib/game-core";
  import { finishRun, loadStats, recordRound, startRun, type GameStats } from "./lib/storage";

  type Phase = "ready" | "preview" | "input" | "reveal" | "gameover";

  type Round = {
    config: LevelConfig;
    pattern: number[];
  };

  type EvaluationState = RoundEvaluation & {
    points?: number;
    trainingRetry?: boolean;
  };

  const modeNames: Record<GameMode, string> = {
    count: "Count",
    pattern: "Pattern",
  };

  let mode: GameMode = MODES.COUNT;
  let training = false;
  let phase: Phase = "ready";
  let level = 1;
  let score = 0;
  let streak = 0;
  let countGuess = 0;
  let activeRunId: string | null = null;
  let pendingRunPromise: Promise<string | null> | null = null;
  let round: Round | null = null;
  let selected = new Set<number>();
  let lastEvaluation: EvaluationState | null = null;
  let stats: GameStats = {
    bestCountScore: 0,
    bestPatternScore: 0,
    totalRuns: 0,
    totalRounds: 0,
    trainingRounds: 0,
  };
  let storageState: "loading" | "ready" | "error" = "loading";
  let storageError = "";
  let previewTimer: number | null = null;

  $: currentConfig = round?.config ?? getLevelConfig(level, mode);
  $: bestScore = mode === MODES.COUNT ? stats.bestCountScore : stats.bestPatternScore;
  $: selectedCount = selected.size;
  $: primaryLabel = getPrimaryLabel(phase, lastEvaluation);
  $: resultText = getResultText(storageState, storageError, lastEvaluation, mode, phase, score, training);
  $: phaseLabel = getPhaseLabel(phase, mode, lastEvaluation);

  onMount(async () => {
    await refreshStats();
  });

  onDestroy(() => {
    clearPreviewTimer();
  });

  async function refreshStats() {
    try {
      stats = await loadStats();
      storageState = "ready";
      storageError = "";
    } catch (error) {
      storageState = "error";
      storageError = error instanceof Error ? error.message : "Unable to load local database";
    }
  }

  function clearPreviewTimer() {
    if (previewTimer !== null) {
      window.clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function createRound(): Round {
    const config = getLevelConfig(level, mode);
    const seed = Date.now() + level * 1009 + score * 17;
    return {
      config,
      pattern: buildPattern(config.totalCells, config.activeCount, seed),
    };
  }

  function reportStorageError(error: unknown, fallback: string) {
    storageState = "error";
    storageError = error instanceof Error ? error.message : fallback;
  }

  function beginRunPersistence() {
    if (activeRunId || pendingRunPromise) {
      return;
    }

    const runMode = mode;
    const runTraining = training;
    pendingRunPromise = startRun(runMode, runTraining)
      .then(async (runId) => {
        activeRunId = runId;
        storageState = "ready";
        storageError = "";
        await refreshStats();
        return runId;
      })
      .catch((error) => {
        reportStorageError(error, "Unable to save run history");
        return null;
      })
      .finally(() => {
        pendingRunPromise = null;
      });
  }

  async function resolveRunIdForPersistence(): Promise<string | null> {
    if (activeRunId) {
      return activeRunId;
    }

    if (!pendingRunPromise) {
      beginRunPersistence();
    }

    return pendingRunPromise;
  }

  function startRound() {
    beginRunPersistence();
    clearPreviewTimer();
    round = createRound();
    selected = new Set();
    lastEvaluation = null;
    phase = "preview";
    countGuess = 0;

    previewTimer = window.setTimeout(() => {
      phase = "input";
      previewTimer = null;
    }, round.config.previewMs);
  }

  function finishPersistedRun(status: "abandoned" | "completed" | "failed", finalScore: number, highestLevel: number) {
    const runId = activeRunId;
    const runPromise = pendingRunPromise;
    activeRunId = null;
    pendingRunPromise = null;

    if (runId) {
      void finishRun(runId, status, finalScore, highestLevel)
        .then(refreshStats)
        .catch((error) => reportStorageError(error, "Unable to save run history"));
      return;
    }

    if (runPromise) {
      void runPromise
        .then((resolvedRunId) => {
          if (!resolvedRunId) return undefined;
          return finishRun(resolvedRunId, status, finalScore, highestLevel);
        })
        .then(refreshStats)
        .catch((error) => reportStorageError(error, "Unable to save run history"));
    }
  }

  function resetRun(status: "abandoned" | "completed" = "abandoned", nextMode: GameMode = mode) {
    clearPreviewTimer();
    finishPersistedRun(status, score, Math.max(1, level));
    mode = nextMode;
    phase = "ready";
    level = 1;
    score = 0;
    streak = 0;
    countGuess = 0;
    round = null;
    selected = new Set();
    lastEvaluation = null;
  }

  function persistFinishedRound(
    runSnapshot: Round,
    completedLevel: number,
    scoreAfter: number,
    streakAfter: number,
    selectedValues: number[],
    guess: number | null,
    evaluation: RoundEvaluation,
    statusAfterRound: "active" | "failed"
  ) {
    void resolveRunIdForPersistence()
      .then(async (runId) => {
        if (!runId) {
          return;
        }

        await recordRound({
          runId,
          mode,
          training,
          level: completedLevel,
          scoreAfter,
          streakAfter,
          config: runSnapshot.config,
          pattern: runSnapshot.pattern,
          selected: selectedValues,
          guess,
          evaluation,
        });

        if (statusAfterRound === "failed") {
          await finishRun(runId, "failed", scoreAfter, completedLevel);
          if (activeRunId === runId) {
            activeRunId = null;
          }
        }

        await refreshStats();
      })
      .catch((error) => reportStorageError(error, "Unable to save round history"));
  }

  function finishCurrentRound(evaluation: RoundEvaluation) {
    if (!round) {
      return;
    }

    const runSnapshot = round;
    const completedLevel = level;
    const selectedValues = Array.from(selected).sort((a, b) => a - b);
    const guess = mode === MODES.COUNT ? Number(countGuess) : null;
    const nextEvaluation: EvaluationState = { ...evaluation };
    let statusAfterRound: "active" | "failed" = "active";

    phase = "reveal";

    if (evaluation.correct) {
      const gained = pointsForRound(level, mode, streak, true);
      score += gained;
      streak += 1;
      level += 1;
      nextEvaluation.points = gained;
    } else {
      streak = 0;
      if (training) {
        nextEvaluation.trainingRetry = true;
      } else {
        phase = "gameover";
        statusAfterRound = "failed";
      }
    }

    lastEvaluation = nextEvaluation;

    persistFinishedRound(runSnapshot, completedLevel, score, streak, selectedValues, guess, evaluation, statusAfterRound);
  }

  async function submitAnswer() {
    if (phase === "gameover") {
      resetRun("completed");
      return;
    }

    if (phase === "ready" || phase === "reveal") {
      startRound();
      return;
    }

    if (phase !== "input" || !round) {
      return;
    }

    if (mode === MODES.COUNT) {
      finishCurrentRound(evaluateCount(round.config.activeCount, countGuess));
      return;
    }

    finishCurrentRound(evaluatePattern(round.pattern, selected));
  }

  async function switchMode(nextMode: GameMode) {
    if (nextMode === mode) {
      return;
    }
    resetRun("abandoned", nextMode);
  }

  async function toggleTraining() {
    training = !training;
    if (phase !== "ready") {
      resetRun("abandoned");
    }
  }

  function toggleBlock(index: number) {
    if (phase !== "input" || mode !== MODES.PATTERN) {
      return;
    }

    const next = new Set(selected);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    selected = next;
  }

  function isTarget(index: number, currentRound: Round | null): boolean {
    return Boolean(currentRound?.pattern.includes(index));
  }

  function getBlockClass(
    index: number,
    currentPhase: Phase,
    currentMode: GameMode,
    currentRound: Round | null,
    currentSelected: Set<number>,
    config: LevelConfig
  ): string {
    const target = isTarget(index, currentRound);
    const chosen = currentSelected.has(index);
    const classes = ["block"];

    if (index % config.cols === config.cols - 1) classes.push("is-edge-right");
    if (index >= config.totalCells - config.cols) classes.push("is-edge-bottom");
    if (currentPhase === "preview" && target) classes.push("is-active");
    if (currentPhase === "input" && chosen) classes.push("is-selected");

    if ((currentPhase === "reveal" || currentPhase === "gameover") && currentRound) {
      if (target && chosen) classes.push("is-correct");
      else if (target) classes.push("is-missed");
      else if (chosen) classes.push("is-wrong");
      if (currentMode === MODES.COUNT && target) classes.push("is-active");
    }

    return classes.join(" ");
  }

  function getPhaseLabel(currentPhase: Phase, currentMode: GameMode, evaluation: EvaluationState | null): string {
    if (currentPhase === "preview") return "Preview";
    if (currentPhase === "input") return currentMode === MODES.COUNT ? "Count" : "Recall";
    if (currentPhase === "reveal") return evaluation?.correct ? "Cleared" : "Missed";
    if (currentPhase === "gameover") return "Game Over";
    return "Ready";
  }

  function getResultText(
    currentStorageState: "loading" | "ready" | "error",
    currentStorageError: string,
    evaluation: EvaluationState | null,
    currentMode: GameMode,
    currentPhase: Phase,
    currentScore: number,
    isTraining: boolean
  ): string {
    if (!evaluation) return `${modeNames[currentMode]} Mode`;
    if (currentStorageState === "error" && currentStorageError) return currentStorageError;
    if (currentPhase === "gameover") return `Final score ${currentScore}`;

    if (currentMode === MODES.COUNT) {
      if (evaluation.correct) {
        return `Correct: ${(evaluation as { answer: number }).answer} cubes +${evaluation.points}`;
      }
      const answer = (evaluation as { answer: number }).answer;
      return isTraining ? `Answer: ${answer} cubes / retry level` : `Answer: ${answer} cubes`;
    }

    if (evaluation.correct) return `Exact pattern +${evaluation.points}`;
    const patternEvaluation = evaluation as { hits: number[]; answerSize: number };
    return isTraining
      ? `${patternEvaluation.hits.length}/${patternEvaluation.answerSize} matched / retry level`
      : `${patternEvaluation.hits.length}/${patternEvaluation.answerSize} matched`;
  }

  function getPrimaryLabel(currentPhase: Phase, evaluation: EvaluationState | null): string {
    if (currentPhase === "preview") return "Watch";
    if (currentPhase === "input") return "Submit";
    if (currentPhase === "gameover") return "New Game";
    if (currentPhase === "reveal" && evaluation?.trainingRetry) return "Retry";
    if (currentPhase === "reveal") return "Next";
    return "Start";
  }
</script>

<main class={`game-shell phase-${phase}`}>
  <div class="mini-hud" aria-label="Game status">
    <span><strong>{score}</strong><small>Score</small></span>
    <span><strong>{level}</strong><small>Level</small></span>
    <span><strong>{streak}</strong><small>Streak</small></span>
  </div>

  {#if phase === "ready"}
    <section class="screen ready-screen" aria-label="Start screen">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true"></span>
        <h1>Block Memory</h1>
      </div>

      <div class="mode-switch" role="tablist" aria-label="Mode">
        <button
          class:is-active={mode === MODES.COUNT}
          type="button"
          role="tab"
          aria-selected={mode === MODES.COUNT}
          on:click={() => switchMode(MODES.COUNT)}
        >
          Count
        </button>
        <button
          class:is-active={mode === MODES.PATTERN}
          type="button"
          role="tab"
          aria-selected={mode === MODES.PATTERN}
          on:click={() => switchMode(MODES.PATTERN)}
        >
          Pattern
        </button>
      </div>

      <label class="training-toggle">
        <input type="checkbox" checked={training} on:change={toggleTraining}>
        <span>Training</span>
      </label>

      <button class="primary-button start-button" type="button" on:click={submitAnswer}>Start</button>

      <div class="ready-meta">
        <span>{modeNames[mode]} Mode</span>
        <span>{currentConfig.activeCount} cubes</span>
        <span>Best {bestScore}</span>
      </div>
    </section>
  {:else if phase === "preview"}
    <section class="screen board-screen" aria-label="Preview board">
      <div class="screen-label" aria-live="polite">
        <span>Memorize</span>
        <strong>{currentConfig.activeCount} cubes</strong>
      </div>
      <div
        class="board phase-preview"
        aria-label="Block grid"
        style={`--rows: ${currentConfig.rows}; --cols: ${currentConfig.cols};`}
      >
        {#each Array(currentConfig.totalCells) as _, index}
          <button
            type="button"
            class={getBlockClass(index, phase, mode, round, selected, currentConfig)}
            aria-label={`Block ${index + 1}`}
            disabled
          ></button>
        {/each}
      </div>
    </section>
  {:else if phase === "input" && mode === MODES.COUNT}
    <section class="screen answer-screen" aria-label="Count answer">
      <div class="screen-label">
        <span>Answer</span>
        <strong>How many cubes?</strong>
      </div>
      <input
        id="countGuess"
        class="count-input"
        type="number"
        inputmode="numeric"
        min="0"
        bind:value={countGuess}
        aria-label="Cubes"
      >
      <button class="primary-button submit-button" type="button" on:click={submitAnswer}>Submit</button>
    </section>
  {:else if phase === "input" && mode === MODES.PATTERN}
    <section class="screen pattern-screen" aria-label="Pattern answer">
      <div class="screen-label">
        <span>Rebuild</span>
        <strong>{selectedCount}/{currentConfig.activeCount} selected</strong>
      </div>
      <div
        class="board phase-input"
        aria-label="Block grid"
        style={`--rows: ${currentConfig.rows}; --cols: ${currentConfig.cols};`}
      >
        {#each Array(currentConfig.totalCells) as _, index}
          <button
            type="button"
            class={getBlockClass(index, phase, mode, round, selected, currentConfig)}
            aria-label={`Block ${index + 1}`}
            aria-pressed={selected.has(index)}
            on:click={() => toggleBlock(index)}
          ></button>
        {/each}
      </div>
      <button class="primary-button submit-button" type="button" on:click={submitAnswer}>Submit</button>
    </section>
  {:else}
    <section class="screen result-screen" aria-label="Round result">
      <div class="screen-label">
        <span>{phaseLabel}</span>
        <strong>{resultText}</strong>
      </div>
      <div
        class={`board phase-${phase}`}
        aria-label="Block grid"
        style={`--rows: ${currentConfig.rows}; --cols: ${currentConfig.cols};`}
      >
        {#each Array(currentConfig.totalCells) as _, index}
          <button
            type="button"
            class={getBlockClass(index, phase, mode, round, selected, currentConfig)}
            aria-label={`Block ${index + 1}`}
            disabled
          ></button>
        {/each}
      </div>
      <button class="primary-button submit-button" type="button" on:click={submitAnswer}>{primaryLabel}</button>
    </section>
  {/if}
</main>

<style>
  .app-shell {
    position: relative;
    min-height: 100svh;
    overflow-x: hidden;
    background:
      radial-gradient(circle at 50% 18%, rgba(255, 196, 77, 0.14), transparent 22rem),
      linear-gradient(180deg, rgba(2, 9, 14, 0.18), rgba(2, 9, 14, 0.52));
  }

  .topbar {
    position: absolute;
    z-index: 4;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: clamp(0.75rem, 1.6vw, 1rem) clamp(0.85rem, 2.2vw, 1.6rem);
    border-bottom: 0;
    background: linear-gradient(180deg, rgba(2, 12, 18, 0.9), rgba(2, 12, 18, 0));
    backdrop-filter: blur(14px);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-width: 12rem;
  }

  .brand-mark {
    width: 2.25rem;
    height: 2.25rem;
    border: 2px solid rgba(255, 255, 255, 0.72);
    background:
      linear-gradient(90deg, transparent 47%, rgba(255, 255, 255, 0.8) 48% 52%, transparent 53%),
      linear-gradient(transparent 47%, rgba(255, 255, 255, 0.8) 48% 52%, transparent 53%),
      linear-gradient(135deg, #f2f5f6, #8e969b);
    box-shadow: 0 0 18px rgba(0, 165, 184, 0.42);
  }

  h1 {
    margin: 0;
    font-size: clamp(1.15rem, 2vw, 1.65rem);
    font-weight: 850;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(4.6rem, 1fr));
    gap: 0.5rem;
    width: min(34rem, 58vw);
  }

  .stats span,
  .level-readout,
  .training-toggle,
  .result,
  .history {
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.035));
  }

  .stats span {
    display: grid;
    gap: 0.1rem;
    min-height: 3rem;
    align-content: center;
    padding: 0.35rem 0.6rem;
  }

  .stats strong {
    font-size: clamp(1.05rem, 2vw, 1.45rem);
    line-height: 1;
  }

  .stats small,
  .level-readout span,
  .pattern-count,
  label {
    color: var(--muted);
    font-size: 0.78rem;
    text-transform: uppercase;
  }

  .playfield {
    position: relative;
    display: grid;
    grid-template-areas: "board";
    min-height: 100svh;
  }

  .controls {
    grid-area: controls;
    position: absolute;
    z-index: 5;
    right: clamp(0.8rem, 2.4vw, 1.8rem);
    bottom: clamp(0.8rem, 2.4vw, 1.8rem);
    width: min(27rem, calc(100vw - 1.6rem));
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: clamp(0.9rem, 2vw, 1.25rem);
    border: 1px solid rgba(255, 255, 255, 0.18);
    background:
      linear-gradient(180deg, rgba(8, 35, 46, 0.92), rgba(3, 13, 20, 0.94)),
      var(--panel);
    backdrop-filter: blur(14px);
    box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.38), 0 0 1.8rem rgba(0, 165, 184, 0.16);
  }

  .mode-switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
    padding: 0.35rem;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.06);
  }

  .mode-switch button,
  .secondary-button,
  .primary-button,
  .number-row button {
    min-height: 2.75rem;
    color: var(--ink);
    cursor: pointer;
    transition: transform 150ms ease, background 150ms ease, border-color 150ms ease;
  }

  .mode-switch button {
    background: transparent;
    color: var(--muted);
  }

  .mode-switch button.is-active {
    background: var(--teal);
    color: #031018;
    font-weight: 800;
  }

  .level-readout {
    display: grid;
    gap: 0.35rem;
    padding: 1rem;
    background: var(--panel-strong);
  }

  .level-readout strong {
    font-size: 1.25rem;
  }

  .training-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    min-height: 2.75rem;
    padding: 0.75rem 0.9rem;
    color: var(--ink);
    cursor: pointer;
    text-transform: none;
  }

  .training-toggle input {
    width: 2.8rem;
    min-height: 1.45rem;
    accent-color: var(--amber);
  }

  .count-entry,
  .pattern-entry,
  .actions {
    display: grid;
    gap: 0.65rem;
  }

  .number-row {
    display: grid;
    grid-template-columns: 2.75rem 1fr 2.75rem;
    gap: 0.45rem;
  }

  .number-row button,
  .secondary-button {
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.08);
  }

  input {
    width: 100%;
    min-width: 0;
    min-height: 2.75rem;
    border: 1px solid var(--line);
    color: var(--ink);
    background: rgba(0, 0, 0, 0.28);
    text-align: center;
    font-size: 1.2rem;
    font-weight: 800;
  }

  .primary-button {
    background: linear-gradient(180deg, #ffe27c, var(--amber));
    color: #1d1400;
    font-weight: 850;
    box-shadow: 0 0.75rem 1.6rem rgba(255, 196, 77, 0.22);
  }

  .secondary-button {
    color: var(--ink);
  }

  button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  button:not(.block):disabled,
  input:disabled {
    cursor: not-allowed;
    opacity: 0.56;
  }

  .result {
    min-height: 3.2rem;
    padding: 0.9rem 1rem;
    border-left: 4px solid var(--teal);
    color: var(--ink);
    font-weight: 750;
  }

  .result.error {
    border-left-color: var(--coral);
  }

  .history {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.3rem;
    padding: 0.7rem;
    color: var(--muted);
    font-size: 0.78rem;
  }

  .board-wrap {
    grid-area: board;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    place-items: center;
    gap: 0.9rem;
    min-width: 0;
    min-height: 100svh;
    padding: clamp(5.4rem, 9vh, 7rem) clamp(1rem, 4vw, 2.6rem) clamp(8.5rem, 20vh, 12rem);
  }

  .arena-hud {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.8rem;
    min-width: min(28rem, 92vw);
    padding: 0.55rem 0.8rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(2, 11, 17, 0.74);
    box-shadow: 0 0.75rem 1.8rem rgba(0, 0, 0, 0.22);
    text-transform: uppercase;
  }

  .arena-hud span {
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 800;
  }

  .arena-hud strong {
    color: var(--amber);
    font-size: 0.95rem;
    letter-spacing: 0;
  }

  .board {
    --rows: 3;
    --cols: 3;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
    gap: clamp(0.25rem, 0.7vw, 0.48rem);
    width: min(78vmin, calc(var(--cols) * 5.7rem), 48rem);
    aspect-ratio: var(--cols) / var(--rows);
    padding: clamp(0.45rem, 1vw, 0.75rem);
    border: 3px solid rgba(248, 251, 255, 0.9);
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.03)),
      #06151d;
    box-shadow:
      0 1.4rem 3.5rem rgba(0, 0, 0, 0.46),
      0 0 0 0.5rem rgba(3, 12, 18, 0.72),
      0 0 2.4rem rgba(0, 165, 184, 0.45);
    transition: box-shadow 160ms ease, transform 160ms ease;
  }

  .board.phase-preview {
    box-shadow:
      0 1.4rem 3.5rem rgba(0, 0, 0, 0.46),
      0 0 0 0.5rem rgba(3, 12, 18, 0.72),
      0 0 3.2rem rgba(255, 196, 77, 0.45);
    transform: scale(1.01);
  }

  .block {
    position: relative;
    min-width: 0;
    min-height: 0;
    border: 1px solid rgba(255, 255, 255, 0.34);
    cursor: default;
    background:
      radial-gradient(circle at 28% 21%, rgba(255, 255, 255, 0.98), transparent 21%),
      linear-gradient(135deg, #ffffff, var(--cube) 44%, #7c878f);
    box-shadow:
      inset 0.45rem 0.45rem 1rem rgba(255, 255, 255, 0.72),
      inset -0.72rem -0.78rem 1.1rem rgba(12, 22, 30, 0.34),
      0 0.28rem 0 rgba(0, 0, 0, 0.28);
    transition: background 120ms ease, box-shadow 120ms ease, transform 120ms ease, outline-color 120ms ease;
  }

  .block:not(:disabled) {
    cursor: pointer;
  }

  .block.is-edge-right {
    border-right-color: rgba(255, 255, 255, 0.34);
  }

  .block.is-edge-bottom {
    border-bottom-color: rgba(255, 255, 255, 0.34);
  }

  .block::after {
    content: "";
    position: absolute;
    inset: 12%;
    border: 1px solid rgba(255, 255, 255, 0.24);
    opacity: 0;
  }

  .block:not(:disabled):hover::after,
  .block.is-selected::after {
    opacity: 1;
  }

  .block.is-active {
    background:
      radial-gradient(circle at 50% 44%, rgba(255, 255, 255, 0.7), transparent 15%),
      radial-gradient(circle at 50% 52%, rgba(0, 229, 255, 0.96), transparent 35%),
      linear-gradient(135deg, #031118, var(--cube-dark) 58%, #04080c);
    box-shadow:
      inset 0.35rem 0.35rem 1rem rgba(0, 229, 255, 0.2),
      inset -0.6rem -0.7rem 1rem rgba(0, 0, 0, 0.45),
      0 0 0 2px rgba(255, 196, 77, 0.88),
      0 0 1.35rem rgba(0, 229, 255, 0.85);
    transform: translateY(-2px);
  }

  .block.is-selected {
    outline: 4px solid var(--amber);
    outline-offset: -7px;
  }

  .block.is-correct {
    outline: 4px solid var(--green);
    outline-offset: -7px;
    background:
      radial-gradient(circle at 50% 45%, rgba(88, 214, 141, 0.95), transparent 25%),
      linear-gradient(135deg, #052017, #10402d 58%, #07140f);
  }

  .block.is-wrong {
    outline: 4px solid var(--coral);
    outline-offset: -7px;
    background:
      radial-gradient(circle at 50% 45%, rgba(255, 107, 95, 0.9), transparent 25%),
      linear-gradient(135deg, #29100d, #59231f 58%, #150807);
  }

  .block.is-missed {
    outline: 4px solid var(--violet);
    outline-offset: -7px;
    background:
      radial-gradient(circle at 50% 45%, rgba(181, 167, 255, 0.92), transparent 25%),
      linear-gradient(135deg, #111026, #302b63 58%, #070713);
  }

  @media (max-width: 820px) {
    .app-shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }

    .topbar {
      position: static;
      align-items: stretch;
      flex-direction: column;
      background: rgba(2, 12, 18, 0.88);
    }

    .brand {
      min-width: 0;
    }

    .stats {
      width: 100%;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .playfield {
      grid-template-areas:
        "board"
        "controls";
      grid-template-columns: 1fr;
      grid-template-rows: auto auto;
      min-height: auto;
    }

    .controls {
      position: static;
      width: auto;
      margin: 0 0.85rem 0.85rem;
      border-right: 1px solid rgba(255, 255, 255, 0.18);
      border-top: 1px solid var(--line);
      border-bottom: 0;
    }

    .board-wrap {
      align-items: center;
      min-height: auto;
      padding: 1rem 0.85rem 0.85rem;
    }

    .board {
      width: min(92vw, 26rem);
    }
  }

  @media (max-width: 520px) {
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .controls {
      gap: 0.8rem;
      padding: 0.85rem;
    }

    .board {
      width: min(92vw, 22.5rem);
      gap: 0.24rem;
      padding: 0.42rem;
    }

    .arena-hud {
      min-width: min(92vw, 22.5rem);
    }

    .topbar {
      gap: 0.7rem;
      padding: 0.7rem 0.85rem;
    }
  }

  .game-shell {
    position: relative;
    display: grid;
    min-height: 100svh;
    overflow-x: hidden;
    color: var(--ink);
    background:
      radial-gradient(circle at 50% 28%, rgba(0, 229, 255, 0.18), transparent 17rem),
      radial-gradient(circle at 50% 78%, rgba(255, 196, 77, 0.18), transparent 20rem),
      linear-gradient(180deg, rgba(2, 9, 14, 0.1), rgba(2, 9, 14, 0.72));
  }

  .mini-hud {
    position: fixed;
    z-index: 10;
    top: max(0.75rem, env(safe-area-inset-top));
    left: 50%;
    display: grid;
    grid-template-columns: repeat(3, minmax(4.6rem, 1fr));
    gap: 0.35rem;
    width: min(27rem, calc(100vw - 1.5rem));
    transform: translateX(-50%);
    pointer-events: none;
  }

  .mini-hud span {
    display: grid;
    gap: 0.05rem;
    min-height: 2.8rem;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(2, 12, 18, 0.72);
    box-shadow: 0 0.7rem 1.8rem rgba(0, 0, 0, 0.24);
  }

  .mini-hud strong {
    font-size: 1.08rem;
    line-height: 1;
  }

  .mini-hud small {
    color: var(--muted);
    font-size: 0.68rem;
    text-transform: uppercase;
  }

  .screen {
    display: grid;
    width: min(100vw, 62rem);
    min-height: 100svh;
    margin-inline: auto;
    padding: max(4.6rem, env(safe-area-inset-top)) clamp(1rem, 4vw, 2.5rem) max(1rem, env(safe-area-inset-bottom));
    place-items: center;
  }

  .ready-screen,
  .answer-screen {
    align-content: center;
    gap: 1rem;
    width: min(100vw, 32rem);
  }

  .board-screen,
  .pattern-screen,
  .result-screen {
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: clamp(0.8rem, 2vh, 1.2rem);
  }

  .brand-lockup {
    display: grid;
    justify-items: center;
    gap: 0.75rem;
  }

  .brand-lockup .brand-mark {
    width: 3.25rem;
    height: 3.25rem;
  }

  .brand-lockup h1 {
    margin: 0;
    text-align: center;
    font-size: clamp(2.2rem, 8vw, 4.5rem);
    line-height: 0.95;
  }

  .screen-label {
    display: grid;
    justify-items: center;
    gap: 0.18rem;
    text-align: center;
    text-transform: uppercase;
  }

  .screen-label span {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 850;
  }

  .screen-label strong {
    color: var(--ink);
    font-size: clamp(1.35rem, 4vw, 2.35rem);
    line-height: 1.08;
  }

  .ready-meta {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    color: var(--muted);
    font-size: 0.78rem;
    text-transform: uppercase;
  }

  .ready-meta span {
    padding: 0.4rem 0.55rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(2, 12, 18, 0.5);
  }

  .mode-switch {
    width: min(100%, 22rem);
  }

  .mode-switch button,
  .primary-button {
    min-height: 3.1rem;
  }

  .training-toggle {
    width: min(100%, 22rem);
  }

  .start-button,
  .submit-button {
    width: min(100%, 22rem);
  }

  .count-input {
    width: min(100%, 15rem);
    min-height: 5rem;
    font-size: clamp(2.2rem, 12vw, 4rem);
    border: 2px solid rgba(255, 255, 255, 0.24);
    background: rgba(0, 0, 0, 0.34);
  }

  .board {
    width: min(78svmin, calc(var(--cols) * 5.7rem), 48rem);
    align-self: center;
  }

  .pattern-screen .board {
    width: min(68svmin, calc(var(--cols) * 5.2rem), 42rem);
  }

  .result-screen .board {
    width: min(58svmin, calc(var(--cols) * 4.5rem), 34rem);
  }

  .result-screen .screen-label strong {
    max-width: 28rem;
  }

  @media (max-width: 720px) {
    .mini-hud {
      position: static;
      width: auto;
      padding: 0.65rem 0.75rem 0;
      transform: none;
    }

    .game-shell {
      align-content: start;
    }

    .screen {
      min-height: calc(100svh - 3.45rem);
      padding: 0.8rem 0.9rem max(0.8rem, env(safe-area-inset-bottom));
    }

    .ready-screen,
    .answer-screen {
      gap: 0.8rem;
    }

    .board {
      width: min(92vw, 25rem);
    }

    .pattern-screen .board,
    .result-screen .board {
      width: min(90vw, 24rem);
    }

    .brand-lockup h1 {
      font-size: clamp(2rem, 12vw, 3.3rem);
    }
  }

  @media (max-height: 620px) and (orientation: landscape) {
    .screen {
      padding-top: 0.75rem;
      min-height: 100svh;
    }

    .mini-hud {
      position: fixed;
      left: 0.75rem;
      top: 0.75rem;
      width: 15rem;
      transform: none;
    }

    .board {
      width: min(68svh, 29rem);
    }

    .ready-screen,
    .answer-screen {
      padding-left: 17rem;
    }
  }
</style>
