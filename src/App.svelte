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

  async function ensureRun() {
    if (!activeRunId) {
      activeRunId = await startRun(mode, training);
      await refreshStats();
    }
  }

  async function startRound() {
    try {
      await ensureRun();
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
    } catch (error) {
      storageState = "error";
      storageError = error instanceof Error ? error.message : "Unable to start run";
    }
  }

  async function resetRun(status: "abandoned" | "completed" = "abandoned", nextMode: GameMode = mode) {
    clearPreviewTimer();
    if (activeRunId) {
      await finishRun(activeRunId, status, score, Math.max(1, level));
    }
    activeRunId = null;
    mode = nextMode;
    phase = "ready";
    level = 1;
    score = 0;
    streak = 0;
    countGuess = 0;
    round = null;
    selected = new Set();
    lastEvaluation = null;
    await refreshStats();
  }

  async function finishCurrentRound(evaluation: RoundEvaluation) {
    if (!round || !activeRunId) {
      return;
    }

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

    await recordRound({
      runId: activeRunId,
      mode,
      training,
      level: completedLevel,
      scoreAfter: score,
      streakAfter: streak,
      config: round.config,
      pattern: round.pattern,
      selected: selectedValues,
      guess,
      evaluation,
    });

    if (statusAfterRound === "failed") {
      await finishRun(activeRunId, "failed", score, completedLevel);
      activeRunId = null;
    }

    await refreshStats();
  }

  async function submitAnswer() {
    if (phase === "gameover") {
      await resetRun("completed");
      await startRound();
      return;
    }

    if (phase === "ready" || phase === "reveal") {
      await startRound();
      return;
    }

    if (phase !== "input" || !round) {
      return;
    }

    if (mode === MODES.COUNT) {
      await finishCurrentRound(evaluateCount(round.config.activeCount, countGuess));
      return;
    }

    await finishCurrentRound(evaluatePattern(round.pattern, selected));
  }

  async function switchMode(nextMode: GameMode) {
    if (nextMode === mode) {
      return;
    }
    await resetRun("abandoned", nextMode);
  }

  async function toggleTraining() {
    training = !training;
    if (phase !== "ready") {
      await resetRun("abandoned");
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

  function isTarget(index: number): boolean {
    return Boolean(round?.pattern.includes(index));
  }

  function getBlockClass(index: number): string {
    const target = isTarget(index);
    const chosen = selected.has(index);
    const classes = ["block"];

    if (index % currentConfig.cols === currentConfig.cols - 1) classes.push("is-edge-right");
    if (index >= currentConfig.totalCells - currentConfig.cols) classes.push("is-edge-bottom");
    if (phase === "preview" && target) classes.push("is-active");
    if (phase === "input" && chosen) classes.push("is-selected");

    if ((phase === "reveal" || phase === "gameover") && round) {
      if (target && chosen) classes.push("is-correct");
      else if (target) classes.push("is-missed");
      else if (chosen) classes.push("is-wrong");
      if (mode === MODES.COUNT && target) classes.push("is-active");
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
    if (currentStorageState === "error") return currentStorageError;
    if (!evaluation) return `${modeNames[currentMode]} Mode`;
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
    if (currentPhase === "gameover") return "Restart";
    if (currentPhase === "reveal" && evaluation?.trainingRetry) return "Retry";
    if (currentPhase === "reveal") return "Next";
    return "Start";
  }
</script>

<main class="app-shell">
  <header class="topbar" aria-label="Game status">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <h1>Block Memory</h1>
    </div>
    <div class="stats">
      <span><strong>{score}</strong><small>Score</small></span>
      <span><strong>{level}</strong><small>Level</small></span>
      <span><strong>{streak}</strong><small>Streak</small></span>
      <span><strong>{bestScore}</strong><small>Best</small></span>
    </div>
  </header>

  <section class="playfield" aria-label="Block memory game">
    <aside class="controls" aria-label="Game controls">
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

      <div class="level-readout">
        <span>{phaseLabel}</span>
        <strong>{currentConfig.rows}x{currentConfig.cols} / {(currentConfig.previewMs / 1000).toFixed(1)}s</strong>
      </div>

      <label class="training-toggle">
        <input type="checkbox" checked={training} on:change={toggleTraining}>
        <span>Training</span>
      </label>

      {#if mode === MODES.COUNT}
        <div class="count-entry">
          <label for="countGuess">Cubes</label>
          <div class="number-row">
            <button type="button" aria-label="Decrease guess" disabled={phase !== "input"} on:click={() => (countGuess = Math.max(0, countGuess - 1))}>-</button>
            <input id="countGuess" type="number" inputmode="numeric" min="0" bind:value={countGuess} disabled={phase !== "input"}>
            <button type="button" aria-label="Increase guess" disabled={phase !== "input"} on:click={() => (countGuess += 1)}>+</button>
          </div>
        </div>
      {:else}
        <div class="pattern-entry">
          <div class="pattern-count">{selectedCount} selected</div>
          <button type="button" class="secondary-button" disabled={phase !== "input" || selectedCount === 0} on:click={() => (selected = new Set())}>Clear</button>
        </div>
      {/if}

      <div class="actions">
        <button class="primary-button" type="button" disabled={phase === "preview" || storageState === "error"} on:click={submitAnswer}>{primaryLabel}</button>
        <button class="secondary-button" type="button" on:click={() => resetRun("abandoned")}>Reset</button>
      </div>

      <output class:error={storageState === "error"} class="result" aria-live="polite">{resultText}</output>

      <div class="history">
        {#if storageState === "loading"}
          <span>Loading</span>
          <span>local</span>
          <span>history</span>
        {:else}
          <span>{stats.totalRuns} runs</span>
          <span>{stats.totalRounds} rounds</span>
          <span>{stats.trainingRounds} training</span>
        {/if}
      </div>
    </aside>

    <section class="board-wrap" aria-label="Memory board">
      <div
        class="board"
        aria-label="Block grid"
        style={`--rows: ${currentConfig.rows}; --cols: ${currentConfig.cols};`}
      >
        {#each Array(currentConfig.totalCells) as _, index}
          <button
            type="button"
            class={getBlockClass(index)}
            aria-label={`Block ${index + 1}`}
            aria-pressed={selected.has(index)}
            disabled={mode !== MODES.PATTERN || phase !== "input"}
            on:click={() => toggleBlock(index)}
          ></button>
        {/each}
      </div>
    </section>
  </section>
</main>

<style>
  .app-shell {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 100vh;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem clamp(1rem, 3vw, 2.4rem);
    border-bottom: 1px solid var(--line);
    background: rgba(3, 16, 24, 0.72);
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
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.06);
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
    display: grid;
    grid-template-columns: minmax(15rem, 20rem) 1fr;
    min-height: 0;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: clamp(1rem, 2.4vw, 1.5rem);
    border-right: 1px solid var(--line);
    background: var(--panel);
    backdrop-filter: blur(14px);
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
    background: var(--amber);
    color: #1d1400;
    font-weight: 850;
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
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
    padding: clamp(1rem, 4vw, 3rem);
  }

  .board {
    --rows: 3;
    --cols: 3;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
    width: min(92vw, calc(var(--cols) * 5rem), calc((100vh - 8rem) * var(--cols) / var(--rows)));
    aspect-ratio: var(--cols) / var(--rows);
    border: 2px solid rgba(255, 255, 255, 0.82);
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.34), 0 0 2rem rgba(0, 165, 184, 0.32);
  }

  .block {
    position: relative;
    min-width: 0;
    min-height: 0;
    border-right: 2px solid rgba(255, 255, 255, 0.82);
    border-bottom: 2px solid rgba(255, 255, 255, 0.82);
    cursor: default;
    background:
      radial-gradient(circle at 34% 24%, rgba(255, 255, 255, 0.96), transparent 22%),
      linear-gradient(135deg, #f9fbfb, var(--cube) 45%, #8e979e);
    box-shadow: inset 0.45rem 0.45rem 1rem rgba(255, 255, 255, 0.72), inset -0.7rem -0.75rem 1.1rem rgba(15, 25, 32, 0.26);
  }

  .block:not(:disabled) {
    cursor: pointer;
  }

  .block.is-edge-right {
    border-right: 0;
  }

  .block.is-edge-bottom {
    border-bottom: 0;
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
      radial-gradient(circle at 50% 45%, rgba(0, 165, 184, 0.95), transparent 26%),
      radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.18), transparent 40%),
      linear-gradient(135deg, #02171e, var(--cube-dark) 58%, #0c1117);
    box-shadow: inset 0.35rem 0.35rem 1rem rgba(0, 165, 184, 0.18), inset -0.6rem -0.7rem 1rem rgba(0, 0, 0, 0.45);
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
    .topbar {
      align-items: stretch;
      flex-direction: column;
    }

    .brand {
      min-width: 0;
    }

    .stats {
      width: 100%;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .playfield {
      grid-template-columns: 1fr;
    }

    .controls {
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }

    .board-wrap {
      align-items: start;
    }
  }

  @media (max-width: 520px) {
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .controls {
      gap: 0.8rem;
    }

    .board {
      width: min(94vw, calc((100vh - 20rem) * var(--cols) / var(--rows)));
    }
  }
</style>
