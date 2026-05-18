#!/usr/bin/env node
/**
 * scripts/i18n-translate.ts
 *
 * Translates en-US.json to a target locale via the Claude API. Diff-based
 * and idempotent: only keys whose target value is byte-identical to the
 * source value (i.e. untranslated placeholders) are sent to the model.
 * Previously-translated keys are preserved.
 *
 * Usage:
 *   npm run i18n:translate                       # Spanish, full run
 *   npm run i18n:translate -- --dry-run          # show pending keys, don't call API
 *   npm run i18n:translate -- --only common      # translate only one namespace
 *   npm run i18n:translate -- --target pt        # translate to Portuguese
 *   npm run i18n:translate -- --force            # retranslate every key
 *
 * Requires ANTHROPIC_API_KEY in .env.local.
 */

import { config as loadEnv } from 'dotenv'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { getLocaleConfig } from '@kasero/shared/locales'

loadEnv({ path: '.env.local' })

// ============================================================================
// Types
// ============================================================================

interface Args {
  target: string
  dryRun: boolean
  only: string | null
  force: boolean
  batchSize: number
  model: string
}

type FlatMap = Record<string, string>
type NestedValue = string | { [key: string]: NestedValue }
type NestedMap = { [key: string]: NestedValue }

// ============================================================================
// Config
// ============================================================================

// Messages live in the web workspace (apps/web/src/i18n/messages/) since
// the monorepo split; this script still ships from apps/api/scripts/ so
// the locale registry stays a single shared-package consumer. The CWD
// when invoked via `npm run i18n:translate --workspace=apps/api` is
// apps/api/, so hop one level up and into apps/web/.
const MESSAGES_DIR = resolve(process.cwd(), '../web/src/i18n/messages')
const SOURCE_FILE = 'en-US.json'
const MAX_RETRIES = 3

// Language name + tone guidance live in the locale registry at
// src/i18n/locales.ts — that's the only place to edit when adding a
// language. This script reads from there via getLocaleConfig().

// ============================================================================
// CLI parsing
// ============================================================================

function parseArgs(argv: string[]): Args {
  const args: Args = {
    target: 'es',
    dryRun: false,
    only: null,
    force: false,
    batchSize: 50,
    model: 'claude-sonnet-4-5',
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    switch (flag) {
      case '--target':
        args.target = argv[++i]
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--only':
        args.only = argv[++i]
        break
      case '--force':
        args.force = true
        break
      case '--batch-size':
        args.batchSize = parseInt(argv[++i], 10)
        break
      case '--model':
        args.model = argv[++i]
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
      default:
        console.error(`Unknown flag: ${flag}`)
        printHelp()
        process.exit(1)
    }
  }

  return args
}

function printHelp(): void {
  console.log(`
i18n-translate: translate en-US.json into a target locale via the Claude API.

Flags:
  --target <locale>    Target locale file (default: es)
  --dry-run            Show pending keys without calling the API
  --only <namespace>   Translate only one top-level namespace (e.g. "orders")
  --force              Retranslate every key, overwriting existing translations
  --batch-size <n>     Keys per API request (default: 50)
  --model <id>         Model override (default: claude-sonnet-4-5)
  --help, -h           Show this message
`)
}

// ============================================================================
// JSON flatten / unflatten
// ============================================================================

function flatten(obj: NestedMap, prefix = ''): FlatMap {
  const out: FlatMap = {}
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      out[path] = value
    } else if (value && typeof value === 'object') {
      Object.assign(out, flatten(value, path))
    }
  }
  return out
}

function unflatten(flat: FlatMap): NestedMap {
  const out: NestedMap = {}
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.')
    let cursor: NestedMap = out
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]
      if (!(segment in cursor) || typeof cursor[segment] === 'string') {
        cursor[segment] = {}
      }
      cursor = cursor[segment] as NestedMap
    }
    cursor[parts[parts.length - 1]] = value
  }
  return out
}

// ============================================================================
// Placeholder validation
// ============================================================================

/**
 * Extract placeholder identifiers from an ICU message string.
 *
 * A "placeholder identifier" is the variable name inside a `{name}` or
 * `{name, type, ...}` block. The literal text inside plural/select arm
 * bodies is NOT a placeholder — `{count, plural, one {product} other
 * {products}}` has exactly one identifier: `count`. The words inside
 * the arm bodies (`product`, `products`) legitimately get translated,
 * and the old naive regex `/\{(\w+)/g` flagged them as identifier
 * mismatches, blocking every locale where any arm body diverged from
 * the English text.
 *
 * Implementation: walk the string. At each `{`, peek at what follows.
 *   - `{<id>}`           → bare placeholder, record id, skip past `}`.
 *   - `{<id>,`           → complex placeholder, record id, then skip
 *                          forward until the matching close-brace,
 *                          counting nesting depth. Arm bodies are
 *                          consumed silently.
 *   - otherwise          → it's not a placeholder opening; ignore.
 *
 * Trade-off: placeholders nested inside arm bodies (e.g.
 * `{count, plural, one {{name}} other {{name}s}}`) are NOT validated.
 * Catching those would require a real ICU parser; for a dependency-
 * free script we accept that gap.
 */
function getPlaceholderIdentifiers(str: string): Set<string> {
  const identifiers = new Set<string>()
  let i = 0
  while (i < str.length) {
    if (str[i] !== '{') { i++; continue }
    const m = str.slice(i + 1).match(/^(\w+)(\s*[,}])/)
    if (!m) { i++; continue }
    identifiers.add(m[1])
    if (m[2].trim() === '}') {
      i += 1 + m[0].length
      continue
    }
    let depth = 1
    i += 1 + m[1].length
    while (i < str.length && depth > 0) {
      if (str[i] === '{') depth++
      else if (str[i] === '}') depth--
      i++
    }
  }
  return identifiers
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) {
    if (!b.has(item)) return false
  }
  return true
}

function validatePlaceholders(path: string, source: string, translated: string): void {
  const sourceIds = getPlaceholderIdentifiers(source)
  const translatedIds = getPlaceholderIdentifiers(translated)
  if (!setsEqual(sourceIds, translatedIds)) {
    throw new Error(
      `Placeholder mismatch at "${path}":\n` +
      `  source:     ${[...sourceIds].join(', ') || '(none)'}\n` +
      `  translated: ${[...translatedIds].join(', ') || '(none)'}\n` +
      `  source str: ${source}\n` +
      `  target str: ${translated}`
    )
  }
}

// ============================================================================
// Claude API
// ============================================================================

function buildSystemPrompt(targetLocale: string): string {
  const config = getLocaleConfig(targetLocale)
  const languageName = config?.translate?.name ?? targetLocale
  const localeGuidance = config?.translate?.guidance ?? ''

  return `You are translating UI strings for Kasero, a small-business POS and inventory app used primarily in Latin America. Your audience is small business owners: food vendors, artisans, retailers. They use the app on mobile while running their business, so copy must be concise and scannable.

You are translating from English (en-US) into ${languageName}.

Tone:
- Concise, action-oriented, neutral formal.
- Match POS / retail vocabulary the target market actually uses.

${localeGuidance}

Hard rules:
- Preserve ICU placeholder syntax exactly. {name}, {count}, {currency}, {days, plural, one {#} other {#}}, etc. Never translate placeholder identifiers (e.g. {name} must stay {name}, never {nombre}).
- Preserve HTML-like tags if present: <strong>, <br>, <b>, etc.
- Do NOT translate the brand name "Kasero".
- Do NOT translate technical terms that are left in English on purpose: enum values like "pending", "received", "owner", "partner", "employee" when they appear as identifiers inside placeholder values.
- Do NOT add trailing punctuation where the source had none.
- Do NOT expand contractions or add flourishes. Match source length where reasonable.

Output rules:
- Return ONLY valid JSON matching the exact key structure of the input.
- No prose, no markdown fences, no comments.
- No trailing commas.
- Keys in the output must be identical to keys in the input. Never rename, never skip a key.
- The output JSON must have the same number of keys as the input.`
}

function extractJsonFromResponse(raw: string): unknown {
  // Strip markdown fences if Claude wraps the JSON in them
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  return JSON.parse(cleaned)
}

async function translateBatch(
  anthropic: Anthropic,
  batch: FlatMap,
  model: string,
  systemPrompt: string,
): Promise<FlatMap> {
  const userContent = JSON.stringify(batch, null, 2)
  const batchKeys = Object.keys(batch)

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userContent }],
      })

      const firstBlock = response.content[0]
      if (!firstBlock || firstBlock.type !== 'text') {
        throw new Error('Unexpected response: no text block')
      }

      const parsed = extractJsonFromResponse(firstBlock.text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Response is not a JSON object')
      }

      const translated = parsed as FlatMap

      // Validate: same keys
      const missing = batchKeys.filter((k) => !(k in translated))
      if (missing.length > 0) {
        throw new Error(`Response missing keys: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`)
      }

      // Validate: placeholder preservation
      for (const key of batchKeys) {
        const value = translated[key]
        if (typeof value !== 'string') {
          throw new Error(`Key "${key}" has non-string value`)
        }
        validatePlaceholders(key, batch[key], value)
      }

      return translated
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES) {
        const delay = 500 * Math.pow(2, attempt - 1)
        console.warn(`  Attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms...`)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }

  throw new Error(`All ${MAX_RETRIES} attempts failed. Last error: ${lastError?.message}`)
}

// ============================================================================
// File I/O
// ============================================================================

function readJsonFile(filename: string): NestedMap {
  const path = resolve(MESSAGES_DIR, filename)
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function writeJsonFileAtomic(filename: string, data: FlatMap | NestedMap): void {
  const path = resolve(MESSAGES_DIR, filename)
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  renameSync(tmpPath, path)
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY not set. Add it to .env.local.')
    process.exit(1)
  }

  const targetFile = `${args.target}.json`
  console.log(`[i18n-translate] target: ${args.target} (${targetFile})`)
  console.log(`[i18n-translate] model:  ${args.model}`)
  console.log('')

  // Load source and target
  const source = readJsonFile(SOURCE_FILE)
  const target = readJsonFile(targetFile)

  const sourceFlat = flatten(source)
  const targetFlat = flatten(target)

  const sourceCount = Object.keys(sourceFlat).length
  const translatedCount = Object.keys(targetFlat).filter(
    (k) => sourceFlat[k] !== undefined && targetFlat[k] !== sourceFlat[k],
  ).length
  const placeholderCount = sourceCount - translatedCount

  console.log(`[i18n-translate] source: ${sourceCount} keys`)
  console.log(`[i18n-translate] target: ${translatedCount} translated, ${placeholderCount} placeholder`)

  // Compute pending set
  const pending: FlatMap = {}
  for (const [key, sourceValue] of Object.entries(sourceFlat)) {
    if (args.only && !key.startsWith(`${args.only}.`)) continue
    const targetValue = targetFlat[key]
    const isPending = args.force || targetValue === undefined || targetValue === sourceValue
    if (isPending) {
      pending[key] = sourceValue
    }
  }

  const pendingCount = Object.keys(pending).length
  const filterSuffix = args.only ? ` (filtered by --only ${args.only})` : ''
  console.log(`[i18n-translate] pending: ${pendingCount} keys${filterSuffix}`)

  if (pendingCount === 0) {
    console.log('[i18n-translate] Nothing to translate. Done.')
    return
  }

  if (args.dryRun) {
    console.log('')
    console.log('[dry-run] Keys that would be translated:')
    for (const [key, value] of Object.entries(pending)) {
      const preview = value.length > 60 ? value.slice(0, 57) + '...' : value
      console.log(`  ${key}: ${JSON.stringify(preview)}`)
    }
    console.log('')
    console.log('[dry-run] No changes written. Remove --dry-run to execute.')
    return
  }

  // Batch and translate
  const anthropic = new Anthropic({ apiKey })
  const systemPrompt = buildSystemPrompt(args.target)
  const pendingEntries = Object.entries(pending)
  const batchCount = Math.ceil(pendingEntries.length / args.batchSize)

  console.log(`[i18n-translate] batching into ${batchCount} request(s) of up to ${args.batchSize} keys each`)
  console.log('')

  const translated: FlatMap = {}
  const startTime = Date.now()

  for (let i = 0; i < batchCount; i++) {
    const batchStart = i * args.batchSize
    const batchEnd = Math.min(batchStart + args.batchSize, pendingEntries.length)
    const batch: FlatMap = Object.fromEntries(pendingEntries.slice(batchStart, batchEnd))
    const batchStartTime = Date.now()

    process.stdout.write(`[i18n-translate] batch ${i + 1}/${batchCount} (${Object.keys(batch).length} keys)... `)
    const result = await translateBatch(anthropic, batch, args.model, systemPrompt)
    Object.assign(translated, result)
    const elapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1)
    console.log(`OK (${elapsed}s)`)
  }

  // Merge translated into the target. Persist as a flat dot-key map —
  // that's what apps/web/src/i18n/loadMessages.ts feeds to react-intl
  // (a Record<string, string>); writing nested would break message
  // lookups in the app even though the JSON parses fine. unflatten()
  // is still kept for input handling so legacy nested files re-flatten
  // correctly on the next run.
  const mergedFlat: FlatMap = { ...targetFlat, ...translated }
  writeJsonFileAtomic(targetFile, mergedFlat)

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('')
  console.log(`[i18n-translate] wrote ${targetFile}`)
  console.log(`[i18n-translate] ${pendingCount} key(s) translated in ${totalElapsed}s`)
}

main().catch((err) => {
  console.error('')
  console.error('[i18n-translate] FAILED')
  console.error(err instanceof Error ? err.message : String(err))
  if (err instanceof Error && err.stack) {
    console.error(err.stack)
  }
  process.exit(1)
})
