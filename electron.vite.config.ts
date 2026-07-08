import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// HYDRO_LITE=1 builds the lite flavor: the live-collaboration code is
// compiled out entirely (dead branches, so the rtc chunks never get
// emitted). `npm run package:lite` sets it for you.
const collab = JSON.stringify(process.env.HYDRO_LITE !== '1')

export default defineConfig({
  main: {
    define: { __COLLAB__: collab },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    define: { __COLLAB__: collab },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
