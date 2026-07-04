# Static Browser Game With Shared Progression

We will build the game as a dependency-free static browser app and keep the level progression in a shared core module used by both modes. This keeps the project easy to run from a fresh clone while ensuring Count Mode and Pattern Mode stay comparable as levels increase; Training Mode changes failure handling only, not the difficulty curve.

## Considered Options

- A React/Vite app would be familiar for larger UI work, but it adds install and build steps that do not buy much for this small game.
- Separate difficulty curves per mode would allow finer tuning, but it would make the meaning of "Level 7" inconsistent across modes.
