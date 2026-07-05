---
name: hydrodam
description: Drive the Hydrodam git desktop client through its local MCP server. Use when the user asks to inspect a repo open in Hydrodam, prepare or preview a commit, search history, or resolve merge conflicts through the app.
---

# Hydrodam MCP

Hydrodam is a safer git desktop client: it is built around committing as the
right identity and previewing exactly what each commit will contain. When
its MCP server is enabled, you can inspect and (optionally) act on the
repository the user has open in the app.

## Connecting

1. In Hydrodam: Settings > MCP server > enable. Default port is 4319.
2. Register the server with your MCP client. For Claude Code:

```bash
claude mcp add --transport http hydrodam http://127.0.0.1:4319/mcp
```

The server is loopback-only and acts on whichever repository is currently
focused in the app. If a tool reports that no repository is open, ask the user
to open one in Hydrodam first.

## Tools

Read-only (always available):

- `status` - staged / changed / untracked / conflicted files, branch, ahead/behind
- `diff` - unified diff, optionally staged-only or one path
- `numstat` - per-file +/- line counts, staged and unstaged
- `preview_commit` - exactly what the next commit will contain, including the
  author and active co-author trailers; pass `message` to preview trailers
- `coauthors` - the co-authors that will co-sign the next commit
- `branches` - local and remote branches with upstream and ahead/behind
- `log_stat`, `log_search`, `show_commit` - history inspection
- `file_at` - a file's contents at any ref
- `blame` - per-line authorship
- `stash_list`, `reflog` - stashes and HEAD movements
- `conflicts` - conflicted files parsed into ours/base/theirs segments (JSON)

Write tools (only when the user enabled "dangerous mode" in settings):

- `stage`, `unstage` - manage the index
- `commit` - commit staged changes; co-author trailers are appended for you
- `push`, `fetch`, `pull` - talk to the remote
- `checkout`, `create_branch` - move between branches
- `stash`, `uncommit` - set work aside / soft-undo the last commit
- `resolve_conflict` - write the final merged contents for one file and stage it

## Workflows

Committing (the Hydrodam way):

1. `status`, then `diff` to understand the change.
2. `stage` what belongs together; check `preview_commit` with your draft
   message. The preview shows exactly what will land: the files, the author
   identity, the message, and any trailers. Confirm it before committing.
3. `commit`. Never hand-write `Co-Authored-By:` trailers into the message;
   the server appends the active ones itself.

Resolving conflicts:

1. `conflicts` gives every conflicted file as ordered segments with `ours`,
   `base` (when available), and `theirs`.
2. For each file, produce the complete merged file (no conflict markers) and
   call `resolve_conflict`. Prefer semantic merges over picking a side; when
   both sides changed the same lines for different reasons, keep both intents.
3. Delete/modify conflicts (a side deleted the file) have no segments; ask the
   user whether to keep or delete, then `stage` the kept file or say the
   deletion needs confirming in the app.

History archaeology:

- `log_search` with `grep`/`author`/`path` to find commits, then `show_commit`.
- `blame` to find who last touched a line, `file_at` to read any old version.
- `reflog` when the user thinks work is lost; most "lost" commits are there.

## Cautions

- Tools act on the repo focused in the app, which can change between calls if
  the user switches repositories. Re-run `status` when in doubt.
- `push`, `pull`, and `checkout` change shared or working state; confirm with
  the user before calling them unless they just asked for exactly that.
- Without dangerous mode, propose the exact commands or app actions instead of
  trying write tools; they are not registered and will not exist.
