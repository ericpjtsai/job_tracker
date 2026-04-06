// VENDORED from packages/scoring/src/companies.ts — keep in sync.

export function normalizeCompanyName(raw: string): string {
  return raw
    .replace(/,?\s*(Inc\.?|Corp\.?|LLC\.?|Ltd\.?|Co\.?|Group|Technologies|Technology|Software|Systems|Labs)$/i, '')
    .trim()
}

export function companyFromDomain(domain: string): string {
  const boardPatterns = [
    /jobs\.lever\.co\/([^/]+)/,
    /boards\.greenhouse\.io\/([^/]+)/,
    /apply\.workable\.com\/([^/]+)/,
    /jobs\.ashbyhq\.com\/([^/]+)/,
    /jobs\.jobvite\.com\/([^/]+)/,
    /careers\.([^.]+)\./,
  ]
  for (const pattern of boardPatterns) {
    const match = domain.match(pattern)
    if (match) return match[1].replace(/-/g, ' ')
  }

  const host = domain.replace(/^www\./, '').split('.')[0]
  return host.charAt(0).toUpperCase() + host.slice(1)
}
