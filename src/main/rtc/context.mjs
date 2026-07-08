// context.mjs - keeps Claude Code agents oriented. Every time tasks, locks,
// contracts or actors change, these files are rewritten so an agent reading
// .rtc/ always sees the current collaboration state.

import { writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeJson } from './util.mjs'
import { activeLocks } from './locks.mjs'
import { agentsOf } from './actors.mjs'
import { taskProgress } from './checkpoints.mjs'

const SAFETY_RULES = `## Safety rules

- Never edit a locked file without approval from whoever holds the lock.
- Never run install, build, test or other commands unless your owner approved that command.
- Never commit, stage, push or apply patches yourself - suggest, then wait for your owner.
- Never touch files in your task's forbidden list.
- Stay inside the allowed files for your task when a list is present.
- When you finish a coherent piece of work, suggest a checkpoint instead of continuing to pile up changes.
- Report your position by writing .rtc/presence/<your-actor-id>.json with {"activeFiles":[],"cursor":{"path":"...","line":1},"note":"..."}.`

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
  writeJson(
    join(dir, 'contracts.json'),
    locks.filter((l) => l.lockType === 'contract')
  )

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
