'use client'

import { useState, useEffect } from 'react'

// ─── Data ────────────────────────────────────────────────────────────────────

interface Source {
  id: string
  name: string
  type: 'stream' | 'poll'
  schedule: string
  cost: string
  endpoint: string
  auth: string
  queries: string[]
  filters: string[]
  notes: string
  triggerPath: string | null
  envVars: string[]
}

const SOURCES: Source[] = [
  {
    id: 'firehose',
    name: 'Firehose SSE',
    type: 'stream',
    schedule: 'Real-time',
    cost: 'Firehose subscription',
    endpoint: 'https://api.firehose.com/v1/stream',
    auth: 'Bearer token (per tap)',
    queries: ['78 rules across 7 taps (see Firehose Rules section below)'],
    filters: [
      'NON_US_EXCLUSION — blocks 30+ non-US cities/countries',
      'FP_EXCLUSION — blocks non-design roles (graphic, interior, fashion, instructional, game, industrial designer) + freelance/contractor/part-time',
      'DESIGN_TITLES — 19 title variants (product designer, UX designer, UI/UX, interaction designer, etc.)',
    ],
    notes: '7 concurrent SSE streams across 3 Firehose accounts. Auto-reconnects on error (5s delay). Offsets persisted in listener_state table for resume on restart.',
    triggerPath: null,
    envVars: ['FIREHOSE_MANAGEMENT_KEY', 'FIREHOSE_MANAGEMENT_KEY_2', 'FIREHOSE_MANAGEMENT_KEY_3', 'FIREHOSE_TAP_TOKEN..TOKEN_7'],
  },
  {
    id: 'ats',
    name: 'ATS Direct Polling',
    type: 'poll',
    schedule: 'Every hour + startup',
    cost: 'Free (public APIs)',
    endpoint: 'Greenhouse, Lever, Ashby, SmartRecruiters public APIs',
    auth: 'None (public endpoints)',
    queries: [
      'Greenhouse: boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true',
      'Lever: api.lever.co/v0/postings/{slug}?mode=json',
      'Ashby: api.ashbyhq.com/posting-api/job-board/{slug}',
      'SmartRecruiters: api.smartrecruiters.com/v1/companies/{slug}/postings',
      '236 companies total (205 Greenhouse, 30 Lever, 1 iCIMS)',
    ],
    filters: [
      'Design role title matching (19 included patterns, 6 excluded false-positive patterns)',
      '400ms delay between companies, 15s timeout per request',
    ],
    notes: 'Polls all 236 companies sequentially with 400ms delay. Progress tracked via GET /status endpoint. 404s and timeouts silently skipped.',
    triggerPath: '/poll',
    envVars: [],
  },
  {
    id: 'linkedin-mantiks',
    name: 'Mantiks (LinkedIn)',
    type: 'poll',
    schedule: 'Weekly (every 7 days) + startup',
    cost: '~400 credits/month (500 budget, 2 credits/lead)',
    endpoint: 'https://api.mantiks.io/company/search',
    auth: 'x-api-key header',
    queries: [
      'Keywords: "product designer", "UX designer", "interaction designer"',
      'Excluded: "senior", "lead", "principal", "staff", "manager", "director", "head of", "vp"',
      'Location: United States (resolved via /location/search on startup)',
      'Params: job_age_in_days=7, job_board=linkedin, limit=50',
    ],
    filters: [
      'Title exclusion at query level (senior/lead/principal/staff/manager/director)',
      'Single page only (no pagination) — 50 results max',
      'Skips insert if credits_remaining < 50',
    ],
    notes: 'Weekly poll with job_age_in_days=7 means zero overlap between polls. Location ID cached for process lifetime. LinkedIn URLs canonicalized to /jobs/view/{id} format.',
    triggerPath: '/poll/mantiks',
    envVars: ['MANTIKS_API_KEY'],
  },
  {
    id: 'linkedin-scraper',
    name: 'LinkedIn Scraper (npm)',
    type: 'poll',
    schedule: '2x daily (6am & 6pm)',
    cost: 'Free',
    endpoint: 'linkedin-jobs-api npm package',
    auth: 'None',
    queries: [
      'Keywords: "product designer B2B", "UX designer enterprise", "product designer AI", "interaction designer SaaS"',
      'Locations: San Francisco, Seattle, New York, Remote',
      '= 16 requests per cycle (4 keywords x 4 locations)',
      'Params: dateSincePosted=past Week, jobType=full time, limit=25',
    ],
    filters: [
      'Remote filter enabled for Remote location only',
    ],
    notes: 'Tracks consecutiveFailures. After 3+ failures, logs warning that LinkedIn may have changed frontend. Used by fallback chain to trigger emergency sources.',
    triggerPath: '/poll/linkedin',
    envVars: [],
  },
  {
    id: 'serpapi',
    name: 'SerpApi (Google Jobs)',
    type: 'poll',
    schedule: '2x daily (6am & 6pm)',
    cost: 'Free tier: 100 searches/month (~17 used)',
    endpoint: 'https://serpapi.com/search?engine=google_jobs',
    auth: 'api_key query parameter',
    queries: [
      '"product designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com "B2B" OR "enterprise"',
      '"UX designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com "B2B" OR "SaaS"',
      '"interaction designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com',
      '"design engineer" site:greenhouse.io OR site:ashbyhq.com OR site:lever.co',
    ],
    filters: [
      'Targets ATS platforms specifically (greenhouse/lever/ashby)',
      'Prefers direct ATS link over LinkedIn link',
      'Coverage gap detection: logs [SERPAPI NEW] for jobs not in DB',
    ],
    notes: '4 queries x 10 results = ~40 results per poll. Also acts as first fallback when Mantiks + scraper both down for 8+ hours.',
    triggerPath: '/poll/serpapi',
    envVars: ['SERPAPI_API_KEY'],
  },
  {
    id: 'indeed',
    name: 'HasData (Indeed)',
    type: 'poll',
    schedule: '2x daily (6am & 6pm)',
    cost: '15 credits/poll (5 per request x 3 keywords)',
    endpoint: 'https://api.hasdata.com/scrape/indeed/listing',
    auth: 'x-api-key header',
    queries: [
      'Keywords: "product designer", "UX designer", "interaction designer"',
      'Location: United States',
      'Sort: date',
      'Domain: www.indeed.com',
    ],
    filters: [
      'Title must match design regex: /\\b(designer|design|UX|UI|interaction|visual|product)\\b/i',
      'Blocks sponsored/non-job content (product pages, etc.)',
      'Coverage gap detection: logs [INDEED NEW] for jobs not in DB',
    ],
    notes: 'Shares HASDATA_API_KEY with Glassdoor. Combined cost: 30 credits per trigger (6 requests total).',
    triggerPath: '/poll/indeed',
    envVars: ['HASDATA_API_KEY'],
  },
  {
    id: 'glassdoor',
    name: 'HasData (Glassdoor)',
    type: 'poll',
    schedule: '2x daily (6am & 6pm)',
    cost: '15 credits/poll (5 per request x 3 keywords)',
    endpoint: 'https://api.hasdata.com/scrape/glassdoor/listing',
    auth: 'x-api-key header',
    queries: [
      'Keywords: "product designer", "UX designer", "interaction designer"',
      'Location: United States',
      'Sort: recent',
      'Domain: www.glassdoor.com',
    ],
    filters: [
      'Title must match design regex: /\\b(designer|design|UX|UI|interaction|visual|product)\\b/i',
      'Blocks sponsored/non-job content',
      'Coverage gap detection: logs [GLASSDOOR NEW] for jobs not in DB',
    ],
    notes: 'Shares HASDATA_API_KEY with Indeed. Combined cost: 30 credits per trigger (6 requests total).',
    triggerPath: '/poll/glassdoor',
    envVars: ['HASDATA_API_KEY'],
  },
  {
    id: 'linkedin-direct',
    name: 'LinkedIn Direct (Fallback)',
    type: 'poll',
    schedule: 'Emergency only',
    cost: 'Free',
    endpoint: 'https://www.linkedin.com/jobs/search (HTML scraping)',
    auth: 'None (rotated User-Agent strings)',
    queries: [
      'Keywords: "product designer B2B", "UX designer enterprise", "product designer AI", "interaction designer SaaS"',
      'Locations: San Francisco, Seattle, New York, Remote',
      'Max 10 requests per invocation',
    ],
    filters: [
      'Random 30-120s delay between requests',
      'Respects 429 rate limits (stops immediately)',
      '4 rotated browser User-Agent strings',
      'Descriptions marked as [Incomplete - direct scrape]',
    ],
    notes: 'Last resort. Activated only when Mantiks + LinkedIn scraper both down for 8+ hours AND no SerpApi key available.',
    triggerPath: null,
    envVars: [],
  },
  {
    id: 'github-jobs',
    name: 'GitHub Jobright Repos',
    type: 'poll',
    schedule: '2x daily (7am & 7pm)',
    cost: 'Free',
    endpoint: 'https://raw.githubusercontent.com (public repos)',
    auth: 'None (public repos)',
    queries: [
      'jobright-ai/2026-Design-New-Grad — all design/creative new grad roles (~220 jobs)',
      'jobright-ai/Daily-H1B-Jobs-In-Tech — Arts & Design section only (~300 H1B-sponsored jobs)',
    ],
    filters: [
      'All jobs pass through insertJobPosting processor pipeline',
      'Title/seniority exclusion, location blocking, dedup, scoring applied automatically',
      'Minimal descriptions (title + company + location) — LLM enrichment skipped',
    ],
    notes: 'Parses markdown tables from GitHub README files. Both repos updated daily by Jobright.ai automation. Uses jobright.ai redirect URLs (UTM stripped) for dedup.',
    triggerPath: '/poll/github',
    envVars: [],
  },
]

// ─── ATS Companies ───────────────────────────────────────────────────────────

interface AtsCompany {
  name: string
  ats: 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters'
}

const ATS_COMPANIES: AtsCompany[] = [
  // Greenhouse
  { name: 'Airtable', ats: 'greenhouse' }, { name: 'Amplitude', ats: 'greenhouse' }, { name: 'Anthropic', ats: 'greenhouse' },
  { name: 'Cloudflare', ats: 'greenhouse' }, { name: 'Coinbase', ats: 'greenhouse' }, { name: 'Datadog', ats: 'greenhouse' },
  { name: 'Deel', ats: 'greenhouse' }, { name: 'Figma', ats: 'greenhouse' }, { name: 'GitLab', ats: 'greenhouse' },
  { name: 'Grammarly', ats: 'greenhouse' }, { name: 'Gusto', ats: 'greenhouse' }, { name: 'Lattice', ats: 'greenhouse' },
  { name: 'LaunchDarkly', ats: 'greenhouse' }, { name: 'MongoDB', ats: 'greenhouse' }, { name: 'Okta', ats: 'greenhouse' },
  { name: 'PagerDuty', ats: 'greenhouse' }, { name: 'Postman', ats: 'greenhouse' }, { name: 'Samsara', ats: 'greenhouse' },
  { name: 'Plaid', ats: 'greenhouse' }, { name: 'Discord', ats: 'greenhouse' }, { name: 'Instacart', ats: 'greenhouse' },
  { name: 'Rippling', ats: 'greenhouse' }, { name: 'Stripe', ats: 'greenhouse' }, { name: 'HubSpot', ats: 'greenhouse' },
  { name: 'Asana', ats: 'greenhouse' }, { name: 'Intercom', ats: 'greenhouse' }, { name: 'Twilio', ats: 'greenhouse' },
  { name: 'Zendesk', ats: 'greenhouse' }, { name: 'Segment', ats: 'greenhouse' }, { name: 'Checkr', ats: 'greenhouse' },
  { name: 'Pendo', ats: 'greenhouse' }, { name: 'Procore', ats: 'greenhouse' }, { name: 'Canva', ats: 'greenhouse' },
  { name: 'Loom', ats: 'greenhouse' }, { name: 'Dovetail', ats: 'greenhouse' }, { name: 'Gong', ats: 'greenhouse' },
  { name: 'Outreach', ats: 'greenhouse' }, { name: 'Salesloft', ats: 'greenhouse' }, { name: 'Highspot', ats: 'greenhouse' },
  { name: 'Apollo', ats: 'greenhouse' }, { name: 'Braze', ats: 'greenhouse' }, { name: 'Front', ats: 'greenhouse' },
  { name: 'Gladly', ats: 'greenhouse' }, { name: 'Medallia', ats: 'greenhouse' }, { name: 'Mixpanel', ats: 'greenhouse' },
  { name: 'FullStory', ats: 'greenhouse' }, { name: 'Heap', ats: 'greenhouse' }, { name: 'Fivetran', ats: 'greenhouse' },
  { name: 'dbt Labs', ats: 'greenhouse' }, { name: 'Confluent', ats: 'greenhouse' }, { name: 'Productboard', ats: 'greenhouse' },
  { name: 'UserTesting', ats: 'greenhouse' }, { name: 'Culture Amp', ats: 'greenhouse' }, { name: 'Leapsome', ats: 'greenhouse' },
  { name: 'Mercury', ats: 'greenhouse' }, { name: 'Modern Treasury', ats: 'greenhouse' }, { name: 'Marqeta', ats: 'greenhouse' },
  { name: 'Netlify', ats: 'greenhouse' }, { name: 'Sentry', ats: 'greenhouse' }, { name: 'Cockroach Labs', ats: 'greenhouse' },
  { name: 'Ironclad', ats: 'greenhouse' }, { name: 'ClickUp', ats: 'greenhouse' }, { name: 'Superhuman', ats: 'greenhouse' },
  { name: 'Sprout Social', ats: 'greenhouse' }, { name: 'Snyk', ats: 'greenhouse' }, { name: 'Wiz', ats: 'greenhouse' },
  { name: 'Lacework', ats: 'greenhouse' }, { name: 'Abnormal Security', ats: 'greenhouse' }, { name: 'Orca Security', ats: 'greenhouse' },
  { name: '1Password', ats: 'greenhouse' }, { name: 'Vanta', ats: 'greenhouse' }, { name: 'Drata', ats: 'greenhouse' },
  { name: 'Harness', ats: 'greenhouse' }, { name: 'Grafana Labs', ats: 'greenhouse' }, { name: 'Temporal', ats: 'greenhouse' },
  { name: 'Pulumi', ats: 'greenhouse' }, { name: 'Buildkite', ats: 'greenhouse' }, { name: 'Databricks', ats: 'greenhouse' },
  { name: 'Airbyte', ats: 'greenhouse' }, { name: 'Sigma Computing', ats: 'greenhouse' }, { name: 'ThoughtSpot', ats: 'greenhouse' },
  { name: 'Collibra', ats: 'greenhouse' }, { name: 'Monte Carlo', ats: 'greenhouse' }, { name: 'Alation', ats: 'greenhouse' },
  { name: 'Contentsquare', ats: 'greenhouse' }, { name: 'Quantum Metric', ats: 'greenhouse' }, { name: 'Klaviyo', ats: 'greenhouse' },
  { name: 'Iterable', ats: 'greenhouse' }, { name: 'Attentive', ats: 'greenhouse' }, { name: 'Customer.io', ats: 'greenhouse' },
  { name: 'Optimizely', ats: 'greenhouse' }, { name: 'Sprinklr', ats: 'greenhouse' }, { name: 'Sprig', ats: 'greenhouse' },
  { name: 'Appcues', ats: 'greenhouse' }, { name: 'WalkMe', ats: 'greenhouse' }, { name: 'OpenAI', ats: 'greenhouse' },
  { name: 'Cohere', ats: 'greenhouse' }, { name: 'Perplexity', ats: 'greenhouse' }, { name: 'Glean', ats: 'greenhouse' },
  { name: 'Moveworks', ats: 'greenhouse' }, { name: 'Runway', ats: 'greenhouse' }, { name: 'Navan', ats: 'greenhouse' },
  { name: 'Airbase', ats: 'greenhouse' }, { name: 'Tipalti', ats: 'greenhouse' }, { name: 'BILL', ats: 'greenhouse' },
  { name: 'Recharge', ats: 'greenhouse' }, { name: 'Eightfold AI', ats: 'greenhouse' }, { name: 'Phenom', ats: 'greenhouse' },
  { name: '15Five', ats: 'greenhouse' }, { name: 'Betterworks', ats: 'greenhouse' }, { name: 'Workato', ats: 'greenhouse' },
  { name: 'Toast', ats: 'greenhouse' }, { name: 'ServiceTitan', ats: 'greenhouse' }, { name: 'Faire', ats: 'greenhouse' },
  { name: 'Flexport', ats: 'greenhouse' }, { name: 'nCino', ats: 'greenhouse' }, { name: 'Blend', ats: 'greenhouse' },
  { name: 'Clio', ats: 'greenhouse' }, { name: 'Veeva Systems', ats: 'greenhouse' }, { name: 'Zuora', ats: 'greenhouse' },
  { name: 'Box', ats: 'greenhouse' }, { name: 'Qualtrics', ats: 'greenhouse' }, { name: 'Evisort', ats: 'greenhouse' },
  { name: 'Metabase', ats: 'greenhouse' }, { name: 'Contentstack', ats: 'greenhouse' }, { name: 'Lyra Health', ats: 'greenhouse' },
  { name: 'Spring Health', ats: 'greenhouse' }, { name: 'Cedar', ats: 'greenhouse' }, { name: 'Accolade', ats: 'greenhouse' },
  { name: 'Palantir', ats: 'greenhouse' }, { name: 'UiPath', ats: 'greenhouse' }, { name: 'Monday.com', ats: 'greenhouse' },
  { name: 'C3.ai', ats: 'greenhouse' }, { name: 'ServiceNow', ats: 'greenhouse' }, { name: 'Zoom', ats: 'greenhouse' },
  { name: 'CrowdStrike', ats: 'greenhouse' }, { name: 'Palo Alto Networks', ats: 'greenhouse' }, { name: 'Snowflake', ats: 'greenhouse' },
  { name: 'Freshworks', ats: 'greenhouse' }, { name: 'Elastic', ats: 'greenhouse' }, { name: 'Reddit', ats: 'greenhouse' },
  { name: 'Intuit', ats: 'greenhouse' }, { name: 'Shopify', ats: 'greenhouse' }, { name: 'Doximity', ats: 'greenhouse' },
  { name: 'GoDaddy', ats: 'greenhouse' }, { name: 'Fortinet', ats: 'greenhouse' }, { name: 'Applovin', ats: 'greenhouse' },
  { name: 'Duolingo', ats: 'greenhouse' }, { name: 'Intapp', ats: 'greenhouse' }, { name: 'Teladoc Health', ats: 'greenhouse' },
  { name: 'Hims & Hers', ats: 'greenhouse' }, { name: 'Weave Communications', ats: 'greenhouse' },
  { name: 'Definitive Healthcare', ats: 'greenhouse' }, { name: 'Guardant Health', ats: 'greenhouse' },
  { name: 'Exact Sciences', ats: 'greenhouse' }, { name: 'Recursion Pharmaceuticals', ats: 'greenhouse' },
  { name: 'Schrodinger', ats: 'greenhouse' }, { name: 'Absci', ats: 'greenhouse' }, { name: 'AbCellera', ats: 'greenhouse' },
  { name: '10x Genomics', ats: 'greenhouse' }, { name: 'Illumina', ats: 'greenhouse' }, { name: 'Butterfly Network', ats: 'greenhouse' },
  { name: 'Nano-X Imaging', ats: 'greenhouse' }, { name: 'Ginkgo Bioworks', ats: 'greenhouse' },
  { name: 'GE HealthCare', ats: 'greenhouse' }, { name: 'Molina Healthcare', ats: 'greenhouse' },
  { name: 'ARM Holdings', ats: 'greenhouse' }, { name: 'NVIDIA', ats: 'greenhouse' }, { name: 'AMD', ats: 'greenhouse' },
  { name: 'Intel', ats: 'greenhouse' }, { name: 'Broadcom', ats: 'greenhouse' }, { name: 'Micron', ats: 'greenhouse' },
  { name: 'Arista Networks', ats: 'greenhouse' }, { name: 'Marvell', ats: 'greenhouse' }, { name: 'Vertiv', ats: 'greenhouse' },
  { name: 'Super Micro', ats: 'greenhouse' }, { name: 'Amkor Technology', ats: 'greenhouse' }, { name: 'ASML', ats: 'greenhouse' },
  { name: 'KLA', ats: 'greenhouse' }, { name: 'Lam Research', ats: 'greenhouse' }, { name: 'Applied Materials', ats: 'greenhouse' },
  { name: 'Teradyne', ats: 'greenhouse' }, { name: 'Fortive', ats: 'greenhouse' }, { name: 'Eaton', ats: 'greenhouse' },
  { name: 'nVent Electric', ats: 'greenhouse' }, { name: 'Carrier Global', ats: 'greenhouse' },
  { name: 'Trane Technologies', ats: 'greenhouse' }, { name: 'Emerson Electric', ats: 'greenhouse' }, { name: 'GE', ats: 'greenhouse' },
  // Lever
  { name: 'Brex', ats: 'lever' }, { name: 'Linear', ats: 'lever' }, { name: 'Retool', ats: 'lever' },
  { name: 'Ramp', ats: 'lever' }, { name: 'Writer', ats: 'lever' }, { name: 'Miro', ats: 'lever' },
  { name: 'Calendly', ats: 'lever' }, { name: 'Hex', ats: 'lever' }, { name: 'Scale AI', ats: 'lever' },
  { name: 'Webflow', ats: 'lever' }, { name: 'Coda', ats: 'lever' }, { name: 'Descript', ats: 'lever' },
  { name: 'Weights & Biases', ats: 'lever' }, { name: 'Framer', ats: 'lever' }, { name: 'Loom', ats: 'lever' },
  { name: 'Gem', ats: 'lever' }, { name: 'Lob', ats: 'lever' }, { name: 'TravelPerk', ats: 'lever' },
  { name: 'Pitch', ats: 'lever' }, { name: 'Maze', ats: 'lever' }, { name: 'Whimsical', ats: 'lever' },
  { name: 'Tome', ats: 'lever' }, { name: 'Pocus', ats: 'lever' }, { name: 'Qualified', ats: 'lever' },
  { name: 'Gorgias', ats: 'lever' }, { name: 'Superside', ats: 'lever' }, { name: 'Clay', ats: 'lever' },
  { name: 'Chili Piper', ats: 'lever' }, { name: 'Loop Returns', ats: 'lever' }, { name: 'Gamma', ats: 'lever' },
  { name: 'Stytch', ats: 'lever' }, { name: 'Chameleon', ats: 'lever' }, { name: 'ChartMogul', ats: 'lever' },
  // Ashby
  { name: 'Notion', ats: 'ashby' }, { name: 'Vercel', ats: 'ashby' }, { name: 'Linear', ats: 'ashby' },
  { name: 'Liveblocks', ats: 'ashby' }, { name: 'Clerk', ats: 'ashby' }, { name: 'PostHog', ats: 'ashby' },
  { name: 'Resend', ats: 'ashby' }, { name: 'Raycast', ats: 'ashby' }, { name: 'Supabase', ats: 'ashby' },
  { name: 'Loops', ats: 'ashby' }, { name: 'Plain', ats: 'ashby' }, { name: 'WorkOS', ats: 'ashby' },
  { name: 'Sanity', ats: 'ashby' }, { name: 'Storyblok', ats: 'ashby' }, { name: 'Neon', ats: 'ashby' },
  { name: 'Knock', ats: 'ashby' }, { name: 'Trigger.dev', ats: 'ashby' },
  // SmartRecruiters
  { name: 'Contentful', ats: 'smartrecruiters' }, { name: 'Mural', ats: 'smartrecruiters' },
  { name: 'Hootsuite', ats: 'smartrecruiters' }, { name: 'PandaDoc', ats: 'smartrecruiters' },
  { name: 'Bloomreach', ats: 'smartrecruiters' }, { name: 'Liferay', ats: 'smartrecruiters' },
]

const ATS_PLATFORMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'] as const
const ATS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  greenhouse: { bg: 'bg-green-100', text: 'text-green-800', label: 'Greenhouse' },
  lever: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Lever' },
  ashby: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Ashby' },
  smartrecruiters: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'SmartRecruiters' },
}

// ─── Firehose Rules ──────────────────────────────────────────────────────────

interface Rule {
  tag: string
  target: string
  type: 'keyword' | 'domain'
}

interface Tap {
  name: string
  account: number
  token: string
  rules: Rule[]
}

const TAPS: Tap[] = [
  {
    name: 'Job Tracker',
    account: 1,
    token: 'FIREHOSE_TAP_TOKEN',
    rules: [
      { tag: 'b2b-core', target: 'Design titles, NOT senior/staff/principal/director/VP/manager/8+yr/10+yr', type: 'keyword' },
      { tag: 'b2b-enterprise', target: 'Product/UX designer + B2B/enterprise/SaaS + design system/dashboard/workflow/devtools', type: 'keyword' },
      { tag: 'b2b-ai', target: 'Product/UX/AI designer + generative AI/LLM/conversational UI/AI-powered/agentic', type: 'keyword' },
      { tag: 'b2b-newgrad', target: 'Product/UX/associate designer + new grad/early career/2026/junior + B2B/AI', type: 'keyword' },
      { tag: 'b2b-target-co', target: '100+ named target companies (Salesforce, OpenAI, Stripe, Figma, etc.)', type: 'keyword' },
      { tag: 'b2b-tier3', target: 'Big Tech / finance / consulting (Microsoft, Google, Goldman, etc.)', type: 'keyword' },
      { tag: 'b2b-design-systems', target: 'Design technologist/engineer/systems + design system/component library/tokens', type: 'keyword' },
      { tag: 'b2b-fintech', target: 'Design titles + fintech/payments/banking/lending + B2B/enterprise', type: 'keyword' },
      { tag: 'b2b-startup', target: 'Design titles + Series A/B/C/YC/a16z/Sequoia + B2B/enterprise', type: 'keyword' },
      { tag: 'linkedin-design', target: 'linkedin.com/jobs/view/* + design titles', type: 'domain' },
      { tag: 'linkedin-posts', target: 'linkedin.com (NOT /jobs/) + design titles + hiring language', type: 'domain' },
      { tag: 'ats-design', target: 'greenhouse.io, lever.co, ashbyhq.com, workable.com, wellfound.com', type: 'domain' },
    ],
  },
  {
    name: 'Job Tracker Platforms',
    account: 1,
    token: 'FIREHOSE_TAP_TOKEN_2',
    rules: [
      { tag: 'glassdoor', target: 'glassdoor.com/job-listing/*', type: 'domain' },
      { tag: 'indeed', target: 'indeed.com/viewjob*', type: 'domain' },
      { tag: 'dice', target: 'dice.com/jobs/*', type: 'domain' },
      { tag: 'builtin', target: 'builtin.com + 8 city subdomains (NYC, LA, SF, Seattle, Austin, Boston, Chicago, Colorado)', type: 'domain' },
      { tag: 'remote-boards', target: 'weworkremotely.com, remotive.com, remote.co, flexjobs.com, nodesk.co', type: 'domain' },
      { tag: 'design-boards', target: 'dribbble.com, coroflot.com, aiga.org, workingnotworking.com, authenticjobs.com, krop.com', type: 'domain' },
    ],
  },
  {
    name: 'Job Tracker Signals',
    account: 1,
    token: 'FIREHOSE_TAP_TOKEN_3',
    rules: [
      { tag: 'hacker-news', target: 'news.ycombinator.com + design titles + hiring signals', type: 'domain' },
      { tag: 'twitter-x', target: 'twitter.com, x.com + design titles + hiring language', type: 'domain' },
      { tag: 'wellfound', target: 'wellfound.com + design titles', type: 'domain' },
      { tag: 'vc-jobs', target: 'workatastartup.com, ycombinator.com, jobs.a16z.com, jobs.sequoiacap.com, greylock.com', type: 'domain' },
      { tag: 'producthunt', target: 'producthunt.com + design titles + hiring signals', type: 'domain' },
      { tag: 'reddit-jobs', target: 'reddit.com (r/forhire, r/UXDesign, r/design, r/userexperience) + hiring signals', type: 'domain' },
      { tag: 'company-careers', target: 'Any domain /careers/* + design titles + job posting signals', type: 'keyword' },
    ],
  },
  {
    name: 'Job Tracker Extended',
    account: 2,
    token: 'FIREHOSE_TAP_TOKEN_4',
    rules: [
      { tag: 'ziprecruiter', target: 'ziprecruiter.com/jobs/*', type: 'domain' },
      { tag: 'simplyhired', target: 'simplyhired.com', type: 'domain' },
      { tag: 'jobvite', target: 'jobs.jobvite.com', type: 'domain' },
      { tag: 'smartrecruiters', target: 'jobs.smartrecruiters.com', type: 'domain' },
      { tag: 'workday-jobs', target: 'myworkdayjobs.com', type: 'domain' },
      { tag: 'icims', target: 'icims.com', type: 'domain' },
      { tag: 'taleo', target: 'taleo.net', type: 'domain' },
      { tag: 'bamboohr-jobs', target: 'bamboohr.com/jobs/*', type: 'domain' },
      { tag: 'techjobs', target: 'techjobs.com, cybercoders.com, hired.com', type: 'domain' },
      { tag: 'tier1-careers-direct', target: 'careers.salesforce.com, openai.com, stripe.com, atlassian, servicenow, adobe, zoom, cisco, datadog, snowflake, lever, twilio, intuit, sap, oracle', type: 'domain' },
      { tag: 'tier2-careers-direct', target: 'canva, miro, ashby, writer, cohere, gusto, rippling, lattice, toast, procore, samsara, doordash, robinhood, coinbase, airbnb, databricks', type: 'domain' },
      { tag: 'handshake', target: 'joinhandshake.com (new grad / entry-level focus)', type: 'domain' },
    ],
  },
  {
    name: 'Job Tracker Niche',
    account: 2,
    token: 'FIREHOSE_TAP_TOKEN_5',
    rules: [
      { tag: 'substack-jobs', target: 'substack.com + hiring signals', type: 'domain' },
      { tag: 'tech-news-hiring', target: 'techcrunch, venturebeat, theverge, wired, forbes + hiring signals', type: 'domain' },
      { tag: 'design-communities', target: 'uxdesign.cc, nngroup.com, smashingmagazine.com, medium.com + hiring signals', type: 'domain' },
      { tag: 'angel-co', target: 'angel.co', type: 'domain' },
      { tag: 'arc-dev', target: 'arc.dev', type: 'domain' },
      { tag: 'jobs-lever-all', target: 'jobs.lever.co', type: 'domain' },
      { tag: 'ashby-all', target: 'jobs.ashbyhq.com', type: 'domain' },
      { tag: 'rippling-ats', target: 'ats.rippling.com', type: 'domain' },
      { tag: 'workable-all', target: 'apply.workable.com', type: 'domain' },
      { tag: 'toptal-jobs', target: 'toptal.com', type: 'domain' },
      { tag: 'otta-jungle', target: 'welcometothejungle.com, otta.com', type: 'domain' },
      { tag: 'simplify-cord', target: 'simplify.jobs, cord.com', type: 'domain' },
      { tag: 'behance-ux', target: 'behance.net, uxjobsboard.com, uxdesignjobs.net, designerjobs.co', type: 'domain' },
    ],
  },
  {
    name: 'Job Tracker BigTech',
    account: 3,
    token: 'FIREHOSE_TAP_TOKEN_6',
    rules: [
      { tag: 'amazon-direct', target: 'amazon.jobs', type: 'domain' },
      { tag: 'google-direct', target: 'careers.google.com, careers.googleplex.com', type: 'domain' },
      { tag: 'meta-direct', target: 'metacareers.com', type: 'domain' },
      { tag: 'apple-direct', target: 'jobs.apple.com', type: 'domain' },
      { tag: 'microsoft-direct', target: 'careers.microsoft.com', type: 'domain' },
      { tag: 'linkedin-direct', target: 'careers.linkedin.com', type: 'domain' },
      { tag: 'chip-hardware', target: 'nvidia.com, amd.com, qualcomm.com, broadcom.com (career pages)', type: 'domain' },
      { tag: 'media-social-direct', target: 'netflix, spotify, snap, discord, duolingo (career pages)', type: 'domain' },
      { tag: 'bigbank-direct', target: 'Capital One, JPMorgan, Goldman Sachs, Morgan Stanley, American Express', type: 'domain' },
      { tag: 'b2b-custom-careers', target: 'hubspot.com, airtable.com, asana.com, monday.com, amplitude.com', type: 'domain' },
      { tag: 'mobility-direct', target: 'tesla.com, waymo.com, uber.com, rivian.com, cruise.com', type: 'domain' },
      { tag: 'consulting-design', target: 'deloitte.com, thoughtworks.com, accenture.com, ideo.com, frog.co', type: 'domain' },
    ],
  },
  {
    name: 'Job Tracker Niche2',
    account: 3,
    token: 'FIREHOSE_TAP_TOKEN_7',
    rules: [
      { tag: 'ai-labs-direct', target: 'scale.com, cohere.com, mistral.ai, perplexity.ai, huggingface.co', type: 'domain' },
      { tag: 'devtools-direct', target: 'github.com, vercel.com, hashicorp.com, getdbt.com, retool.com', type: 'domain' },
      { tag: 'data-platform-direct', target: 'databricks.com, snowflake.com, fivetran.com, airbyte.com, dbt.com', type: 'domain' },
      { tag: 'collab-creative-direct', target: 'miro.com, canva.com, figma.com, coda.io, loom.com', type: 'domain' },
      { tag: 'hris-payroll-direct', target: 'gusto.com, rippling.com, deel.com, lattice.com, greenhouse.io', type: 'domain' },
      { tag: 'ecom-direct', target: 'shopify.com, ebay.com, wayfair.com, etsy.com, instacart.com', type: 'domain' },
      { tag: 'healthtech-direct', target: 'epic.com, athenahealth.com, veeva.com, teladoc.com, doximity.com', type: 'domain' },
      { tag: 'cloud-security-direct', target: 'paloaltonetworks, crowdstrike, zscaler, cloudflare, sentinelone', type: 'domain' },
      { tag: 'fintech-startup-direct', target: 'plaid.com, robinhood.com, coinbase.com, chime.com, affirm.com', type: 'domain' },
      { tag: 'gaming-entertain-direct', target: 'roblox.com, unity.com, ea.com, epicgames.com, activision.com', type: 'domain' },
      { tag: 'enterprise-legacy-direct', target: 'servicenow, zendesk, freshworks, sap, salesforce', type: 'domain' },
      { tag: 'proptech-retail-direct', target: 'opendoor, realpage, appfolio, walmart, target', type: 'domain' },
      { tag: 'research-platform-direct', target: 'dovetail, userinterviews, usertesting, qualtrics, fullstory', type: 'domain' },
    ],
  },
]

// ─── Scoring Data ────────────────────────────────────────────────────────────

const KEYWORD_GROUPS = [
  {
    name: 'B2B / Domain',
    weight: 5,
    terms: ['B2B', 'enterprise', 'developer tools', 'SaaS', 'agreement management', 'contract management', 'CRM', 'customer platform', 'go-to-market', 'GTM', 'contact center', 'fintech', 'financial services', 'fraud', 'risk', 'dashboard', 'admin tools', 'data visualization', 'reporting', 'collaboration tools', 'productivity tools', 'API', 'platform ecosystem', 'workflow automation', 'HR technology', 'talent platform', 'internal tools', 'complex systems', 'multi-product platform', 'CMS'],
  },
  {
    name: 'AI & Emerging',
    weight: 4,
    terms: ['AI-powered', 'AI-first', 'agentic AI', 'AI agents', 'conversational UI', 'voice', 'LLM', 'generative AI', 'AI-assisted design', 'probabilistic systems', 'AI concierge', 'digital twin', 'RAG', 'retrieval-augmented generation', 'trust', 'transparency', 'human-in-the-loop', 'AI design patterns', 'reusable AI UX', 'rapid prototyping with AI', 'MCP'],
  },
  {
    name: 'Core Design',
    weight: 3,
    terms: ['product designer', 'UX designer', 'UX design', 'interaction design', 'visual design', 'end-to-end design', 'user flows', 'wireframes', 'prototyping', 'design systems', 'systems thinking', 'information architecture', 'pixel-perfect', 'responsive', 'cross-platform', 'accessibility', 'WCAG', 'a11y', 'content design', 'UX writing', 'motion design', 'component-based', 'design tokens'],
  },
  {
    name: 'Methods',
    weight: 2,
    terms: ['user research', 'usability testing', 'user-centered design', 'design thinking', 'journey mapping', 'A/B testing', 'experimentation', 'Agile', 'Scrum', 'personas', 'storyboards', 'design critique', 'metrics-driven', 'funnel analysis', 'conversion optimization', 'conversion', 'scalable design patterns', 'cross-cloud', 'multi-surface design', '0-to-1', 'zero to one'],
  },
  {
    name: 'Soft Skills',
    weight: 2,
    terms: ['cross-functional collaboration', 'cross-functional', 'storytelling', 'design rationale', 'navigate ambiguity', 'ambiguity', 'stakeholder communication', 'stakeholder alignment', 'data-informed', 'strategic product thinking', 'strategic', 'growth mindset', 'continuous learning', 'mentorship', 'design culture', 'balance user needs', 'business goals'],
  },
  {
    name: 'Tools',
    weight: 1,
    terms: ['Figma', 'Adobe Creative Cloud', 'Framer', 'Sketch', 'HTML', 'CSS', 'JavaScript', 'Miro', 'Qualtrics', 'Maze', 'Google Analytics', 'web analytics', 'CMS', 'Phenom', 'Workday', 'ServiceNow', 'Airtable', 'Jira', 'Webflow', 'Cursor', 'Claude Code'],
  },
]

interface ProcessorStats {
  received: number
  titleBlocked: number
  locationBlocked: number
  companyBlocked: number
  articleBlocked: number
  deduplicated: number
  seniorityExcluded: number
  resumeFitZero: number
  inserted: number
  nonJobBoard: number
}

const FILTER_PIPELINE: { name: string; scope: string; description: string; statsKey: keyof ProcessorStats | null }[] = [
  { name: 'Job Board URL allowlist', scope: 'Firehose only', description: 'Must match known job board hosts (17 domains), job subdomains (jobs.*, careers.*), or job paths (/jobs/, /careers/). Configurable in Settings.', statsKey: 'nonJobBoard' },
  { name: 'Non-design title blocking', scope: 'All sources', description: 'Hard-blocks non-design roles (27+ keywords: engineer, intern, graphic designer, etc.). Strips "Apply now" prefix. Configurable in Settings.', statsKey: 'titleBlocked' },
  { name: 'Location blocking', scope: 'All sources', description: 'Blocks explicit non-US locations (92 cities/countries). Allows: empty, Remote, Hybrid, United States, US state abbreviations. Configurable in Settings.', statsKey: 'locationBlocked' },
  { name: 'Company blocking', scope: 'All sources', description: 'Blocks specific companies (configurable in Settings). Currently: lensa, itjobswatch.', statsKey: 'companyBlocked' },
  { name: 'Article detection', scope: 'All sources', description: 'Blocks content marketing titles: "How to...", "What is...", "Best practices...", "Guide to...", year prefixes, "deep dive", "case study".', statsKey: 'articleBlocked' },
  { name: 'Dedup (URL + title+company+location)', scope: 'All sources', description: 'SHA-256 URL hash + case-insensitive title+company+location matching. Uses .limit(1) for multi-match safety. Merges longer JDs and triggers LLM re-scoring.', statsKey: 'deduplicated' },
  { name: 'Seniority exclusion', scope: 'All sources', description: 'Soft-blocks staff, principal, director, VP, head of, manager (priority=skip). Also blocks lead with 7+yr, 8+ years. Senior designers pass through. Configurable in Settings.', statsKey: 'seniorityExcluded' },
  { name: 'Resume fit filter', scope: 'All sources', description: 'If active resume exists AND 0 keywords matched OR 0% resume fit, the job is skipped. LLM enrichment runs async post-insert for accurate scoring.', statsKey: 'resumeFitZero' },
]

// ─── Components ──────────────────────────────────────────────────────────────

function Section({ title, badge, defaultOpen = false, children }: {
  title: string
  badge?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-card rounded-lg overflow-hidden border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full px-4 py-3 flex items-center justify-between text-left transition-colors ${open ? 'bg-muted/50' : 'hover:bg-muted/50'}`}
      >
        <span className="text-sm font-medium leading-6 flex items-center gap-2">
          {title}
          {badge && <span className="text-xs font-normal text-muted-foreground">{badge}</span>}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && <div className="px-4 py-3 bg-muted/30">{children}</div>}
    </div>
  )
}

function TypeBadge({ type }: { type: 'stream' | 'poll' }) {
  return type === 'stream' ? (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 uppercase">Stream</span>
  ) : (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase">Poll</span>
  )
}

function RuleTypeBadge({ type }: { type: 'keyword' | 'domain' }) {
  return type === 'keyword' ? (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">keyword</span>
  ) : (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">domain</span>
  )
}

function SourceCard({ source }: { source: Source }) {
  const [open, setOpen] = useState(false)
  const isAts = source.id === 'ats'
  return (
    <div className={`bg-card rounded-lg overflow-hidden border ${isAts ? 'md:col-span-2' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium leading-6">{source.name}</span>
              <TypeBadge type={source.type} />
              {isAts && <span className="text-[10px] text-muted-foreground/50">{ATS_COMPANIES.length} companies</span>}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {source.schedule} · {source.cost}
            </div>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </div>
      </button>

      {open && (
        <div className="px-4 py-3 bg-muted/30 space-y-3 text-xs">
          {/* Endpoint */}
          <div className="pt-3">
            <div className="font-label text-muted-foreground uppercase text-[10px] font-medium mb-1">Endpoint</div>
            <div className="text-foreground font-mono text-[11px] break-all">{source.endpoint}</div>
            <div className="text-muted-foreground mt-0.5">Auth: {source.auth}</div>
          </div>

          {/* Queries / Keywords */}
          <div>
            <div className="font-label text-muted-foreground uppercase text-[10px] font-medium mb-1">Search Queries / Keywords</div>
            <ul className="space-y-0.5">
              {source.queries.map((q, i) => (
                <li key={i} className="text-foreground font-mono text-[11px]">{q}</li>
              ))}
            </ul>
          </div>

          {/* Filters */}
          <div>
            <div className="font-label text-muted-foreground uppercase text-[10px] font-medium mb-1">Source-level Filters</div>
            <ul className="space-y-0.5">
              {source.filters.map((f, i) => (
                <li key={i} className="text-muted-foreground">{f}</li>
              ))}
            </ul>
          </div>

          {/* Env vars */}
          {source.envVars.length > 0 && (
            <div>
              <div className="font-label text-muted-foreground uppercase text-[10px] font-medium mb-1">Environment Variables</div>
              <div className="flex flex-wrap gap-1">
                {source.envVars.map((v) => (
                  <span key={v} className="font-mono text-[11px] bg-muted text-foreground px-1.5 py-0.5 rounded">{v}</span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <div className="font-label text-muted-foreground uppercase text-[10px] font-medium mb-1">Notes</div>
            <p className="text-muted-foreground">{source.notes}</p>
          </div>

          {/* ATS Companies List */}
          {isAts && <AtsCompaniesSection />}
        </div>
      )}
    </div>
  )
}

function AtsCompaniesSection() {
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const filtered = ATS_COMPANIES.filter((c) => {
    if (filter !== 'all' && c.ats !== filter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const counts = ATS_PLATFORMS.reduce((acc, p) => {
    acc[p] = ATS_COMPANIES.filter((c) => c.ats === p).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div>
      <div className="font-label text-muted-foreground uppercase text-[10px] font-medium mb-2">
        Companies ({ATS_COMPANIES.length} total)
      </div>

      {/* Platform filter tabs + search */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`text-[10px] px-2 py-1 rounded-md transition-colors ${filter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground bg-muted hover:bg-muted/80'}`}
        >
          All ({ATS_COMPANIES.length})
        </button>
        {ATS_PLATFORMS.map((p) => {
          const c = ATS_COLORS[p]
          return (
            <button
              key={p}
              type="button"
              onClick={() => setFilter(filter === p ? 'all' : p)}
              className={`text-[10px] px-2 py-1 rounded-md transition-colors ${filter === p ? `${c.bg} ${c.text}` : 'text-muted-foreground bg-muted hover:bg-muted/80'}`}
            >
              {c.label} ({counts[p]})
            </button>
          )
        })}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search companies..."
          className="text-[11px] px-2 py-1 bg-muted/50 rounded-md text-foreground outline-none focus:bg-muted ml-auto w-36"
        />
      </div>

      {/* Company chips grid */}
      <div className="flex flex-wrap gap-1 max-h-64 overflow-y-auto">
        {filtered.map((c, i) => {
          const color = ATS_COLORS[c.ats]
          return (
            <span
              key={`${c.name}-${c.ats}-${i}`}
              className={`text-[10px] px-1.5 py-0.5 rounded ${color.bg} ${color.text}`}
            >
              {c.name}
            </span>
          )
        })}
        {filtered.length === 0 && (
          <span className="text-muted-foreground/50 text-[11px] py-2">No companies match your search.</span>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-3 mt-2 pt-2 bg-muted/20">
        {ATS_PLATFORMS.map((p) => {
          const c = ATS_COLORS[p]
          return (
            <span key={p} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className={`w-2 h-2 rounded-sm ${c.bg}`} />
              {c.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─── Live data types ─────────────────────────────────────────────────────────

interface LiveSourceHealth {
  status: 'connected' | 'healthy' | 'polling' | 'error' | 'disabled' | 'idle'
  lastPollAt: number | null
  lastErrorAt: number | null
  lastError: string | null
  jobsFound: number
  consecutiveFailures: number
}

interface LiveSource {
  id: string
  name: string
  type: 'stream' | 'poll'
  schedule: string
  cost: string | null
  envVars: string[]
  triggerPath: string | null
  health: LiveSourceHealth
}

interface LiveTap {
  tapName: string
  envKey: string
  ruleCount: number
  rules: { tag: string }[]
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'never'
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function StatusDot({ status }: { status: LiveSourceHealth['status'] }) {
  const colors: Record<string, string> = {
    connected: 'bg-green-500',
    healthy: 'bg-green-500',
    polling: 'bg-amber-500 animate-pulse',
    error: 'bg-red-500',
    disabled: 'bg-muted-foreground/30',
    idle: 'bg-muted-foreground/30',
  }
  return <span className={`inline-block w-[5px] h-[5px] rounded-full ${colors[status] ?? colors.idle}`} />
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const [liveSources, setLiveSources] = useState<LiveSource[]>([])
  const [liveTaps, setLiveTaps] = useState<LiveTap[]>([])
  const [procStats, setProcStats] = useState<ProcessorStats | null>(null)
  const [historicalCounts, setHistoricalCounts] = useState<Record<string, number>>({})
  const [scoringConfig, setScoringConfig] = useState<Record<string, any>>({})
  const [liveError, setLiveError] = useState(false)
  const [lastFetch, setLastFetch] = useState(0)

  async function fetchSources() {
    try {
      const [sourcesRes, scoringRes] = await Promise.all([
        fetch('/api/sources'),
        fetch('/api/scoring'),
      ])
      if (!sourcesRes.ok) throw new Error()
      const data = await sourcesRes.json()
      setLiveSources(data.sources ?? [])
      setLiveTaps(data.firehoseRules ?? [])
      if (data.processorStats) setProcStats(data.processorStats)
      if (data.historicalCounts) setHistoricalCounts(data.historicalCounts)
      if (scoringRes.ok) setScoringConfig(await scoringRes.json())
      setLiveError(false)
      setLastFetch(Date.now())
    } catch {
      setLiveError(true)
    }
  }

  useEffect(() => {
    fetchSources()
    const interval = setInterval(fetchSources, 15_000)
    return () => clearInterval(interval)
  }, [])

  // Fall back to static data if backend unreachable
  const sources = liveSources.length > 0 ? liveSources : SOURCES.map((s) => ({
    ...s,
    cost: s.cost,
    health: { status: 'idle' as const, lastPollAt: null, lastErrorAt: null, lastError: null, jobsFound: 0, consecutiveFailures: 0 },
  }))
  const taps = liveTaps.length > 0 ? liveTaps : TAPS.map((t) => ({
    tapName: t.name,
    envKey: t.token,
    ruleCount: t.rules.length,
    rules: t.rules.map((r) => ({ tag: r.tag })),
  }))

  const totalRules = taps.reduce((sum, t) => sum + t.ruleCount, 0)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Sources</h1>
          <div className="text-xs text-muted-foreground">
            {liveError ? (
              <span className="text-red-500">Listener offline</span>
            ) : lastFetch > 0 ? (
              <span>Live &middot; updated {timeAgo(lastFetch)}</span>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {sources.length} data sources &middot; {totalRules} Firehose rules across {taps.length} taps &middot; {KEYWORD_GROUPS.reduce((s, g) => s + g.terms.length, 0)} scoring keywords
        </p>
      </div>

      {/* ── Source Cards ────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground mb-3">Data Sources</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {sources.map((s) => (
            <LiveSourceCard key={s.id} source={s} onTrigger={fetchSources} dbCount={historicalCounts[s.id]} />
          ))}
        </div>
      </div>

      {/* ── Configuration & Rules ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground mb-3">Configuration &amp; Rules</h2>
        <div className="space-y-3">

      <Section title="Firehose Rules Browser" badge={`${totalRules} rules across ${taps.length} taps`}>
        <div className="space-y-3 pt-3">
          {taps.map((tap) => (
            <LiveTapSection key={tap.tapName} tap={tap} />
          ))}
        </div>
      </Section>

      {/* ── Processor Filtering Pipeline ──────────────────────────────────── */}
      <Section title="Processor Filtering Pipeline" badge={procStats ? `${procStats.received} received · ${procStats.inserted} inserted` : `${FILTER_PIPELINE.length} stages`}>
        <div className="space-y-2 pt-3">
          {procStats && (
            <div className="flex gap-3 text-xs mb-3 px-1">
              <span className="bg-muted rounded-md px-2 py-1 tabular-nums">
                <span className="text-muted-foreground">Received:</span> <span className="font-medium">{procStats.received}</span>
              </span>
              <span className="bg-green-50 text-green-800 rounded-md px-2 py-1 tabular-nums">
                <span className="opacity-70">Inserted:</span> <span className="font-medium">{procStats.inserted}</span>
              </span>
            </div>
          )}
          {FILTER_PIPELINE.map((f, i) => {
            const count = procStats && f.statsKey ? procStats[f.statsKey] : null
            return (
              <div key={i} className="flex gap-3 text-xs">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-medium mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{f.name}</span>
                    <span className="text-muted-foreground/50 font-normal">{f.scope}</span>
                    {count !== null && count > 0 && (
                      <span className="ml-auto tabular-nums text-[10px] font-medium bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                        {count} blocked
                      </span>
                    )}
                    {count !== null && count === 0 && (
                      <span className="ml-auto tabular-nums text-[10px] text-muted-foreground/40 px-1.5 py-0.5">
                        0
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-0.5">{f.description}</div>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* ── Scoring System ────────────────────────────────────────────────── */}
      {(() => {
        const liveGroups = scoringConfig.keyword_groups as any[] | undefined
        const liveSeniorityExclude = scoringConfig.seniority_exclude as string[] | undefined
        const liveNewgrad = scoringConfig.seniority_newgrad as string[] | undefined
        const liveNonDesign = scoringConfig.non_design_titles as string[] | undefined
        const liveBlockedLocations = scoringConfig.blocked_locations as string[] | undefined
        const liveBlockedCompanies = scoringConfig.blocked_companies as string[] | undefined
        const displayGroups = liveGroups ?? KEYWORD_GROUPS
        const totalTerms = displayGroups.reduce((s: number, g: any) => s + (g.terms?.length ?? 0), 0)
        return (
      <Section title="Scoring System" badge={`${totalTerms} keywords in ${displayGroups.length} groups`}>
        <div className="space-y-4 pt-3">
          {/* Keyword groups */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-muted-foreground/50 uppercase font-medium">Keyword Groups</div>
              <a href="/settings#keywords" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Edit</a>
            </div>
            <div className="space-y-2">
              {displayGroups.map((group: any) => (
                <KeywordGroupRow key={group.name} group={group} />
              ))}
            </div>
          </div>

          {/* Company tiers */}
          <div>
            <div className="text-xs text-muted-foreground/50 uppercase font-medium mb-2">Company Tier Bonuses</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-red-50 border rounded p-2">
                <div className="font-semibold text-red-800">Tier 1: +20</div>
                <div className="text-red-600 mt-0.5">Pure B2B/Enterprise SaaS (58 companies)</div>
                <div className="text-red-500 text-[10px] mt-0.5">Salesforce, Figma, Stripe, Notion, Datadog...</div>
              </div>
              <div className="bg-amber-50 border rounded p-2">
                <div className="font-semibold text-amber-800">Tier 2: +10</div>
                <div className="text-amber-600 mt-0.5">Strong Enterprise DNA (85 companies)</div>
                <div className="text-amber-500 text-[10px] mt-0.5">Anthropic, Brex, Ramp, Linear, Retool...</div>
              </div>
              <div className="bg-muted border rounded p-2">
                <div className="font-semibold text-foreground">Tier 3: +5</div>
                <div className="text-muted-foreground mt-0.5">B2B-Adjacent / Big Tech (78 companies)</div>
                <div className="text-muted-foreground/50 text-[10px] mt-0.5">Google, Microsoft, Meta, Apple, Amazon...</div>
              </div>
            </div>
          </div>

          {/* Seniority */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-muted-foreground/50 uppercase font-medium">Seniority &amp; Title Filters</div>
              <a href="/settings#seniority" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Edit</a>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-green-700">+10</div>
                <div className="text-muted-foreground">{liveNewgrad ? liveNewgrad.slice(0, 5).join(', ') : 'New grad / associate / junior'}{liveNewgrad && liveNewgrad.length > 5 ? '...' : ''}</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-blue-700">+5</div>
                <div className="text-muted-foreground">&quot;Product Designer&quot; or &quot;UX Designer&quot; (no level)</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-red-600">Excluded</div>
                <div className="text-muted-foreground">{liveSeniorityExclude ? liveSeniorityExclude.join(', ') : 'Staff / principal / director / VP / manager'}</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-red-800">Hard blocked</div>
                <div className="text-muted-foreground">{liveNonDesign ? `${liveNonDesign.length} non-design titles` : '27 non-design titles'}</div>
              </div>
            </div>
          </div>

          {/* Blocklists */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-muted-foreground/50 uppercase font-medium">Blocklists</div>
              <a href="/settings#blocklists" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Edit</a>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-foreground">{liveBlockedCompanies?.length ?? 2} blocked companies</div>
                <div className="text-muted-foreground mt-0.5">{liveBlockedCompanies ? liveBlockedCompanies.join(', ') : 'lensa, itjobswatch'}</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-foreground">{liveBlockedLocations?.length ?? 92} blocked locations</div>
                <div className="text-muted-foreground mt-0.5">Non-US cities &amp; countries</div>
              </div>
            </div>
          </div>

          {/* Location bonuses */}
          <div>
            <div className="text-xs text-muted-foreground/50 uppercase font-medium mb-2">Location Bonuses</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-green-700">+5</div>
                <div className="text-muted-foreground">Remote / Hybrid / SF Bay Area / Seattle</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-blue-700">+3</div>
                <div className="text-muted-foreground">NYC metro</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-muted-foreground">0</div>
                <div className="text-muted-foreground">Other US locations</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="font-semibold text-red-600">-20</div>
                <div className="text-muted-foreground">Non-US ({liveBlockedLocations?.length ?? '92'}+ cities/countries)</div>
              </div>
            </div>
          </div>

          {/* Priority */}
          <div>
            <div className="text-xs text-muted-foreground/50 uppercase font-medium mb-2">Priority Thresholds</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-red-50/80 text-red-800 px-2 py-1 rounded-md font-medium">High: fit &ge; 80%</span>
              <span className="bg-amber-50/80 text-amber-800 px-2 py-1 rounded-md font-medium">Medium: fit &ge; 50%</span>
              <span className="bg-muted text-muted-foreground border px-2 py-1 rounded font-medium">Low: fit &ge; 1%</span>
              <span className="bg-muted text-muted-foreground/50 border px-2 py-1 rounded font-medium">Skip: fit = 0%</span>
            </div>
          </div>

          {/* Resume fit */}
          <div>
            <div className="text-xs text-muted-foreground/50 uppercase font-medium mb-1">Resume Fit</div>
            <p className="text-xs text-muted-foreground">
              Percentage of posting&apos;s matched keywords that also appear in the active resume. LLM enrichment (Gemini/Anthropic) provides accurate role_fit scores after initial regex scoring. If resume is active and fit = 0%, the job is skipped.
            </p>
          </div>
        </div>
      </Section>
        )
      })()}

      {/* ── Fallback Chain ────────────────────────────────────────────────── */}
      <Section title="Fallback Chain">
        <div className="pt-3 text-xs space-y-3">
          <p className="text-muted-foreground">Checked every 60 minutes. Activates when primary LinkedIn sources fail.</p>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded bg-green-100 text-green-700 flex items-center justify-center text-[10px] font-semibold">1</span>
              <div>
                <div className="font-medium text-foreground">Normal operation</div>
                <div className="text-muted-foreground">Firehose (real-time) + ATS (hourly) + Mantiks (weekly) + LinkedIn Scraper (2x/day) + SerpApi (2x/day) + HasData (2x/day) + GitHub Jobright (2x/day)</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-semibold">2</span>
              <div>
                <div className="font-medium text-foreground">Mantiks + Scraper both down &gt; 8 hours</div>
                <div className="text-muted-foreground">Trigger SerpApi immediately as coverage backup</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded bg-red-100 text-red-700 flex items-center justify-center text-[10px] font-semibold">3</span>
              <div>
                <div className="font-medium text-foreground">All LinkedIn sources + SerpApi unavailable</div>
                <div className="text-muted-foreground">Activate LinkedIn Direct scraper (emergency HTML scraping, max 10 requests, 30-120s delays)</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TapSection({ tap }: { tap: Tap }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-muted/50 rounded-md">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between text-left text-xs hover:bg-muted"
      >
        <span className="flex items-center gap-2">
          <span className="font-medium">{tap.name}</span>
          <span className="text-muted-foreground/50">Account {tap.account}</span>
          <span className="text-muted-foreground/50">&middot;</span>
          <span className="text-muted-foreground/50">{tap.rules.length} rules</span>
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="bg-muted/20">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted text-[10px] text-muted-foreground uppercase">
                <th className="px-3 py-1.5 text-left font-medium">Tag</th>
                <th className="px-3 py-1.5 text-left font-medium">Target</th>
                <th className="px-3 py-1.5 text-left font-medium w-16">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tap.rules.map((rule) => (
                <tr key={rule.tag} className="hover:bg-muted">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-gray-800 whitespace-nowrap">{rule.tag}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{rule.target}</td>
                  <td className="px-3 py-1.5"><RuleTypeBadge type={rule.type} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Live Source Card ─────────────────────────────────────────────────────────

function LiveSourceCard({ source, onTrigger, dbCount }: { source: LiveSource; onTrigger: () => void; dbCount?: number }) {
  const [open, setOpen] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const h = source.health

  async function triggerPoll() {
    if (!source.triggerPath) return
    setTriggering(true)
    try {
      await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerPath: source.triggerPath }),
      })
      setTimeout(onTrigger, 1000)
    } catch { /* ignore */ }
    setTriggering(false)
  }

  return (
    <div className="bg-card rounded-lg overflow-hidden border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full px-4 py-3 text-left transition-colors ${open ? 'bg-muted/50' : 'hover:bg-muted/50'}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot status={h.status} />
              <span className="text-sm font-medium leading-6">{source.name}</span>
              <TypeBadge type={source.type} />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {[
                source.schedule,
                source.cost,
                h.lastPollAt ? `Last: ${timeAgo(h.lastPollAt)}` : null,
                h.jobsFound > 0 ? `${h.jobsFound} jobs` : null,
                dbCount ? `${dbCount} in DB` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </div>
      </button>

      {open && (
        <div className="px-4 py-3 bg-muted/30 space-y-3 text-xs">
          {/* Health details */}
          <div className="pt-3">
            <div className="font-label text-muted-foreground uppercase text-[10px] font-medium mb-1">Health</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">Status:</span> <span className="font-medium capitalize">{h.status}</span></div>
              <div><span className="text-muted-foreground">Last poll:</span> <span className="tabular-nums">{timeAgo(h.lastPollAt)}</span></div>
              <div><span className="text-muted-foreground">Jobs found:</span> <span className="tabular-nums">{h.jobsFound}</span></div>
              <div><span className="text-muted-foreground">Failures:</span> <span className="tabular-nums">{h.consecutiveFailures}</span></div>
              {dbCount !== undefined && dbCount > 0 && (
                <div className="col-span-2"><span className="text-muted-foreground">Total in DB:</span> <span className="tabular-nums font-medium">{dbCount}</span></div>
              )}
              {h.lastError && (
                <div className="col-span-2 text-red-600 truncate">Error: {h.lastError}</div>
              )}
            </div>
          </div>

          {/* Env vars */}
          {source.envVars.length > 0 && (
            <div>
              <div className="font-label text-muted-foreground uppercase text-[10px] font-medium mb-1">Environment Variables</div>
              <div className="flex flex-wrap gap-1">
                {source.envVars.map((v) => (
                  <span key={v} className="font-mono text-[11px] bg-muted text-foreground px-1.5 py-0.5 rounded">{v}</span>
                ))}
              </div>
            </div>
          )}

          {/* Trigger button */}
          {source.triggerPath && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); triggerPoll() }}
              disabled={triggering || h.status === 'polling'}
              className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {triggering || h.status === 'polling' ? 'Running...' : 'Run Now'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Live Tap Section ────────────────────────────────────────────────────────

function LiveTapSection({ tap }: { tap: LiveTap }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-muted/50 rounded-md">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between text-left text-xs hover:bg-muted"
      >
        <span className="flex items-center gap-2">
          <span className="font-medium">{tap.tapName}</span>
          <span className="text-muted-foreground/50">&middot;</span>
          <span className="text-muted-foreground/50 tabular-nums">{tap.ruleCount} rules</span>
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="px-3 pb-2 bg-muted/20 pt-2 flex flex-wrap gap-1">
          {tap.rules.map((r) => (
            <span key={r.tag} className="font-mono text-[11px] bg-muted text-foreground px-1.5 py-0.5 rounded">{r.tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function KeywordGroupRow({ group }: { group: typeof KEYWORD_GROUPS[number] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-muted/50 rounded-md">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between text-left text-xs hover:bg-muted"
      >
        <span className="flex items-center gap-3">
          <span className="font-medium text-foreground">{group.name}</span>
          <span className="text-muted-foreground/50">weight: {group.weight}</span>
          <span className="text-muted-foreground/50">&middot;</span>
          <span className="text-muted-foreground/50">{group.terms.length} terms</span>
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="px-3 pb-2 bg-muted/20 pt-2 flex flex-wrap gap-1">
          {group.terms.map((term) => (
            <span key={term} className="text-[10px] bg-muted text-foreground px-1.5 py-0.5 rounded">{term}</span>
          ))}
        </div>
      )}
    </div>
  )
}
