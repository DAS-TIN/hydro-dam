# RTC: live multi-user collaboration sessions

A Git-aware collaboration layer: several people join the same repo session,
each can run their own AI coding agent, and every change is attributable to
one actor. Work flows through tasks, locks, patches and checkpoints - never
through a raw folder mirror.

The backend is plain ESM JavaScript (.mjs) so the exact same modules run in
the Electron main process and under `node --test` (see test/rtc-*.test.mjs).
Only ipc.ts touches Electron.

## Module map

- util.mjs        git exec, ids, atomic JSON writes
- paths.mjs       path traversal prevention for anything crossing a trust boundary
- fileselect.mjs  which files are in a session: git ls-files first, default
                  exclusions (deps, build output, secrets), .rtcignore,
                  binary/large/symlink handling, manifest + hash
- store.mjs       JSON persistence under <repo>/.rtc/ (kept out of git via
                  .git/info/exclude), presence files for external agents
- session.mjs     create/end sessions, invite export, sanitized snapshot export
- join.mjs        clone-based join (verify HEAD == base) and snapshot-based
                  join (verify hashes, git init, "RTC session base" commit)
- actors.mjs      people and their agents (every agent has an owner), managers, system
- tasks.mjs       task state machine, claiming, dependency blocking
- locks.mjs       soft/hard locks, folder coverage, expiry, violations
- patches.mjs     change log -> actor-owned diffs against the session base,
                  3-way apply with conflict detection, never a silent overwrite
- checkpoints.mjs stable review points from patches + the task progress heuristic
- advisor.mjs     rule-based manager suggestions (collisions, blocked drift,
                  split/commit/resolve advice); it never edits anything
- commits.mjs     commit suggestions with co-author picks; staging and
                  committing only ever happen from the Approve button
- context.mjs     writes .rtc/context.md, per-task and per-agent briefs,
                  locks/actors/contracts JSON for Claude Code agents
- watcher.mjs     debounced fs.watch over manifest files only
- sync.mjs        the network transport interface; local no-op for now
- ipc.ts          Electron wiring: rtc:* channels + rtc:event broadcasts

The UI lives in src/renderer/src/components/rtc/ (one screen per concern:
session, actors, tasks, locks, files, patches, checkpoints, commits,
advisor, security).

## Safety defaults

.git never leaves the machine in snapshot mode; .env and key-like files are
excluded from every manifest; symlinks are dropped; snapshot paths are
checked against traversal; nothing from downloaded code runs automatically;
applying, staging and committing always ask first.
