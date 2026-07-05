// Syntax highlighting shared by the code viewer and markdown code fences.
// One hand-rolled scanner covers the common languages; token classes map to
// the .tok-* rules in styles.css. No highlighter dependency on purpose - the
// dependency list stays short and the output is plain React spans.

export interface Token {
  text: string
  cls: string | null
}

const KEYWORDS: Record<string, string> = {
  js: 'abstract any as async await boolean break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number object of override private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield',
  py: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return self try while with yield',
  sh: 'case do done echo elif else esac exit export fi for function if in local return set shift source then until while',
  ps: 'begin break catch continue do else elseif end filter finally for foreach function if in param process return switch throw trap try until while',
  sql: 'all alter and as asc by create default delete desc distinct drop exists foreign from group having in index inner insert into is join key left limit not null offset on or order outer primary references right select set table union unique update values where',
  c: 'auto bool break case catch char class const constexpr continue default delete do double else enum extern false final float for friend goto if inline int long namespace new noexcept nullptr operator override private protected public register return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while',
  go: 'break case chan const continue default defer else fallthrough false for func go goto if import interface iota map nil package range return select struct switch true type var',
  rs: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  rb: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package permits private protected public record return sealed short static super switch synchronized this throw throws transient true try var void volatile while',
  yaml: 'false no null off on true yes'
}

const EXT_LANG: Record<string, string> = {
  js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js', json: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java', kt: 'java', cs: 'java', swift: 'java',
  c: 'c', h: 'c', cpp: 'c', cc: 'c', hpp: 'c', hh: 'c',
  sh: 'sh', bash: 'sh', zsh: 'sh', ps1: 'ps', psm1: 'ps',
  css: 'css', scss: 'css', less: 'css',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini',
  sql: 'sql', md: 'md', markdown: 'md',
  // markdown fence names
  javascript: 'js', typescript: 'js', python: 'py', ruby: 'rb', rust: 'rs',
  golang: 'go', csharp: 'java', kotlin: 'java', shell: 'sh', console: 'sh',
  powershell: 'ps', dockerfile: 'sh', makefile: 'sh'
}

// Line-comment marker and whether /* */ block comments apply, per language.
const LINE_COMMENT: Record<string, string> = {
  js: '//', c: '//', go: '//', rs: '//', java: '//', json: '//',
  py: '#', sh: '#', ps: '#', yaml: '#', ini: '#', rb: '#',
  sql: '--'
}
const BLOCK_COMMENT = new Set(['js', 'c', 'go', 'rs', 'java', 'css', 'json'])

const MAX_HIGHLIGHT_LINES = 8000

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch)
}
function isIdentChar(ch: string): boolean {
  return /[\w$]/.test(ch)
}

// Inline markdown: `code` spans, emphasis, [text](link).
function mdInline(line: string): Token[] {
  const toks: Token[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|__[^_]+__)|(!?\[[^\]]*\]\([^)]*\))/g
  let last = 0
  for (const m of line.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) toks.push({ text: line.slice(last, idx), cls: null })
    toks.push({ text: m[0], cls: m[1] ? 'str' : m[2] ? 'type' : 'fn' })
    last = idx + m[0].length
  }
  if (last < line.length) toks.push({ text: line.slice(last), cls: null })
  return toks
}

function highlightMarkdown(lines: string[]): Token[][] {
  let inFence = false
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      return [{ text: line, cls: 'com' }]
    }
    if (inFence) return line ? [{ text: line, cls: 'str' }] : []
    if (/^#{1,6}\s/.test(line)) return [{ text: line, cls: 'kw' }]
    if (/^\s*>/.test(line)) return [{ text: line, cls: 'com' }]
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) return [{ text: line, cls: 'com' }]
    if (!line) return []
    const m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/)
    if (m) return [{ text: m[1] + m[2] + m[3], cls: 'num' }, ...mdInline(m[4])]
    return mdInline(line)
  })
}

/** Split text into per-line token arrays. Unknown extensions come back plain. */
export function highlight(text: string, ext: string): Token[][] {
  const rawLines = text.split('\n')
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop()

  const lang = EXT_LANG[ext.toLowerCase().replace(/^\./, '')] ?? ''
  if (!lang || rawLines.length > MAX_HIGHLIGHT_LINES) {
    return rawLines.map((l) => (l ? [{ text: l, cls: null }] : []))
  }
  if (lang === 'md') return highlightMarkdown(rawLines)

  const keywords = new Set((KEYWORDS[lang] ?? '').split(' ').filter(Boolean))
  const lineComment = LINE_COMMENT[lang]
  const hasBlock = BLOCK_COMMENT.has(lang)
  const typeCase = ['js', 'c', 'go', 'rs', 'java'].includes(lang)

  let inBlock = false // carries /* ... */ (or <!-- ... -->) across lines
  const open = lang === 'xml' ? '<!--' : '/*'
  const close = lang === 'xml' ? '-->' : '*/'
  const blockAware = hasBlock || lang === 'xml'

  return rawLines.map((line) => {
    const toks: Token[] = []
    let plain = ''
    const flush = () => {
      if (plain) {
        toks.push({ text: plain, cls: null })
        plain = ''
      }
    }
    const push = (text: string, cls: string | null) => {
      flush()
      toks.push({ text, cls })
    }

    let i = 0
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf(close, i)
        if (end === -1) {
          push(line.slice(i), 'com')
          i = line.length
        } else {
          push(line.slice(i, end + close.length), 'com')
          i = end + close.length
          inBlock = false
        }
        continue
      }
      if (blockAware && line.startsWith(open, i)) {
        inBlock = true
        continue
      }
      if (lineComment && line.startsWith(lineComment, i)) {
        push(line.slice(i), 'com')
        break
      }
      const ch = line[i]
      if (ch === '"' || ch === "'" || ch === '`') {
        let j = i + 1
        while (j < line.length && line[j] !== ch) {
          if (line[j] === '\\') j++
          j++
        }
        push(line.slice(i, Math.min(j + 1, line.length)), 'str')
        i = Math.min(j + 1, line.length)
        continue
      }
      if (/\d/.test(ch) && (i === 0 || !isIdentChar(line[i - 1]))) {
        let j = i + 1
        while (j < line.length && /[\w.]/.test(line[j])) j++
        push(line.slice(i, j), 'num')
        i = j
        continue
      }
      if (isIdentStart(ch)) {
        let j = i + 1
        while (j < line.length && isIdentChar(line[j])) j++
        const word = line.slice(i, j)
        let k = j
        while (k < line.length && line[k] === ' ') k++
        const lower = lang === 'sql' ? word.toLowerCase() : word
        if (keywords.has(lower)) push(word, 'kw')
        else if (line[k] === '(') push(word, 'fn')
        else if (typeCase && /^[A-Z]/.test(word)) push(word, 'type')
        else plain += word
        i = j
        continue
      }
      plain += ch
      i++
    }
    flush()
    return toks
  })
}

export function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot + 1) : ''
}

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}
