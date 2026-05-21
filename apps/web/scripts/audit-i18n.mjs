#!/usr/bin/env node
/**
 * Audits en-US.json and reports keys with no literal reference in the
 * codebase. With `--remove`, deletes those keys from every locale file.
 *
 *   node apps/web/scripts/audit-i18n.mjs           # report only
 *   node apps/web/scripts/audit-i18n.mjs --remove  # prune all locales
 *
 * Search roots: apps/web/src, packages/shared/src.
 * Search excludes: apps/web/src/i18n/messages, generated messageIds.d.ts.
 *
 * Keys produced by template literals (e.g. `account.theme_${theme}`) cannot
 * be detected by literal search, so prefixes for those families are kept
 * via DYNAMIC_PREFIXES. Update that list when adding new dynamic id sites.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, extname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(HERE, '..')
const REPO_ROOT = resolve(WEB_ROOT, '../..')
const MESSAGES_DIR = resolve(WEB_ROOT, 'src/i18n/messages')

const SEARCH_ROOTS = [
  resolve(WEB_ROOT, 'src'),
  resolve(REPO_ROOT, 'packages/shared/src'),
  resolve(REPO_ROOT, 'apps/api/src'),
]
const SEARCH_EXTS = new Set(['.ts', '.tsx', '.mjs', '.js', '.cjs'])
const EXCLUDE_PATHS = [
  resolve(WEB_ROOT, 'src/i18n/messages'),
  resolve(WEB_ROOT, 'src/i18n/messageIds.d.ts'),
]

// Dynamic id prefixes — keys matching these are always kept because they
// are constructed at runtime from `id: \`<prefix><var>\`` template literals.
// Each entry is a literal prefix; any key whose name starts with it is
// considered used. Audit failures from a missing dynamic site are silent,
// so keep this list in sync with `id: \`...${...}\`` call sites.
const DYNAMIC_PREFIXES = [
  'apiMessages.',
  'account.theme_',          // also covers account.theme_description_
  'manage.edit_logo_status_',
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (EXCLUDE_PATHS.some((p) => full === p || full.startsWith(p + '/'))) continue
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.next') continue
      walk(full, out)
    } else if (SEARCH_EXTS.has(extname(name))) {
      out.push(full)
    }
  }
  return out
}

function loadCorpus() {
  const files = SEARCH_ROOTS.flatMap((root) => walk(root))
  return files.map((f) => readFileSync(f, 'utf8')).join('\n')
}

function isUsed(key, corpus) {
  if (DYNAMIC_PREFIXES.some((p) => key.startsWith(p))) return true
  // Quoted literal: 'key', "key", or `key` (whole-string template).
  // Substring search is sufficient because keys are dotted identifiers
  // that won't collide with other tokens.
  return (
    corpus.includes(`'${key}'`) ||
    corpus.includes(`"${key}"`) ||
    corpus.includes('`' + key + '`')
  )
}

function loadLocaleKeys(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function main() {
  const args = process.argv.slice(2)
  const remove = args.includes('--remove')

  const enFile = join(MESSAGES_DIR, 'en-US.json')
  const en = loadLocaleKeys(enFile)
  const corpus = loadCorpus()

  const unused = Object.keys(en).filter((k) => !isUsed(k, corpus))

  console.log(`Total keys:   ${Object.keys(en).length}`)
  console.log(`Unused keys:  ${unused.length}`)
  console.log(`Kept dynamic prefixes: ${DYNAMIC_PREFIXES.join(', ')}`)
  console.log()
  for (const k of unused) console.log(`  ${k}`)

  if (!remove) {
    console.log()
    console.log('Report only. Re-run with --remove to prune from all locales.')
    return
  }

  if (unused.length === 0) {
    console.log('\nNothing to remove.')
    return
  }

  const unusedSet = new Set(unused)
  const locales = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'))
  console.log(`\nRemoving ${unused.length} keys from ${locales.length} locale files...`)

  for (const name of locales) {
    const file = join(MESSAGES_DIR, name)
    const data = loadLocaleKeys(file)
    let dropped = 0
    for (const k of unusedSet) {
      if (k in data) {
        delete data[k]
        dropped++
      }
    }
    // Preserve original sort order (insertion order from filtered loop).
    // JSON.stringify with 2-space indent matches the existing format and
    // we add a trailing newline like the source files do.
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
    console.log(`  ${name}: dropped ${dropped}`)
  }

  console.log('\nDone. Run `npm run i18n:types --workspace=apps/web` to refresh messageIds.d.ts.')
}

main()
