# Contributing

Thanks for helping. This file covers code style and pull requests. If you need help getting the project running, open an issue and describe your OS and what went wrong.

## Code style

- TypeScript with `strict` on. No `any` without a comment saying why.
- Formatting is Prettier's job; run `pnpm format` before you push.
- Every change to a project goes through the engine's command bus so it can be undone. Don't change project state directly from the UI.
- The renderer never touches the file system or spawns processes. Add an entry to `src/shared/ipc.ts` and a handler in the main process instead.
- All user-facing text goes in `src/renderer/src/i18n/en.json`.
- No `TODO` comments in shipped code. Open an issue instead.

## Writing

Short and specific. Buttons say what they do ("Export", "Remove silences"). Errors say what happened and what to do next. Sentence case for labels and menus. No emoji in the interface.

## Pull requests

- One topic per pull request. Keep it small enough to review in one sitting.
- `pnpm typecheck`, `pnpm lint` and `pnpm test` must pass.
- New behavior comes with a test. UI changes come with a before and after screenshot.
- Add a line to the `[Unreleased]` section of `CHANGELOG.md` if people using the app will notice the change.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

By contributing you agree that your work is licensed under GPL-3.0-or-later.
