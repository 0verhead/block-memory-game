# Block Memory Game

This context names the gameplay concepts for a browser-based block memory game where each round tests short-term visual recall.

## Language

**Round**:
A single memory challenge made from one preview, one player answer, and one evaluation.
_Avoid_: Turn, puzzle

**Run**:
A sequence of rounds in one mode that starts at level 1 and ends when the player misses outside Training Mode, resets, or changes mode.
_Avoid_: Session, attempt

**Level**:
The current difficulty step in a mode. Each completed round advances the level and raises memory load.
_Avoid_: Stage, wave

**Block**:
One square cube in the board grid. Blocks can be neutral, active during preview, selected by the player, or marked during the reveal.
_Avoid_: Tile, cell, square

**Pattern**:
The hidden set of active blocks for the round.
_Avoid_: Layout, shape

**Count Mode**:
The mode where the player recalls only how many active blocks were shown.
_Avoid_: Number mode, cube-counting mode

**Pattern Mode**:
The mode where the player reconstructs the actual active block positions.
_Avoid_: Memory mode, layout mode

**Training Mode**:
An optional practice setting where a wrong answer reveals the solution and lets the player retry without ending the run.
_Avoid_: Practice mode, casual mode

**Preview**:
The timed moment where the pattern is visible before the player answers.
_Avoid_: Flash, reveal

**Reveal**:
The post-answer state showing the correct pattern and any player mistakes.
_Avoid_: Feedback, result screen
