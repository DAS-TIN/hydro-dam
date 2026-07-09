// context.mjs - keeps Claude Code agents oriented. Every time tasks, locks,
// contracts or actors change, these files are rewritten so an agent reading
// .rtc/ always sees the current collaboration state.

import { writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeJson } from './util.mjs'
import { activeLocks } from './locks.mjs'
import { taskProgress } from './checkpoints.mjs'
import { excludeLocally } from './store.mjs'

const SAFETY_RULES = `## Safety rules

- Never edit a locked file without approval from whoever holds the lock.
- Never run install, build, test or other commands unless your owner approved that command.
- Never commit, stage, push or apply patches yourself - suggest, then wait for your owner.
- Never touch files in your task's forbidden list.
- Stay inside the allowed files for your task when a list is present.
- When you finish a coherent piece of work, suggest a checkpoint instead of continuing to pile up changes.
- Report your position by writing .rtc/presence/<your actor id with : replaced by _>.json with {"actorId":"...","activeFiles":[],"cursor":{"path":"...","line":1},"note":"..."}.
- After editing a file you may claim your lines in .rtc/liveblame.json: append {"path","startLine","endLine","actorId","at","hash"} where hash is the sha256 of those working-tree lines joined with newlines. This is the live half of blame; unclaimed edits are attributed to whoever is active in the app.
- If the Hydrodam MCP server is connected, use its rtc_* tools instead of raw files: call rtc_guide once, then follow it for every change.`

// The one workflow description every assistant sees, whether it arrives over
// MCP (rtc_guide tool) or by reading the generated skill file in the repo.
export const ASSISTANT_GUIDE = `Hydrodam live collaboration - how to work in this session

You are an AI assistant inside a shared repo session. Other people (and
their assistants) may be editing their own copies at the same time, so
every change you make follows this loop:

1. Identify yourself once: call rtc_join with your name and your user's
   name. It returns your actor id - pass that id to every other rtc tool.
2. Look before you start: rtc_status shows who is connected, what they are
   working on, open tasks, locks and the endpoints others have declared.
3. Declare a plan BEFORE editing anything: call rtc_plan with
   - what you are doing (task title and a short description),
   - the files you want to lock while you work,
   - the endpoints or interfaces you will add or change (name + signature).
   Declaring endpoints at plan time lets someone working on the same
   feature build against your contract before your code lands, and it
   surfaces collisions early. If a file is already locked by someone else,
   coordinate with them instead of editing it.
4. Keep presence fresh with rtc_presence (file, line, a short note) so the
   app shows where you are working.
5. Before EVERY file write, call rtc_check_files. If a file changed since
   you claimed it, your user (or someone else) edited it while you worked.
   Treat that exactly like a merge conflict: re-read the file, merge their
   changes with yours, call rtc_claim_files to refresh your baseline, and
   only then write. After each write, call rtc_claim_files again so your
   own edit becomes the new baseline.
6. When a coherent piece of work is done, call rtc_checkpoint. It turns
   your changes into a reviewable patch and checkpoint; a person reviews,
   applies and commits it in Hydrodam. Never commit, stage or push
   yourself.
7. Finished or stepping away? rtc_release frees your locks and baselines.

The shared session state is also on disk under .rtc/ (context.md, your
brief in agents/, tasks/, locks.json, contracts.json) if you cannot reach
the MCP server.`

function fmtTask(t, patches) {
  const crit = (t.acceptanceCriteria || []).map((c) => `- [${c.done ? 'x' : ' '}] ${c.text}`).join('\n')
  return [
    `# Task ${t.id}: ${t.title}`,
    '',
    `- Type: ${t.type}`,
    `- Status: ${t.status} (${taskProgress(t, patches)}% toward checkpoint)`,
    `- Owner: ${t.ownerActorId || 'unclaimed'} (human: ${t.humanOwnerActorId || 'n/a'})`,
    `- Priority: ${t.priority}`,
    t.dependsOn?.length ? `- Depends on: ${t.dependsOn.join(', ')}` : null,
    t.blocks?.length ? `- Blocks: ${t.blocks.join(', ')}` : null,
    '',
    t.description || '(no description)',
    '',
    crit ? `## Acceptance criteria\n\n${crit}` : null,
    t.allowedFiles?.length ? `## Allowed files\n\n${t.allowedFiles.map((f) => `- ${f}`).join('\n')}` : null,
    t.forbiddenFiles?.length ? `## Forbidden files\n\n${t.forbiddenFiles.map((f) => `- ${f}`).join('\n')}` : null,
    t.lockedFiles?.length ? `## Files locked for this task\n\n${t.lockedFiles.map((f) => `- ${f}`).join('\n')}` : null
  ]
    .filter((x) => x !== null)
    .join('\n')
}

/** Rewrite every context artifact under .rtc/ from the current state. */
export function writeContext(cwd, state) {
  const dir = join(cwd, '.rtc')
  mkdirSync(join(dir, 'tasks'), { recursive: true })
  mkdirSync(join(dir, 'agents'), { recursive: true })

  const locks = activeLocks(state.locks)
  writeJson(join(dir, 'locks.json'), locks)
  writeJson(join(dir, 'actors.json'), state.actors)

  // context.md - the shared picture.
  const actorsList = state.actors
    .map((a) => {
      const extra = a.type === 'agent' ? ` (owned by ${a.humanOwnerActorId})` : ''
      const doing = a.activeTaskId ? `, on ${a.activeTaskId}` : ''
      const files = a.activeFiles?.length ? `, editing ${a.activeFiles.join(', ')}` : ''
      return `- ${a.id}: ${a.displayName}${extra}${doing}${files}`
    })
    .join('\n')
  const taskList = state.tasks
    .map((t) => `- ${t.id} [${t.status}] ${t.title}${t.ownerActorId ? ` (${t.ownerActorId})` : ''}`)
    .join('\n')
  const lockList = locks
    .map((l) => `- ${l.path} [${l.hardLock ? 'HARD' : 'soft'}] held by ${l.lockedByActorId}${l.reason ? `: ${l.reason}` : ''}`)
    .join('\n')
  const contractList = (state.contracts || [])
    .map((c) => `- ${c.name}: ${c.signature}${c.file ? ` (${c.file})` : ''} - declared by ${c.actorId}${c.taskId ? ` for ${c.taskId}` : ''}`)
    .join('\n')

  const md = [
    '# RTC collaboration context',
    '',
    'This repository is part of a live multi-user session. Several people and',
    'AI agents are working in their own copies at the same time. Work flows',
    'through tasks, locks, patches and checkpoints - not direct pushes.',
    '',
    `- Session: ${state.session.id} (${state.session.repoName})`,
    `- Base commit: ${state.session.baseCommit}`,
    `- Join mode: ${state.session.joinMode}`,
    '',
    '## Who is here',
    '',
    actorsList || '(nobody yet)',
    '',
    '## Tasks',
    '',
    taskList || '(no tasks yet)',
    '',
    '## Locked files',
    '',
    lockList || '(nothing locked)',
    '',
    '## Declared endpoints',
    '',
    contractList || '(none declared yet - declare yours with rtc_plan before you build)',
    '',
    '## Checkpoint rules',
    '',
    '- Group related changes into a patch for your task.',
    '- When acceptance criteria are met, suggest a checkpoint.',
    '- A reviewer looks at the checkpoint and decides: apply, stage, commit or request cleanup.',
    '',
    SAFETY_RULES,
    ''
  ].join('\n')
  writeFileSync(join(dir, 'context.md'), md, 'utf8')

  // Per-task briefs; remove briefs for deleted tasks.
  const keep = new Set(state.tasks.map((t) => `${t.id}.md`))
  if (existsSync(join(dir, 'tasks'))) {
    for (const f of readdirSync(join(dir, 'tasks'))) {
      if (f.endsWith('.md') && !keep.has(f)) rmSync(join(dir, 'tasks', f), { force: true })
    }
  }
  for (const t of state.tasks) {
    writeFileSync(join(dir, 'tasks', `${t.id}.md`), fmtTask(t, state.patches) + '\n', 'utf8')
  }

  // The same guide as the rtc_guide MCP tool, dropped in as a Claude Code
  // skill so an assistant that never connects to MCP still finds the rules.
  // Local-excluded so it never shows up in the user's git status.
  try {
    const skillDir = join(cwd, '.claude', 'skills', 'hydrodam-collab')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: hydrodam-collab',
        'description: This repo is in a live Hydrodam collaboration session with other people and assistants. Read BEFORE making any change here - declare a plan and lock files first, check for concurrent edits before every write, and hand finished work back as a checkpoint.',
        '---',
        '',
        ASSISTANT_GUIDE,
        ''
      ].join('\n'),
      'utf8'
    )
    excludeLocally(cwd, '.claude/skills/hydrodam-collab/')
  } catch {
    // The skill file is a convenience; a read-only tree must not break sync.
  }

  // Per-agent identity briefs: who the agent is, who owns it, what it may do.
  for (const a of state.actors.filter((x) => x.type === 'agent' || x.type === 'manager')) {
    const task = a.activeTaskId ? state.tasks.find((t) => t.id === a.activeTaskId) : null
    const brief = [
      `# You are ${a.id}`,
      '',
      `- Display name: ${a.displayName}`,
      `- Your owner: ${a.humanOwnerActorId || '(none - you are a manager; you only advise)'}`,
      `- Current task: ${task ? `${task.id} - ${task.title} (see .rtc/tasks/${task.id}.md)` : 'none assigned'}`,
      '',
      'Read .rtc/context.md for the full session state, .rtc/locks.json before',
      'editing anything, and your task brief for allowed and forbidden files.',
      '',
      SAFETY_RULES,
      ''
    ].join('\n')
    writeFileSync(join(dir, 'agents', `${a.id.replace(/[:/\\]/g, '_')}.md`), brief, 'utf8')
  }
}
