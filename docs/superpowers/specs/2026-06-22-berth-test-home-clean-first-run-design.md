# `BERTH_TEST_HOME` — simulate a clean first-install environment locally

**Date:** 2026-06-22
**Status:** ⚠️ SUPERSEDED — not implemented (reverted). See "Decision" below.

## Decision (what shipped instead)

The original goal was a single switch to test Berth's first-install / init chain locally. This spec
proposed a new `BERTH_TEST_HOME` var (backed by a `dataHome()` helper) that relocated **everything** —
Berth state *and* the scanned CLI session stores *and* the spawned CLI children's `HOME` — to simulate
a machine that had never run any CLI either (a fully empty sidebar).

That overshot the real need. The first-run we actually want to polish is **a new Berth user on an
existing machine**: they have real `~/.claude` / `~/.codex` sessions, they just never installed Berth.
For that, the sidebar must still scan the machine's real sessions and offer them for import — which the
`BERTH_TEST_HOME` design deliberately hid, causing confusion ("why are there no importable sessions?").

The pre-existing **`BERTH_HOME`** already does exactly the right thing: it isolates only Berth's own
state (db / docs / seed) while the CLI session stores stay on the real home, so real sessions are
scanned and importable. So `BERTH_TEST_HOME` / `dataHome()` and the related launch/trust/coco-hook
redirection were **reverted**, and the only net additions kept were:

- `npm run dev:clean` (backend) → `PORT=7788 BERTH_HOME=/tmp/berth-clean npm start`
- `web` `npm run dev:clean` → Vite `:5174` proxying to `:7788`
- `web/vite.config.ts` proxy target + port made env-driven (`BERTH_API_PORT` / `BERTH_WEB_PORT`), so
  the clean instance runs alongside the normal `:7777` backend + `:5173` Vite.

See `docs/ARCHITECTURE.md` → "Testing the first-install / init chain — `BERTH_HOME`" for the current,
authoritative recipe. The rest of this file is retained only as the original (rejected) design record.

---

## Original problem (retained for history)

Polishing Berth's first-install / initialization chain requires running Berth as if freshly installed.
`BERTH_HOME` isolates only Berth's own state; the proposal was to also relocate the scanned CLI stores
so the sidebar would start empty. In practice an empty sidebar is *not* the realistic first-run (a new
Berth user already has CLI sessions), so this approach was dropped in favor of plain `BERTH_HOME`.
