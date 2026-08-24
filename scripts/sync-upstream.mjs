#!/usr/bin/env node
/**
 * Sync upstream submodule build artifacts into desktop node_modules.
 *
 * Usage:
 *   node scripts/sync-upstream.mjs                          # build & sync all upstream packages
 *   node scripts/sync-upstream.mjs --packages dsh-web-app   # sync specific packages only
 *   node scripts/sync-upstream.mjs --dry-run                # show what would be copied
 *
 * The script builds inside the deepseek-harness submodule, then copies
 * each package's lib/ output into the corresponding node_modules path.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const submoduleDir = resolve(root, 'deepseek-harness')
const packagesDir = resolve(submoduleDir, 'packages')

const dryRun = process.argv.includes('--dry-run')
const packagesIdx = process.argv.indexOf('--packages')
const filterNames = packagesIdx !== -1
  ? process.argv.slice(packagesIdx + 1)
  : null

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

function findNpmPackages(dir, results = []) {
  const pkgPath = join(dir, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (pkg.name?.startsWith('@deepseek-ai/dsh')) {
      results.push({ name: pkg.name, dir })
    }
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'lib') {
      findNpmPackages(join(dir, entry.name), results)
    }
  }
  return results
}

// Discover all upstream packages
const allPackages = findNpmPackages(packagesDir)
console.log(`Found ${allPackages.length} upstream @deepseek-ai/dsh* packages`)

// Apply filter if specified
const targetPackages = filterNames
  ? allPackages.filter(p => filterNames.some(f => p.name.includes(f)))
  : allPackages

if (filterNames && targetPackages.length === 0) {
  console.error(`No packages matched filter: ${filterNames.join(', ')}`)
  process.exit(1)
}

console.log(`Will sync ${targetPackages.length} packages${filterNames ? ` (filtered from ${allPackages.length})` : ''}`)

// Build upstream
if (!dryRun) {
  console.log('\n=== Building upstream packages ===')
  run('corepack', ['pnpm', 'install', '--frozen-lockfile'], submoduleDir)
  run('corepack', ['pnpm', 'run', 'build'], submoduleDir)
}

// Find desktop node_modules targets
const desktopNodeModules = resolve(root, 'dsh-plugin-desktop', 'node_modules', '@deepseek-ai')
const desktopDeps = existsSync(desktopNodeModules)
  ? new Set(readdirSync(desktopNodeModules))
  : new Set()

let synced = 0
let skipped = 0

console.log('\n=== Syncing build artifacts ===')
for (const pkg of targetPackages) {
  const shortName = pkg.name.replace('@deepseek-ai/', '')
  const libDir = join(pkg.dir, 'lib')

  if (!existsSync(libDir)) {
    console.log(`  ⏭ ${shortName} (no lib/ output)`)
    skipped++
    continue
  }

  if (!desktopDeps.has(shortName)) {
    console.log(`  ⏭ ${shortName} (not in desktop dependencies)`)
    skipped++
    continue
  }

  const targetDir = join(desktopNodeModules, shortName, 'lib')

  if (dryRun) {
    console.log(`  🔍 ${shortName} → ${targetDir}`)
  } else {
    rmSync(targetDir, { recursive: true, force: true })
    cpSync(libDir, targetDir, { recursive: true })
    console.log(`  ✅ ${shortName}`)
  }
  synced++
}

console.log(`\nDone: ${synced} synced, ${skipped} skipped`)
if (dryRun) console.log('(dry run — no files were modified)')
