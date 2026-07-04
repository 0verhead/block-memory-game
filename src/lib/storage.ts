import type { PGlite } from "@electric-sql/pglite";
import type { GameMode, LevelConfig, RoundEvaluation } from "./game-core";

export type RunStatus = "active" | "completed" | "failed" | "abandoned";

export type GameStats = {
  bestCountScore: number;
  bestPatternScore: number;
  totalRuns: number;
  totalRounds: number;
  trainingRounds: number;
};

export type RoundRecordInput = {
  runId: string;
  mode: GameMode;
  training: boolean;
  level: number;
  scoreAfter: number;
  streakAfter: number;
  config: LevelConfig;
  pattern: number[];
  selected: number[];
  guess: number | null;
  evaluation: RoundEvaluation;
};

let dbPromise: Promise<PGlite> | null = null;
let readyPromise: Promise<void> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

export function ensureStorage(): Promise<void> {
  if (!readyPromise) {
    readyPromise = getDb().then((db) => db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        training BOOLEAN NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        highest_level INTEGER NOT NULL DEFAULT 1,
        rounds INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS rounds (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        mode TEXT NOT NULL,
        training BOOLEAN NOT NULL,
        level INTEGER NOT NULL,
        score_after INTEGER NOT NULL,
        streak_after INTEGER NOT NULL,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        active_count INTEGER NOT NULL,
        preview_ms INTEGER NOT NULL,
        difficulty_score INTEGER NOT NULL,
        pattern_json TEXT NOT NULL,
        selected_json TEXT NOT NULL,
        guess INTEGER,
        correct BOOLEAN NOT NULL,
        evaluation_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)).then(() => undefined);
  }

  return readyPromise;
}

async function getDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = import("@electric-sql/pglite").then(({ PGlite }) => new PGlite("idb://block-memory-game"));
  }

  return dbPromise;
}

export async function startRun(mode: GameMode, training: boolean): Promise<string> {
  await ensureStorage();
  const db = await getDb();
  const id = crypto.randomUUID();

  await db.query(
    `INSERT INTO runs (id, mode, training, started_at, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [id, mode, training, nowIso()]
  );

  return id;
}

export async function recordRound(input: RoundRecordInput): Promise<void> {
  await ensureStorage();
  const db = await getDb();

  await db.query(
    `INSERT INTO rounds (
      id, run_id, mode, training, level, score_after, streak_after, rows, cols,
      active_count, preview_ms, difficulty_score, pattern_json, selected_json,
      guess, correct, evaluation_json, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      crypto.randomUUID(),
      input.runId,
      input.mode,
      input.training,
      input.level,
      input.scoreAfter,
      input.streakAfter,
      input.config.rows,
      input.config.cols,
      input.config.activeCount,
      input.config.previewMs,
      input.config.difficultyScore,
      JSON.stringify(input.pattern),
      JSON.stringify(input.selected),
      input.guess,
      input.evaluation.correct,
      JSON.stringify(input.evaluation),
      nowIso(),
    ]
  );

  await db.query(
    `UPDATE runs
     SET score = $2,
         highest_level = GREATEST(highest_level, $3),
         rounds = rounds + 1
     WHERE id = $1`,
    [input.runId, input.scoreAfter, input.level]
  );
}

export async function finishRun(runId: string, status: RunStatus, score: number, highestLevel: number): Promise<void> {
  await ensureStorage();
  const db = await getDb();
  await db.query(
    `UPDATE runs
     SET finished_at = $2,
         status = $3,
         score = $4,
         highest_level = GREATEST(highest_level, $5)
     WHERE id = $1 AND status = 'active'`,
    [runId, nowIso(), status, score, highestLevel]
  );
}

export async function loadStats(): Promise<GameStats> {
  await ensureStorage();
  const db = await getDb();

  const best = await db.query<{ mode: string; best_score: number }>(
    `SELECT mode, MAX(score)::int AS best_score
     FROM runs
     WHERE training = false AND status IN ('completed', 'failed')
     GROUP BY mode`
  );
  const totals = await db.query<{ total_runs: number; total_rounds: number; training_rounds: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM runs) AS total_runs,
       (SELECT COUNT(*)::int FROM rounds) AS total_rounds,
       (SELECT COUNT(*)::int FROM rounds WHERE training = true) AS training_rounds`
  );

  return {
    bestCountScore: best.rows.find((row) => row.mode === "count")?.best_score ?? 0,
    bestPatternScore: best.rows.find((row) => row.mode === "pattern")?.best_score ?? 0,
    totalRuns: totals.rows[0]?.total_runs ?? 0,
    totalRounds: totals.rows[0]?.total_rounds ?? 0,
    trainingRounds: totals.rows[0]?.training_rounds ?? 0,
  };
}
