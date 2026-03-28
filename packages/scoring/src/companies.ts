// Company utilities — domain-to-company extraction and name normalization

/**
 * Normalize a company name for lookup.
 */
export function normalizeCompanyName(raw: string): string {
  return raw
    .replace(/,?\s*(Inc\.?|Corp\.?|LLC\.?|Ltd\.?|Co\.?|Group|Technologies|Technology|Software|Systems|Labs)$/i, '')
    .trim()
}

/**
 * Try to extract a company name from a URL domain.
 */
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
