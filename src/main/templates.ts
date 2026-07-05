// Bundled, offline templates for new repositories: .gitignore files, license
// texts, and one-click presets that combine them. Kept as inline strings so
// they are bundled into the main-process build (no runtime file reads, works
// fully offline). Adding a new template is just another entry in these maps.

export interface TemplateMeta {
  id: string
  label: string
}

export interface PresetMeta {
  id: string
  label: string
  readme: boolean
  gitignore: string | null
  license: string | null
}

export interface TemplateCatalog {
  gitignore: TemplateMeta[]
  license: TemplateMeta[]
  presets: PresetMeta[]
}

const GITIGNORE: Record<string, { label: string; body: string }> = {
  node: {
    label: 'Node',
    body: `# Dependencies
node_modules/

# Build output
dist/
build/
out/

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment
.env
.env.local

# Editor / OS
.DS_Store
.vscode/
.idea/
`
  },
  python: {
    label: 'Python',
    body: `# Byte-compiled / optimised files
__pycache__/
*.py[cod]
*$py.class

# Virtual environments
.venv/
venv/
env/

# Distribution / packaging
build/
dist/
*.egg-info/

# Testing / coverage
.pytest_cache/
.coverage
htmlcov/

# Environment
.env

# Editor / OS
.DS_Store
.vscode/
.idea/
`
  },
  go: {
    label: 'Go',
    body: `# Binaries
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test binary / output
*.test
*.out

# Go workspace file
go.work

# Dependency directory (uncomment if vendoring)
# vendor/

# Editor / OS
.DS_Store
.vscode/
.idea/
`
  },
  rust: {
    label: 'Rust',
    body: `# Build output
/target/

# Backup files from rustfmt
**/*.rs.bk

# MSVC debug info
*.pdb

# Editor / OS
.DS_Store
.vscode/
.idea/
`
  },
  java: {
    label: 'Java',
    body: `# Compiled class files
*.class

# Log files
*.log

# Packaged archives
*.jar
*.war
*.ear

# Build tools
target/
build/
.gradle/

# Editor / OS
.DS_Store
.vscode/
.idea/
`
  }
}

//{{year}} and {{author}} are substituted at creation time.

const LICENSE: Record<string, { label: string; body: string }> = {
  mit: {
    label: 'MIT',
    body: `MIT License

Copyright (c) {{year}} {{author}}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
  },
  isc: {
    label: 'ISC',
    body: `ISC License

Copyright (c) {{year}} {{author}}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`
  },
  'bsd-3-clause': {
    label: 'BSD 3-Clause',
    body: `BSD 3-Clause License

Copyright (c) {{year}}, {{author}}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`
  },
  unlicense: {
    label: 'The Unlicense',
    body: `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors. We intend this dedication to be an
overt act of relinquishment in perpetuity of all present and future rights to
this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
`
  }
}

const PRESETS: PresetMeta[] = [
  { id: 'minimal', label: 'Minimal (README only)', readme: true, gitignore: null, license: null },
  { id: 'node-mit', label: 'Node + MIT', readme: true, gitignore: 'node', license: 'mit' },
  { id: 'python-mit', label: 'Python + MIT', readme: true, gitignore: 'python', license: 'mit' },
  { id: 'go-mit', label: 'Go + MIT', readme: true, gitignore: 'go', license: 'mit' },
  { id: 'rust-mit', label: 'Rust + MIT', readme: true, gitignore: 'rust', license: 'mit' }
]

//The lists the renderer needs to populate its dropdowns.
export function catalog(): TemplateCatalog {
  return {
    gitignore: Object.entries(GITIGNORE).map(([id, t]) => ({ id, label: t.label })),
    license: Object.entries(LICENSE).map(([id, t]) => ({ id, label: t.label })),
    presets: PRESETS
  }
}

// .gitignore body for a template id, or null if unknown.
export function gitignoreBody(id: string | null | undefined): string | null {
  return id && GITIGNORE[id] ? GITIGNORE[id].body : null
}

/** License text for an id, with {{year}}/{{author}} filled in. */
export function licenseBody(
  id: string | null | undefined,
  author: string,
  year = new Date().getFullYear()
): string | null {
  if (!id || !LICENSE[id]) return null
  return LICENSE[id].body
    .replace(/\{\{year\}\}/g, String(year))
    .replace(/\{\{author\}\}/g, author.trim() || 'the authors')
}
