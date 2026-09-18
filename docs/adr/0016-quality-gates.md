# ADR 0016: Quality gates and artifact identity

## Status

Accepted (engineering milestone U).

## Context

Every check the project relies on existed as a local command; nothing ran them before a
merge, and a built artifact could not say which commit or which protocol and simulation
versions it carried.

## Decision

- **One fast workflow, one step per gate.** Typecheck, lint, format, each test project,
  golden-journal replay, and the builds are separate named steps in `ci.yml`, so a red run
  says what failed without opening logs, and a step's exit code is the verdict.
- **Long jobs are separate and scheduled.** The 300-match chaos soak and the benchmarks
  run nightly (`nightly.yml`) and on demand; they upload failing seeds as replayable
  journals and the benchmark tables as artifacts. They never gate a pull request, where
  the eight-match soak sample and the budget tripwires are enough.
- **Golden journals are the replay gate.** Journals recorded by the real server with bots
  are committed; CI and the test suite re-simulate them. They are re-recorded only in a
  change that bumps `SIMULATION_VERSION`, which is the deliberate act the track asks for.
- **Artifacts identify themselves.** Both builds write `build-info.json` with the game,
  protocol, and simulation versions, the source revision, and the build time; the server
  bakes the first and the revision into its bundle and serves all four at `/version`;
  the client prints them on load. The protocol and simulation versions are read from
  the source files at build time so the file cannot disagree with the code.
- **Configuration stays environmental.** CI sets `GAME_VERSION` and `SOURCE_REVISION`;
  the container takes them as build arguments; nothing in any package branches on an
  environment name.

## Consequences

- A rule change now fails CI until `SIMULATION_VERSION` is bumped and the golden journals
  re-recorded, which is the intended friction.
- The container job builds the image on every run (about a minute); it is the only step
  that needs Docker.
- Build metadata is read by regex from two source files; renaming those constants means
  updating `build.mjs` and `vite.config.ts` (both fail loudly if the pattern is missing).
