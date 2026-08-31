# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single-day schedule management app ("今日のスケジュール"). Runs entirely in the browser as static
HTML/CSS/vanilla JavaScript — no build step, no framework, no backend. All data is persisted to
`localStorage` on the client.

Node.js/npm are not installed in this environment, which is why the app deliberately avoids any
build tooling. If Node becomes available and the user wants a framework/bundler, confirm before
introducing one — the current approach is intentional, not a placeholder.

## Running locally

Serve the directory with any static file server (opening `index.html` directly also works, but a
server avoids `file://` quirks). No install step is needed.

```bash
python3 -m http.server 8420
```

Then open `http://localhost:8420`. A `.claude/launch.json` config (`static-server`) is provided for
starting this via the Browser pane's preview tool as an alternative to the command above.

There is no build, lint, or test command — there is no package.json/toolchain in this project.

## Deployment

Deployed as a static site on GitHub Pages (root of the default branch, no build step). Everything
under this directory is publishable as-is:
- All asset references in [index.html](index.html) are relative (`css/style.css`, `js/app.js`), so
  the site works both at a root domain and under a project subpath
  (`https://<user>.github.io/<repo>/`). Don't introduce root-relative (`/css/...`) paths.
- No external dependencies (no CDN scripts/fonts) — keep it that way unless there's a real need.
- `.nojekyll` at the repo root disables GitHub Pages' default Jekyll processing; keep it even if the
  project stays simple, since Jekyll has undocumented edge cases with files/folders it treats
  specially.
- `.claude/launch.json` is local dev tooling only (starts a `python3 -m http.server` for the Browser
  pane) — irrelevant to the deployed site, harmless to leave in the repo.

## Architecture

- [index.html](index.html) — page structure: header stats bar, a schedule panel with a working-hours
  setting row (`#day-start-input`/`#day-end-input`) above three aligned columns (time labels,
  予定/plan, 実績/actual) under a `.schedule-head` label row, a task panel, and a single modal
  (`#modal-overlay`) reused for both creating and editing schedule blocks.
- [css/style.css](css/style.css) — all styling, including the responsive breakpoint (`768px`) that
  stacks the schedule/task panels for mobile.
- [js/app.js](js/app.js) — all application logic, in one IIFE, no modules. Key structure:
  - `state = { blocks: [], tasks: [] }`, persisted as JSON under the `schedule-app-v1` localStorage
    key via `loadState()`/`saveState()`. Working-hours `settings = { dayStart, dayEnd }` (both
    `"HH:MM"`) are persisted separately under `schedule-app-settings-v1` via `loadSettings()`/
    `saveSettings()`, editable at runtime through the two day-range selects.
  - Blocks store **absolute time strings**, not slot indices: `startTime`/`endTime` (and
    `actualStart`/`actualEnd`), all `"HH:MM"`. This is deliberate — it decouples stored data from
    `settings`, so changing the working-hours range never mutates or corrupts existing blocks. A
    block whose time falls outside the currently-configured range simply isn't rendered (data is
    untouched, it reappears if the range is widened again) — see `slotIndexOf`/`findBlockAt`
    returning nothing for out-of-range times.
  - `TIMES` (the `"HH:MM"` boundaries for the visible day) and `SLOT_COUNT` are `let`, not `const`,
    and are rebuilt by `rebuildTimes()` from `settings` — called on load and again on every
    working-hours change (`handleDaySettingChange`). Every renderer reads the module-level `TIMES`
    binding fresh each call, so reassigning it is sufficient to propagate a range change everywhere
    (grid, modal selects, task start-time select) — don't cache `TIMES`/`SLOT_COUNT` in a closure.
  - `loadState()` runs every loaded block through `migrateBlock()`, which upgrades the old
    slot-index format (`startSlot`/`endSlot`, implicitly anchored to a 09:00 day start) from before
    working hours were configurable into the current `startTime`/`endTime` string format. Keep this
    migration in place — real user data was carried across this format change once already.
  - A block's `original` field is a snapshot taken once at creation time (`{startTime, endTime,
    planText}`) and never mutated afterward. `isRescheduled(block)` compares current values against
    `original` — there is no edit history beyond this single snapshot.
  - Actual work performed is tracked on the same block via separate `actualStart`/`actualEnd`
    (`"HH:MM"` strings) and free-form `actualText`.
  - `renderScheduleGrid()` renders three parallel columns from the same `state.blocks`, sized to the
    current `SLOT_COUNT` (grid-template-rows is set inline in JS, not fixed in CSS, since it varies
    with the working-hours setting):
    - 予定 column (`#plan-col`): walks the visible slots once, rendering the block that starts at
      each slot (via CSS Grid row spanning `grid-row`, computed from `slotIndexOf(block.startTime)`)
      and skipping ahead to its end slot, or an empty clickable slot otherwise. This skip-ahead loop
      is what makes multi-slot blocks work without an explicit table/rowspan structure — preserve it
      if you touch this function, or blocks will render once per covered slot. Separately, every
      rescheduled block also gets a non-interactive "ghost" element (`renderGhostBlockEl`,
      `pointer-events: none`) layered into the same column at its `original` time range (skipped
      entirely if that range is outside the current working hours), showing where the plan used to
      be (dashed border, strikethrough).
    - 実績 column (`#actual-col`): independent of the plan loop — it places a block wherever
      `actualStart`/`actualEnd` resolve to via `slotIndexOf`, filling any uncovered slots with
      non-interactive empty cells. A block's actual time does not need to overlap its plan time.
    - All three columns share the same `--slot-height` row grid so a given time lines up across
      columns; don't let one column's rendering logic diverge from the shared `SLOT_COUNT`.
  - Block cards intentionally show only 2 lines (plan/actual text + time range, with small `↺`/`✓`
    glyphs on the plan card for "rescheduled"/"has actual"); full detail is in the `title` tooltip
    and the edit modal, not inline in the card. This was a deliberate fix for a layout bug where
    longer inline detail overflowed/overlapped within a single 30–40px slot — don't move that detail
    back into the card without accounting for the minimum 1-slot card height.
  - Overlap prevention: `hasOverlap(startTime, endTime, excludeBlockId)` compares minutes-since-
    midnight directly (via `timeToMinutes`), independent of the current visible range. It's the
    single source of truth for plan-time conflicts, used by both the block modal
    (`handleBlockFormSubmit`) and task creation (`handleAddTask`). The 実績 column has no such
    check — overlapping actuals are allowed.
  - Tasks can optionally create a linked block: `task-add-form` has an optional start-time select
    (repopulated by `populateTaskStartSelect()` on init and whenever working hours change); if set,
    `handleAddTask` computes `endTime` from the chosen duration and calls `hasOverlap`; on conflict or
    overflow past `settings.dayEnd` it alerts and adds the task without a block, otherwise it creates
    a block with `taskId` set and stores that block's id back on `task.blockId`. Deleting a task
    (`renderTaskList`'s delete handler) also deletes its linked block by `taskId`; deleting a block
    (`handleBlockDelete`) clears `blockId` on any task pointing to it rather than deleting the task.
    This link is only established at task-creation time — editing a block afterward does not rename
    or otherwise sync back to its task.
  - Achievement rate in the header is `completed tasks / total tasks`, computed purely from
    `state.tasks` — schedule blocks do not factor into it.

## Explicitly out of scope

Per product requirements, the following are intentionally not implemented: user accounts/login,
external calendar sync, notifications, AI features, analytics/reporting, team sharing, billing.
Don't add scaffolding for these speculatively.
