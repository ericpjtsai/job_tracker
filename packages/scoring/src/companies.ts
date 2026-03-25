// Company tier list — scoring bonus: Tier 1 = +20, Tier 2 = +10, Tier 3 = +5

export const COMPANY_TIERS: Record<string, 1 | 2 | 3> = {
  // ── Tier 1: Pure B2B/Enterprise SaaS (+20) ──────────────────────────────────
  Salesforce: 1,
  Docusign: 1,
  HubSpot: 1,
  OpenAI: 1,
  Plaid: 1,
  Cisco: 1,
  Zoom: 1,
  Slack: 1,
  Atlassian: 1,
  ServiceNow: 1,
  Notion: 1,
  Figma: 1,
  Datadog: 1,
  Snowflake: 1,
  Stripe: 1,
  Twilio: 1,
  MongoDB: 1,
  Airtable: 1,
  Amplitude: 1,
  Asana: 1,
  'Monday.com': 1,
  Palantir: 1,
  Okta: 1,
  PagerDuty: 1,
  Cloudflare: 1,
  Vercel: 1,
  GitLab: 1,
  Confluent: 1,
  HashiCorp: 1,
  Grammarly: 1,
  Workday: 1,
  Oracle: 1,
  SAP: 1,
  Intuit: 1,
  Adobe: 1,
  // New Tier 1 additions
  Zendesk: 1,
  Freshworks: 1,
  Intercom: 1,
  Box: 1,
  FullStory: 1,
  Qualtrics: 1,
  UserTesting: 1,
  Mixpanel: 1,
  Dropbox: 1,
  Coda: 1,
  ClickUp: 1,
  Smartsheet: 1,
  Webflow: 1,
  UserZoom: 1,
  Medallia: 1,
  LogRocket: 1,
  Heap: 1,
  Hotjar: 1,

  // ── Tier 2: B2B with Strong Enterprise DNA (+10) ─────────────────────────────
  Anthropic: 2,
  'Contextual AI': 2,
  ReadAI: 2,
  Klaviyo: 2,
  nCino: 2,
  '8am': 2,
  AffiniPay: 2,
  Fiserv: 2,
  'Outset.ai': 2,
  Brex: 2,
  Ramp: 2,
  Gusto: 2,
  Rippling: 2,
  Lattice: 2,
  Deel: 2,
  Toast: 2,
  Veeva: 2,
  'Veeva Systems': 2,
  Coupa: 2,
  Clio: 2,
  Procore: 2,
  Samsara: 2,
  'dbt Labs': 2,
  Retool: 2,
  Linear: 2,
  Loom: 2,
  Miro: 2,
  Canva: 2,
  Dovetail: 2,
  Pendo: 2,
  LaunchDarkly: 2,
  Postman: 2,
  Supabase: 2,
  'Weights & Biases': 2,
  'Scale AI': 2,
  Cohere: 2,
  Writer: 2,
  // New Tier 2 additions
  Framer: 2,
  Calendly: 2,
  Carta: 2,
  'Bill.com': 2,
  Greenhouse: 2,
  Ashby: 2,
  HiBob: 2,
  Talkdesk: 2,
  Five9: 2,
  Sprinklr: 2,
  'Sprout Social': 2,
  Contentful: 2,
  Optimizely: 2,
  Segment: 2,
  Hex: 2,
  Observable: 2,
  Liveblocks: 2,
  Clerk: 2,
  WorkOS: 2,
  Checkr: 2,
  Marqeta: 2,
  Tipalti: 2,
  'Remote.com': 2,
  Oyster: 2,
  Personio: 2,
  Pave: 2,
  Expensify: 2,
  Airbyte: 2,
  Fivetran: 2,
  'Monte Carlo': 2,
  Statsig: 2,
  Eppo: 2,
  Split: 2,
  Chromatic: 2,
  Storybook: 2,
  Mural: 2,
  Lucid: 2,
  Webex: 2,
  RingCentral: 2,
  Genesys: 2,
  Hootsuite: 2,
  UiPath: 2,
  Automation_Anywhere: 2,
  Celonis: 2,
  Appian: 2,
  Blend: 2,

  // ── Tier 3: B2B-Adjacent / Big Tech (+5) ─────────────────────────────────────
  Microsoft: 3,
  Google: 3,
  'Google Cloud': 3,
  Amazon: 3,
  AWS: 3,
  Meta: 3,
  Apple: 3,
  LinkedIn: 3,
  Shopify: 3,
  Square: 3,
  Block: 3,
  Robinhood: 3,
  Coinbase: 3,
  MX: 3,
  'Morgan Stanley': 3,
  'Goldman Sachs': 3,
  'JPMorgan Chase': 3,
  JPMorgan: 3,
  'Deloitte Digital': 3,
  Deloitte: 3,
  Accenture: 3,
  PwC: 3,
  EY: 3,
  McKinsey: 3,
  BCG: 3,
  Uber: 3,
  Lyft: 3,
  DoorDash: 3,
  Instacart: 3,
  Airbnb: 3,
  Databricks: 3,
  Hebbia: 3,
  Superhuman: 3,
  Cint: 3,
  Garmin: 3,
  Waymo: 3,
  Equinix: 3,
  TikTok: 3,
  // New Tier 3 additions
  GitHub: 3,
  Nvidia: 3,
  Qualcomm: 3,
  Intel: 3,
  Netflix: 3,
  Spotify: 3,
  Snap: 3,
  Snapchat: 3,
  PayPal: 3,
  Venmo: 3,
  Twitter: 3,
  ByteDance: 3,
  Twitch: 3,
  Discord: 3,
  Duolingo: 3,
  Peloton: 3,
  Rivian: 3,
  Cruise: 3,
  Aurora: 3,
  'Capital One': 3,
  'American Express': 3,
  Visa: 3,
  Mastercard: 3,
  BlackRock: 3,
  Fidelity: 3,
  'Charles Schwab': 3,
  Vanguard: 3,
  Bloomberg: 3,
  Thomson_Reuters: 3,
  Workiva: 3,
  Zuora: 3,
  Brainware: 3,
  SAP_Concur: 3,
  Salesforce_Marketing_Cloud: 3,
  HCL: 3,
  Infosys: 3,
  Cognizant: 3,
  Wipro: 3,
  EPAM: 3,
}

const TIER_BONUS: Record<1 | 2 | 3, number> = { 1: 20, 2: 10, 3: 5 }

/**
 * Normalize a company name for lookup.
 */
export function normalizeCompanyName(raw: string): string {
  return raw
    .replace(/,?\s*(Inc\.?|Corp\.?|LLC\.?|Ltd\.?|Co\.?|Group|Technologies|Technology|Software|Systems|Labs)$/i, '')
    .trim()
}

/**
 * Returns the tier bonus for a company name, or 0 if unlisted.
 */
export function getCompanyBonus(companyName: string): { tier: 1 | 2 | 3 | null; bonus: number } {
  const normalized = normalizeCompanyName(companyName)

  // Direct match
  for (const [name, tier] of Object.entries(COMPANY_TIERS)) {
    if (name.toLowerCase() === normalized.toLowerCase()) {
      return { tier, bonus: TIER_BONUS[tier] }
    }
  }

  // Partial match
  for (const [name, tier] of Object.entries(COMPANY_TIERS)) {
    if (
      normalized.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(normalized.toLowerCase())
    ) {
      return { tier, bonus: TIER_BONUS[tier] }
    }
  }

  return { tier: null, bonus: 0 }
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
