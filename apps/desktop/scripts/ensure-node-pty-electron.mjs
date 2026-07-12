#!/usr/bin/env node
// ensure-node-pty-electron.mjs — makes sure node-pty has a native binary
// that Electron can actually load before stage-native-deps copies it.
//
// node-pty publishes no linux prebuild, and even when its install script
// is allowed to run it compiles against the host Node ABI — which Electron
// refuses to load. This script rebuilds node-pty against the workspace's
// Electron version, but only when needed:
//   - a published prebuild exists for the host platform/arch → skip
//   - build/Release/pty.node exists and our stamp says it was already
//     rebuilt for this Electron version → skip
//   - otherwise → run @electron/rebuild -w node-pty and write the stamp
//
// The stamp lives inside build/Release so a fresh `npm ci` (which wipes
// node_modules, and whose install script produces a Node-ABI binary with
// no stamp) always triggers a rebuild.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { isMain } from './utils.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const require = createRequire(import.meta.url)

const STAMP_NAME = '.hermes-electron-abi'

function resolvePkgRoot(name) {
  return dirname(require.resolve(`${name}/package.json`, { paths: [projectRoot] }))
}

export function ensureNodePtyForElectron() {
  const ptyRoot = resolvePkgRoot('node-pty')
  const target = `${process.platform}-${process.arch}`

  // A published prebuild for the host target loads fine in Electron
  // (they're built with the NAPI/Electron matrix upstream) — nothing to do.
  if (existsSync(join(ptyRoot, 'prebuilds', target))) {
    console.log(`[ensure-node-pty] prebuild exists for ${target}; no rebuild needed`)
    return
  }

  const electronVersion = require(
    require.resolve('electron/package.json', { paths: [projectRoot] })
  ).version

  const releaseDir = join(ptyRoot, 'build/Release')
  const stampPath = join(releaseDir, STAMP_NAME)
  if (existsSync(join(releaseDir, 'pty.node')) && existsSync(stampPath)) {
    const stamped = readFileSync(stampPath, 'utf8').trim()
    if (stamped === electronVersion) {
      console.log(`[ensure-node-pty] pty.node already built for Electron ${electronVersion}`)
      return
    }
  }

  console.log(
    `[ensure-node-pty] no ${target} prebuild and no Electron-ABI build; ` +
      `rebuilding node-pty for Electron ${electronVersion}...`
  )
  // @electron/rebuild's exports expose only its entry point (lib/main.js);
  // the CLI is a sibling file in the same directory.
  const rebuildCli = join(
    dirname(require.resolve('@electron/rebuild', { paths: [projectRoot] })),
    'cli.js'
  )
  const result = spawnSync(
    process.execPath,
    [rebuildCli, '-v', electronVersion, '-w', 'node-pty', '-m', projectRoot],
    { cwd: projectRoot, stdio: 'inherit' }
  )
  if (result.status !== 0) {
    console.error('[ensure-node-pty] electron-rebuild failed; the packaged app would crash on launch')
    process.exit(result.status ?? 1)
  }
  if (!existsSync(join(releaseDir, 'pty.node'))) {
    console.error(`[ensure-node-pty] rebuild reported success but ${join(releaseDir, 'pty.node')} is missing`)
    process.exit(1)
  }
  writeFileSync(stampPath, `${electronVersion}\n`)
  console.log(`[ensure-node-pty] rebuilt pty.node for Electron ${electronVersion}`)
}

if (isMain(import.meta.url)) {
  ensureNodePtyForElectron()
}
