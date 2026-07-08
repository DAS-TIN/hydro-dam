# RTC: live multi-user collaboration sessions

A Git-aware collaboration layer: several people join the same repo session,
each can run their own AI coding agent, and every change is attributable to
one actor. Work flows through tasks, locks, patches and checkpoints - never
through a raw folder mirror.

The backend is plain ESM JavaScript (.mjs) so the exact same modules run in
the Electron main process and under `node --test` (see test/rtc-*.test.mjs).
Only ipc.ts touches Electron.

The whole feature is compile-time optional. `npm run package:lite` builds
installers with `__COLLAB__` set to false, which removes the rtc code, the
rail button and the workspace from the bundle entirely; the lite installers
get a -lite suffix and sit next to the full ones in dist/. Both flavors
share an appId, so running the full installer over a lite install upgrades
it in place - that is the "install the extension" story.

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
- baselines.mjs   per-actor file snapshots so an assistant can detect edits
                  made by others between its read and its write
- context.mjs     writes .rtc/context.md, per-task and per-agent briefs,
                  locks/actors JSON, and the hydrodam-collab skill file
- watcher.mjs     debounced fs.watch over manifest files only
- sync.mjs        the network transport interface; local no-op for now
- state.ts        shared persist + notify helpers for ipc.ts and mcp-tools.ts
- ipc.ts          Electron wiring: rtc:* channels + rtc:event broadcasts
- mcp-tools.ts    rtc_* tools on the app's MCP server for live assistants

## Assistants

A connected assistant (Claude Code over the app's MCP server) drives the
session with the rtc_* tools: rtc_join to identify itself under its owner,
rtc_plan to declare a task, lock files and publish the endpoints it will
build, rtc_check_files before every write to catch concurrent edits (a
changed file is a merge conflict: re-read, merge, re-claim, then write),
rtc_checkpoint to hand work back for review, rtc_release when done. The
same instructions ship two ways from one source (ASSISTANT_GUIDE in
context.mjs): the rtc_guide tool, and a generated Claude Code skill at
.claude/skills/hydrodam-collab/SKILL.md in the session repo. A future
extension host should keep that property: an extension carries its own
assistant instructions and registers them as both MCP tools and a skill.

The UI lives in src/renderer/src/components/rtc/ (one screen per concern:
session, actors, tasks, locks, files, patches, checkpoints, commits,
advisor, security).

## Safety defaults

.git never leaves the machine in snapshot mode; .env and key-like files are
excluded from every manifest; symlinks are dropped; snapshot paths are
checked against traversal; nothing from downloaded code runs automatically;
applying, staging and committing always ask first.
