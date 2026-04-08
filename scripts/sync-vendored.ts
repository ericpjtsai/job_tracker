// Sync vendored files from packages/scoring into supabase/functions/_shared.
// Edge Functions can't import workspace packages, so certain files are
// duplicated into _shared/scoring/. This script keeps them in sync.
//
// Usage: npx tsx scripts/sync-vendored.ts
// Run before committing any change to packages/scoring/src/keywords.ts (or
// any other mirrored file). Idempotent — safe to run multiple times.
//
// Past history: the manual cp+sed approach caused the fcf756b dual-bill bug
// when the listener's processor.ts drifted from the Edge Function vendor.
// Same pattern would break scoring if keywords.ts drifts.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { relative } from 'node:path'

interface VendorTarget {
  source: string
  dest: string
  headerReplacement?: { match: RegExp; replaceWith: string }
}

const TARGETS: VendorTarget[] = [
  {
    source: 'packages/scoring/src/keywords.ts',
    dest: 'supabase/functions/_shared/scoring/keywords.ts',
    headerReplacement: {
      // Replace the first two comment lines with a VENDORED marker
      match: /^\/\/ Keyword taxonomy.*\n\/\/ Each group.*\n/,
      replaceWith:
        '// VENDORED from packages/scoring/src/keywords.ts — keep in sync.\n' +
        '// Edge Functions cannot import workspace packages, so the scoring logic is copied here.\n',
    },
  },
  // Add more mirrored files here as the vendoring surface grows.
]

function sync(target: VendorTarget): { changed: boolean; reason: string } {
  if (!existsSync(target.source)) {
    return { changed: false, reason: `SOURCE MISSING: ${target.source}` }
  }

  let content = readFileSync(target.source, 'utf8')
  if (target.headerReplacement) {
    if (!target.headerReplacement.match.test(content)) {
      return {
        changed: false,
        reason: `source header did not match expected pattern — manual review needed for ${target.source}`,
      }
    }
    content = content.replace(target.headerReplacement.match, target.headerReplacement.replaceWith)
  }

  const existing = existsSync(target.dest) ? readFileSync(target.dest, 'utf8') : ''
  if (existing === content) {
    return { changed: false, reason: 'already in sync' }
  }

  writeFileSync(target.dest, content)
  return { changed: true, reason: 'updated' }
}

function main() {
  let anyChanged = false
  let anyFailed = false
  for (const target of TARGETS) {
    const result = sync(target)
    const rel = relative(process.cwd(), target.dest)
    const status = result.changed ? 'UPDATED' : result.reason.startsWith('SOURCE') ? 'ERROR  ' : 'OK     '
    console.log(`  [${status}] ${rel} — ${result.reason}`)
    if (result.changed) anyChanged = true
    if (result.reason.startsWith('SOURCE') || result.reason.startsWith('source header')) anyFailed = true
  }

  if (anyFailed) {
    console.error('\n✗ Sync failed — see errors above')
    process.exit(1)
  }
  console.log(anyChanged ? '\n✓ Vendored files updated' : '\n✓ Vendored files already in sync')
}

main()
