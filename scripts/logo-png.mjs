// Renders src/renderer/src/icons/logo.svg to logo.png (512px, transparent).
// The traced SVG is ~220 KB of path data and Chromium re-rasterizes it at
// every drawn size, which visibly stalls the UI; the app ships this PNG
// instead. Rerun after changing the artwork:
//
//   npx electron scripts/logo-png.mjs

import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'src', 'renderer', 'src', 'icons', 'logo.svg')
const outPath = join(root, 'src', 'renderer', 'src', 'icons', 'logo.png')
const SIZE = 512

app.whenReady().then(async () => {
  const svg = readFileSync(svgPath).toString('base64')
  const html =
    `<!doctype html><html><body style="margin:0;background:transparent">` +
    `<img id="logo" width="${SIZE}" height="${SIZE}" style="display:block" ` +
    `src="data:image/svg+xml;base64,${svg}"></body></html>`

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await win.webContents.executeJavaScript('document.getElementById("logo").decode()')
  const image = await win.webContents.capturePage()
  writeFileSync(outPath, image.toPNG())
  const { width, height } = image.getSize()
  console.log(`Wrote ${outPath} (${width}x${height})`)
  app.exit(0)
})
