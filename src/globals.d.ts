// Compile-time flags injected by electron.vite.config.ts.

// False in lite builds (HYDRO_LITE=1): every `if (__COLLAB__)` branch is
// removed at build time, so the collaboration code never ships.
declare const __COLLAB__: boolean
