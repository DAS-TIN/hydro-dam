// GitHub / GitLab / Bitbucket / Azure DevOps integration: parse the origin
// remote, validate access tokens, and list/create pull (merge) requests and list
// issues over each provider's REST API. Uses the global fetch (Electron's Node
// has it). github.com / gitlab.com / bitbucket.org / dev.azure.com are detected
// automatically; Enterprise / self-hosted GitHub & GitLab hosts come from
// connected accounts.

export type Provider = 'github' | 'gitlab' | 'bitbucket' | 'azure'

export interface RemoteRepo {
  provider: Provider
  host: string
  owner: string
  repo: string
  slug: string // owner/repo (gitlab: full namespace path; azure: org/project/repo)
  webUrl: string
  azure?: { org: string; project: string; repo: string }
}

export interface PullRequest {
  number: number
  title: string
  author: string
  head: string
  base: string
  url: string
  draft: boolean
  state: string
  updatedAt: string
}

export interface NewPull {
  title: string
  head: string
  base: string
  body?: string
}

export interface Issue {
  number: number
  title: string
  author: string
  url: string
  state: string // normalised: 'open' | 'closed'
  labels: string[]
  updatedAt: string
  milestone?: string
  assignees?: string[]
  // Sub-issue progress (GitHub sends sub_issues_summary on the issue object).
  subTotal?: number
  subCompleted?: number
}

export type HostProviders = Record<string, Provider>

function detectProvider(host: string): Provider | null {
  if (/(^|\.)github\.com$/i.test(host)) return 'github'
  if (/(^|\.)gitlab\.com$/i.test(host)) return 'gitlab'
  if (/(^|\.)bitbucket\.org$/i.test(host)) return 'bitbucket'
  if (
    /(^|\.)dev\.azure\.com$/i.test(host) ||
    /\.visualstudio\.com$/i.test(host) ||
    host === 'ssh.dev.azure.com' ||
    host === 'vs-ssh.visualstudio.com'
  )
    return 'azure'
  return null
}

// Azure DevOps URLs come in three shapes (dev.azure.com, visualstudio.com
// subdomains, and the ssh form) and nest the repo under org and project.
// Sort them out here so the rest of the code can read repo.azure.{org,project,repo}.
function parseAzure(host: string, path: string): RemoteRepo | null {
  let segs = path.split('/').filter(Boolean)
  let org = ''
  if (host === 'ssh.dev.azure.com' || host === 'vs-ssh.visualstudio.com') {
    if (segs[0] === 'v3') segs = segs.slice(1)
    org = segs[0]
    const project = segs[1]
    const repo = segs[2] || segs[segs.length - 1]
    if (!org || !project || !repo) return null
    return azureRepo(org, project, repo)
  }
  if (/\.visualstudio\.com$/i.test(host)) {
    org = host.split('.')[0]
    const c = segs.filter((s) => s !== '_git')
    const project = c[0]
    const repo = c[1] || c[c.length - 1]
    if (!org || !project || !repo) return null
    return azureRepo(org, project, repo)
  }
  //dev.azure.com/{org}/{project}/_git/{repo}
  const c = segs.filter((s) => s !== '_git')
  org = c[0]
  const project = c[1]
  const repo = c[2] || c[c.length - 1]
  if (!org || !project || !repo) return null
  return azureRepo(org, project, repo)
}

function azureRepo(org: string, project: string, repo: string): RemoteRepo {
  return {
    provider: 'azure',
    host: 'dev.azure.com',
    owner: `${org}/${project}`,
    repo,
    slug: `${org}/${project}/${repo}`,
    webUrl: `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}`,
    azure: { org, project, repo }
  }
}

/** Parse an origin URL (https or ssh) into a known provider repo, or null. */
export function parseRemote(url: string | null, hosts: HostProviders = {}): RemoteRepo | null {
  if (!url) return null
  let host = ''
  let path = ''
  let m = url.match(/^[A-Za-z0-9_.-]+@([^:]+):(.+?)(?:\.git)?$/) // scp-like ssh
  if (m) {
    host = m[1]
    path = m[2]
  } else {
    m = url.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/)
    if (m) {
      host = m[1]
      path = m[2]
    }
  }
  if (!host || !path) return null
  path = path.replace(/\/+$/, '')
  const provider = hosts[host] ?? detectProvider(host)
  if (!provider) return null
  if (provider === 'azure') return parseAzure(host, path)
  const segs = path.split('/')
  const repo = segs[segs.length - 1]
  const owner = segs.slice(0, -1).join('/')
  return { provider, host, owner, repo, slug: path, webUrl: `https://${host}/${path}` }
}

const githubApi = (host: string) =>
  /(^|\.)github\.com$/i.test(host) ? 'https://api.github.com' : `https://${host}/api/v3`
const gitlabApi = (host: string) => `https://${host}/api/v4`

async function http(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init)
  const body = await res.text()
  let json: any = null
  try {
    json = body ? JSON.parse(body) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg = (json && (json.message || json.error || json.error_description)) || body || res.statusText
    throw new Error(`${res.status} ${msg}`)
  }
  return json
}

const UA = 'hydrodam-git-client'
const ghHeaders = (token?: string): Record<string, string> => {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': UA }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}
const glHeaders = (token?: string): Record<string, string> => {
  const h: Record<string, string> = { 'User-Agent': UA }
  if (token) h['PRIVATE-TOKEN'] = token
  return h
}
const bbHeaders = (token?: string): Record<string, string> => {
  const h: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}
const azHeaders = (token?: string): Record<string, string> => {
  const h: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA }
  if (token) h.Authorization = `Basic ${Buffer.from(':' + token).toString('base64')}`
  return h
}

/** Verify a token by fetching the authenticated user; returns the username.
 * For Azure, host must be the org (the connect form asks for it). */
export async function validateToken(
  provider: Provider,
  host: string,
  token: string
): Promise<{ username: string }> {
  if (!token.trim()) throw new Error('Enter a token first.')
  if (provider === 'github') {
    const u = await http(`${githubApi(host)}/user`, { headers: ghHeaders(token) })
    return { username: u.login || '' }
  }
  if (provider === 'gitlab') {
    const u = await http(`${gitlabApi(host)}/user`, { headers: glHeaders(token) })
    return { username: u.username || '' }
  }
  if (provider === 'bitbucket') {
    const u = await http('https://api.bitbucket.org/2.0/user', { headers: bbHeaders(token) })
    return { username: u.username || u.nickname || u.display_name || '' }
  }
  //Azure: host carries the org
  const org = host.replace(/^https?:\/\//, '').replace(/^dev\.azure\.com\//, '').replace(/\/$/, '')
  if (!org || org === 'dev.azure.com') throw new Error('Enter your Azure DevOps organization.')
  await http(`https://dev.azure.com/${org}/_apis/projects?api-version=7.0`, { headers: azHeaders(token) })
  return { username: org }
}

export interface OwnedRepo {
  name: string // short name (last path segment)
  fullName: string // owner/repo or full namespace path
  cloneUrl: string // https clone url
  private: boolean
  description: string
  updatedAt: string
}

/** List repositories the token's user can clone (owner / member), for the clone picker.
 * GitHub and GitLab only - anything else throws. */
export async function listOwnedRepos(
  provider: Provider,
  host: string,
  token: string
): Promise<OwnedRepo[]> {
  if (!token.trim()) throw new Error('Connect an account first.')
  if (provider === 'github') {
    const data = await http(
      `${githubApi(host)}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`,
      { headers: ghHeaders(token) }
    )
    return (data || []).map((r: any) => ({
      name: r.name,
      fullName: r.full_name,
      cloneUrl: r.clone_url,
      private: !!r.private,
      description: r.description || '',
      updatedAt: r.updated_at || ''
    }))
  }
  if (provider === 'gitlab') {
    const data = await http(
      `${gitlabApi(host)}/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true`,
      { headers: glHeaders(token) }
    )
    return (data || []).map((r: any) => ({
      name: r.path,
      fullName: r.path_with_namespace,
      cloneUrl: r.http_url_to_repo,
      private: r.visibility !== 'public',
      description: r.description || '',
      updatedAt: r.last_activity_at || ''
    }))
  }
  throw new Error('Browsing repositories is only supported for GitHub and GitLab.')
}

/** List open pull/merge requests for the repo behind originUrl. */
export async function listPulls(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined
): Promise<{ repo: RemoteRepo | null; pulls: PullRequest[] }> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo) return { repo: null, pulls: [] }

  if (repo.provider === 'github') {
    const data = await http(`${githubApi(repo.host)}/repos/${repo.slug}/pulls?state=open&per_page=50`, {
      headers: ghHeaders(token)
    })
    return {
      repo,
      pulls: (data || []).map((p: any) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login || '',
        head: p.head?.ref || '',
        base: p.base?.ref || '',
        url: p.html_url,
        draft: !!p.draft,
        state: p.state,
        updatedAt: p.updated_at
      }))
    }
  }

  if (repo.provider === 'gitlab') {
    const id = encodeURIComponent(repo.slug)
    const data = await http(`${gitlabApi(repo.host)}/projects/${id}/merge_requests?state=opened&per_page=50`, {
      headers: glHeaders(token)
    })
    return {
      repo,
      pulls: (data || []).map((p: any) => ({
        number: p.iid,
        title: p.title,
        author: p.author?.username || '',
        head: p.source_branch || '',
        base: p.target_branch || '',
        url: p.web_url,
        draft: !!p.draft,
        state: p.state,
        updatedAt: p.updated_at
      }))
    }
  }

  if (repo.provider === 'bitbucket') {
    const data = await http(
      `https://api.bitbucket.org/2.0/repositories/${repo.slug}/pullrequests?state=OPEN&pagelen=50`,
      { headers: bbHeaders(token) }
    )
    return {
      repo,
      pulls: (data?.values || []).map((p: any) => ({
        number: p.id,
        title: p.title,
        author: p.author?.display_name || p.author?.nickname || '',
        head: p.source?.branch?.name || '',
        base: p.destination?.branch?.name || '',
        url: p.links?.html?.href || '',
        draft: false,
        state: p.state,
        updatedAt: p.updated_on
      }))
    }
  }

  //Azure
  const az = repo.azure!
  const url = `https://dev.azure.com/${az.org}/${encodeURIComponent(az.project)}/_apis/git/repositories/${encodeURIComponent(
    az.repo
  )}/pullrequests?searchCriteria.status=active&api-version=7.0`
  const data = await http(url, { headers: azHeaders(token) })
  return {
    repo,
    pulls: (data?.value || []).map((p: any) => ({
      number: p.pullRequestId,
      title: p.title,
      author: p.createdBy?.displayName || '',
      head: (p.sourceRefName || '').replace('refs/heads/', ''),
      base: (p.targetRefName || '').replace('refs/heads/', ''),
      url: `${repo.webUrl}/pullrequest/${p.pullRequestId}`,
      draft: !!p.isDraft,
      state: p.status,
      updatedAt: p.creationDate
    }))
  }
}

/** Open a new pull/merge request. Requires a token for the provider. */
export async function createPull(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined,
  pull: NewPull
): Promise<PullRequest> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo) throw new Error('origin is not a supported remote.')
  if (!token) throw new Error(`Connect a ${repo.provider} account in Settings first.`)

  if (repo.provider === 'github') {
    const p = await http(`${githubApi(repo.host)}/repos/${repo.slug}/pulls`, {
      method: 'POST',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: pull.title, head: pull.head, base: pull.base, body: pull.body || '' })
    })
    return mapOne(p, repo, pull)
  }
  if (repo.provider === 'gitlab') {
    const id = encodeURIComponent(repo.slug)
    const p = await http(`${gitlabApi(repo.host)}/projects/${id}/merge_requests`, {
      method: 'POST',
      headers: { ...glHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: pull.title,
        source_branch: pull.head,
        target_branch: pull.base,
        description: pull.body || ''
      })
    })
    return mapOne(p, repo, pull)
  }
  if (repo.provider === 'bitbucket') {
    const p = await http(`https://api.bitbucket.org/2.0/repositories/${repo.slug}/pullrequests`, {
      method: 'POST',
      headers: { ...bbHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: pull.title,
        source: { branch: { name: pull.head } },
        destination: { branch: { name: pull.base } },
        description: pull.body || ''
      })
    })
    return mapOne(p, repo, pull)
  }
  //azure
  const az = repo.azure!
  const url = `https://dev.azure.com/${az.org}/${encodeURIComponent(az.project)}/_apis/git/repositories/${encodeURIComponent(
    az.repo
  )}/pullrequests?api-version=7.0`
  const p = await http(url, {
    method: 'POST',
    headers: { ...azHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: pull.title,
      sourceRefName: `refs/heads/${pull.head}`,
      targetRefName: `refs/heads/${pull.base}`,
      description: pull.body || ''
    })
  })
  return mapOne(p, repo, pull)
}

//Map a freshly-created PR object to our shape, whatever provider it came from.
function mapOne(p: any, repo: RemoteRepo, pull: NewPull): PullRequest {
  if (repo.provider === 'github')
    return { number: p.number, title: p.title, author: p.user?.login || '', head: p.head?.ref || pull.head, base: p.base?.ref || pull.base, url: p.html_url, draft: !!p.draft, state: p.state, updatedAt: p.updated_at }
  if (repo.provider === 'gitlab')
    return { number: p.iid, title: p.title, author: p.author?.username || '', head: p.source_branch || pull.head, base: p.target_branch || pull.base, url: p.web_url, draft: !!p.draft, state: p.state, updatedAt: p.updated_at }
  if (repo.provider === 'bitbucket')
    return { number: p.id, title: p.title, author: p.author?.display_name || '', head: p.source?.branch?.name || pull.head, base: p.destination?.branch?.name || pull.base, url: p.links?.html?.href || '', draft: false, state: p.state, updatedAt: p.updated_on }
  return { number: p.pullRequestId, title: p.title, author: p.createdBy?.displayName || '', head: pull.head, base: pull.base, url: `${repo.webUrl}/pullrequest/${p.pullRequestId}`, draft: !!p.isDraft, state: p.status, updatedAt: p.creationDate }
}

// List open issues for the repo behind originUrl. mentioned=true narrows to
// issues that mention the authenticated user (GitHub only; needs a token).
export async function listIssues(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined,
  mentioned = false
): Promise<{ repo: RemoteRepo | null; issues: Issue[] }> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo) return { repo: null, issues: [] }

  if (repo.provider === 'github') {
    let query = 'state=all&per_page=100&sort=updated'
    if (mentioned && token) {
      const me = await http(`${githubApi(repo.host)}/user`, { headers: ghHeaders(token) })
      if (me?.login) query += `&mentioned=${encodeURIComponent(me.login)}`
    }
    const data = await http(`${githubApi(repo.host)}/repos/${repo.slug}/issues?${query}`, {
      headers: ghHeaders(token)
    })
    return {
      repo,
      issues: (data || [])
        .filter((it: any) => !it.pull_request)
        .map((it: any) => ({
          number: it.number,
          title: it.title,
          author: it.user?.login || '',
          url: it.html_url,
          state: it.state === 'closed' ? 'closed' : 'open',
          labels: (it.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name)),
          updatedAt: it.updated_at,
          milestone: it.milestone?.title || undefined,
          assignees: (it.assignees || []).map((a: any) => a.login),
          subTotal: it.sub_issues_summary?.total || 0,
          subCompleted: it.sub_issues_summary?.completed || 0
        }))
    }
  }

  if (repo.provider === 'gitlab') {
    const id = encodeURIComponent(repo.slug)
    // No state param = opened and closed together.
    const data = await http(`${gitlabApi(repo.host)}/projects/${id}/issues?per_page=100`, {
      headers: glHeaders(token)
    })
    return {
      repo,
      issues: (data || []).map((it: any) => ({
        number: it.iid,
        title: it.title,
        author: it.author?.username || '',
        url: it.web_url,
        state: it.state === 'closed' ? 'closed' : 'open',
        labels: it.labels || [],
        updatedAt: it.updated_at,
        milestone: it.milestone?.title || undefined,
        assignees: (it.assignees || []).map((a: any) => a.username)
      }))
    }
  }

  if (repo.provider === 'bitbucket') {
    const data = await http(
      `https://api.bitbucket.org/2.0/repositories/${repo.slug}/issues?q=${encodeURIComponent('state="new"')}&pagelen=50`,
      { headers: bbHeaders(token) }
    ).catch(() => ({ values: [] })) // issues may be disabled on the repo
    return {
      repo,
      issues: (data?.values || []).map((it: any) => ({
        number: it.id,
        title: it.title,
        author: it.reporter?.display_name || it.reporter?.nickname || '',
        url: it.links?.html?.href || '',
        state: it.state,
        labels: it.kind ? [it.kind] : [],
        updatedAt: it.updated_on
      }))
    }
  }

  //azure work items need a different (WIQL) API; not supported here yet.
  return { repo, issues: [] }
}

/** Post a comment on an issue. Returns the comment URL when the API gives one. */
export async function commentOnIssue(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined,
  issueNumber: number,
  body: string
): Promise<string> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo) throw new Error('origin is not a recognised remote.')
  if (!token) throw new Error('No account connected for this provider. Add one under Connections.')
  if (repo.provider === 'github') {
    const c = await http(`${githubApi(repo.host)}/repos/${repo.slug}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: { ...ghHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({ body })
    })
    return c?.html_url || ''
  }
  if (repo.provider === 'gitlab') {
    const id = encodeURIComponent(repo.slug)
    await http(`${gitlabApi(repo.host)}/projects/${id}/issues/${issueNumber}/notes`, {
      method: 'POST',
      headers: { ...glHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({ body })
    })
    return ''
  }
  if (repo.provider === 'bitbucket') {
    await http(`https://api.bitbucket.org/2.0/repositories/${repo.slug}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: { ...bbHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({ content: { raw: body } })
    })
    return ''
  }
  throw new Error('Commenting is not supported for this provider yet.')
}

export interface Milestone {
  title: string
  description: string
  dueOn: string | null
  openIssues: number
  closedIssues: number
  url: string
}

/** Open milestones with progress counts and due dates (GitHub and GitLab). */
export async function listMilestones(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined
): Promise<Milestone[]> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo) return []
  if (repo.provider === 'github') {
    const data = await http(
      `${githubApi(repo.host)}/repos/${repo.slug}/milestones?state=open&sort=due_on&per_page=50`,
      { headers: ghHeaders(token) }
    ).catch(() => [])
    return (data || []).map((m: any) => ({
      title: m.title,
      description: m.description || '',
      dueOn: m.due_on || null,
      openIssues: m.open_issues ?? 0,
      closedIssues: m.closed_issues ?? 0,
      url: m.html_url
    }))
  }
  if (repo.provider === 'gitlab') {
    const id = encodeURIComponent(repo.slug)
    const data = await http(`${gitlabApi(repo.host)}/projects/${id}/milestones?state=active&per_page=50`, {
      headers: glHeaders(token)
    }).catch(() => [])
    return (data || []).map((m: any) => ({
      title: m.title,
      description: m.description || '',
      dueOn: m.due_date || null,
      openIssues: 0, // GitLab needs a second call per milestone; skipped
      closedIssues: 0,
      url: m.web_url
    }))
  }
  return []
}

/** Language share of the codebase as reported by the host, largest first. */
export async function repoLanguages(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined
): Promise<{ name: string; share: number }[]> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo) return []
  if (repo.provider === 'github') {
    const data = await http(`${githubApi(repo.host)}/repos/${repo.slug}/languages`, {
      headers: ghHeaders(token)
    }).catch(() => null)
    if (!data) return []
    const total = Object.values(data).reduce((n: number, v: any) => n + v, 0) as number
    if (!total) return []
    return Object.entries(data)
      .map(([name, bytes]) => ({ name, share: ((bytes as number) / total) * 100 }))
      .sort((a, b) => b.share - a.share)
  }
  if (repo.provider === 'gitlab') {
    const id = encodeURIComponent(repo.slug)
    const data = await http(`${gitlabApi(repo.host)}/projects/${id}/languages`, {
      headers: glHeaders(token)
    }).catch(() => null)
    if (!data) return []
    return Object.entries(data)
      .map(([name, share]) => ({ name, share: share as number }))
      .sort((a, b) => b.share - a.share)
  }
  return []
}

// One security feature's availability, decided from the API response:
// 200 -> ok (with alert count), 403 -> token lacks access or plan lacks the
// feature, 404 -> feature disabled on the repo.
export interface SecurityFeature {
  state: 'ok' | 'forbidden' | 'disabled'
  count: number
}

export interface SecurityOverview {
  supported: boolean
  dependabot: SecurityFeature
  codeScanning: SecurityFeature
  secretScanning: SecurityFeature
  pushProtection: 'enabled' | 'disabled' | 'unknown'
}

/** GitHub security posture: alert counts where readable, plan gaps where not. */
export async function securityOverview(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined
): Promise<SecurityOverview> {
  const none: SecurityFeature = { state: 'disabled', count: 0 }
  const repo = parseRemote(originUrl, hosts)
  if (!repo || repo.provider !== 'github') {
    return { supported: false, dependabot: none, codeScanning: none, secretScanning: none, pushProtection: 'unknown' }
  }

  const probe = async (path: string): Promise<SecurityFeature> => {
    try {
      const data = await http(`${githubApi(repo.host)}/repos/${repo.slug}/${path}?state=open&per_page=100`, {
        headers: ghHeaders(token)
      })
      return { state: 'ok', count: Array.isArray(data) ? data.length : 0 }
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.startsWith('403')) return { state: 'forbidden', count: 0 }
      return { state: 'disabled', count: 0 }
    }
  }

  const [dependabot, codeScanning, secretScanning, repoInfo] = await Promise.all([
    probe('dependabot/alerts'),
    probe('code-scanning/alerts'),
    probe('secret-scanning/alerts'),
    http(`${githubApi(repo.host)}/repos/${repo.slug}`, { headers: ghHeaders(token) }).catch(() => null)
  ])

  // security_and_analysis is only present for admins / advanced-security repos.
  const pp = repoInfo?.security_and_analysis?.secret_scanning_push_protection?.status
  return {
    supported: true,
    dependabot,
    codeScanning,
    secretScanning,
    pushProtection: pp === 'enabled' ? 'enabled' : pp === 'disabled' ? 'disabled' : 'unknown'
  }
}

/** Close an issue, optionally posting a comment first (e.g. "Fixed by merge"). */
export async function closeIssue(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined,
  issueNumber: number,
  comment?: string
): Promise<void> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo) throw new Error('origin is not a recognised remote.')
  if (!token) throw new Error('No account connected for this provider. Add one under Connections.')
  if (comment?.trim()) await commentOnIssue(originUrl, hosts, token, issueNumber, comment.trim())
  if (repo.provider === 'github') {
    await http(`${githubApi(repo.host)}/repos/${repo.slug}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: { ...ghHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'closed' })
    })
    return
  }
  if (repo.provider === 'gitlab') {
    const id = encodeURIComponent(repo.slug)
    await http(`${gitlabApi(repo.host)}/projects/${id}/issues/${issueNumber}?state_event=close`, {
      method: 'PUT',
      headers: glHeaders(token)
    })
    return
  }
  throw new Error('Closing issues is not supported for this provider yet.')
}

/** Reopen a closed issue. */
export async function reopenIssue(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined,
  issueNumber: number
): Promise<void> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo) throw new Error('origin is not a recognised remote.')
  if (!token) throw new Error('No account connected for this provider. Add one under Connections.')
  if (repo.provider === 'github') {
    await http(`${githubApi(repo.host)}/repos/${repo.slug}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: { ...ghHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'open' })
    })
    return
  }
  if (repo.provider === 'gitlab') {
    const id = encodeURIComponent(repo.slug)
    await http(`${gitlabApi(repo.host)}/projects/${id}/issues/${issueNumber}?state_event=reopen`, {
      method: 'PUT',
      headers: glHeaders(token)
    })
    return
  }
  throw new Error('Reopening issues is not supported for this provider yet.')
}

export interface WorkflowRun {
  id: number
  name: string
  branch: string
  status: string // queued | in_progress | completed
  conclusion: string // success | failure | cancelled | ... ('' while running)
  url: string
  updatedAt: string
}

/** Latest GitHub Actions runs. Other providers return an empty list. */
export async function listWorkflowRuns(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined
): Promise<WorkflowRun[]> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo || repo.provider !== 'github') return []
  const data = await http(`${githubApi(repo.host)}/repos/${repo.slug}/actions/runs?per_page=8`, {
    headers: ghHeaders(token)
  }).catch(() => null)
  return (data?.workflow_runs || []).map((r: any) => ({
    id: r.id,
    name: r.name || r.display_title || 'workflow',
    branch: r.head_branch || '',
    status: r.status || '',
    conclusion: r.conclusion || '',
    url: r.html_url,
    updatedAt: r.updated_at
  }))
}

/** Fork the repo into the authenticated user's namespace; returns the fork's web URL. */
export async function forkRepo(
  originUrl: string | null,
  hosts: HostProviders,
  token: string | undefined
): Promise<string> {
  const repo = parseRemote(originUrl, hosts)
  if (!repo) throw new Error('origin is not a recognised remote.')
  if (!token) throw new Error('No account connected for this provider. Add one under Connections.')
  if (repo.provider === 'github') {
    const f = await http(`${githubApi(repo.host)}/repos/${repo.slug}/forks`, {
      method: 'POST',
      headers: ghHeaders(token)
    })
    return f?.html_url || ''
  }
  if (repo.provider === 'gitlab') {
    const id = encodeURIComponent(repo.slug)
    const f = await http(`${gitlabApi(repo.host)}/projects/${id}/fork`, {
      method: 'POST',
      headers: glHeaders(token)
    })
    return f?.web_url || ''
  }
  throw new Error('Forking is supported for GitHub and GitLab only.')
}

export interface DeviceStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
}

export async function deviceStart(clientId: string): Promise<DeviceStart> {
  if (!clientId.trim()) throw new Error('Enter your GitHub OAuth app client id.')
  const r = await http('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ client_id: clientId, scope: 'repo read:org' })
  })
  return { deviceCode: r.device_code, userCode: r.user_code, verificationUri: r.verification_uri, interval: r.interval || 5 }
}

export async function devicePoll(
  clientId: string,
  deviceCode: string
): Promise<{ token?: string; pending?: boolean; error?: string }> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  })
  const j: any = await res.json().catch(() => ({}))
  if (j.access_token) return { token: j.access_token }
  if (j.error === 'authorization_pending' || j.error === 'slow_down') return { pending: true }
  return { error: j.error_description || j.error || 'Authorization failed.' }
}

export interface TrackerItem {
  id: string
  title: string
  url: string
  status: string
}

export async function listJira(site: string, email: string, token: string): Promise<TrackerItem[]> {
  const base = site.replace(/\/+$/, '')
  const auth = Buffer.from(`${email}:${token}`).toString('base64')
  const jql = encodeURIComponent('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC')
  const r = await http(`${base}/rest/api/3/search?jql=${jql}&maxResults=50&fields=summary,status`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'User-Agent': UA }
  })
  return (r.issues || []).map((it: any) => ({
    id: it.key,
    title: it.fields?.summary || '',
    url: `${base}/browse/${it.key}`,
    status: it.fields?.status?.name || ''
  }))
}

export async function listTrello(key: string, token: string): Promise<TrackerItem[]> {
  const url = `https://api.trello.com/1/members/me/cards?fields=name,url,shortLink&key=${encodeURIComponent(
    key
  )}&token=${encodeURIComponent(token)}`
  const r = await http(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
  return (r || []).map((c: any) => ({ id: c.shortLink || c.id, title: c.name, url: c.url, status: '' }))
}

export interface TrelloList {
  id: string
  name: string
  cards: TrackerItem[]
}

export async function listTrelloBoard(key: string, token: string, boardId: string): Promise<TrelloList[]> {
  const q = `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`
  const hdrs = { Accept: 'application/json', 'User-Agent': UA }
  const [lists, cards] = await Promise.all([
    http(`https://api.trello.com/1/boards/${boardId}/lists?${q}`, { headers: hdrs }),
    http(`https://api.trello.com/1/boards/${boardId}/cards?fields=name,idList,url,shortLink,labels&${q}`, { headers: hdrs })
  ])
  return (lists || []).map((l: any) => ({
    id: l.id,
    name: l.name,
    cards: (cards || [])
      .filter((c: any) => c.idList === l.id)
      .map((c: any) => ({
        id: c.shortLink || c.id,
        title: c.name,
        url: c.url,
        status: l.name
      }))
  }))
}
