'use client'

import { useState, useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIsDemo } from '@/lib/demo-mode'

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
  greenhouse: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Greenhouse' },
  lever: { bg: 'bg-teal-100', text: 'text-teal-800', label: 'Lever' },
  ashby: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Ashby' },
  smartrecruiters: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'SmartRecruiters' },
}

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
}

const FILTER_PIPELINE: { name: string; scope: string; description: string; statsKey: keyof ProcessorStats | null }[] = [
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

// ─── Tag Editor (for editable config sections) ──────────────────────────────

function TagEditor({ tags, onChange, placeholder, allTermsAcrossGroups, disabled }: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  allTermsAcrossGroups?: Set<string>
  disabled?: boolean
}) {
  const [input, setInput] = useState('')
  const [expanded, setExpanded] = useState(tags.length <= 20)
  const [dupeWarning, setDupeWarning] = useState<string | null>(null)

  const inputLower = input.trim().toLowerCase()
  const isDupeInList = !!inputLower && tags.some((t) => t.toLowerCase() === inputLower)
  const isDupeAcrossGroups = !!inputLower && !isDupeInList && !!allTermsAcrossGroups?.has(inputLower)

  function addTag() {
    const trimmed = input.trim()
    if (!trimmed) return
    if (isDupeInList) { setDupeWarning(`"${trimmed}" already exists in this list`); setTimeout(() => setDupeWarning(null), 2000); return }
    if (isDupeAcrossGroups) { setDupeWarning(`"${trimmed}" already exists in another group`); setTimeout(() => setDupeWarning(null), 2000); return }
    onChange([...tags, trimmed])
    setInput('')
    setDupeWarning(null)
  }

  const display = expanded ? tags : tags.slice(0, 20)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {display.map((tag, i) => (
          <span key={`${tag}-${i}`} className="inline-flex items-center gap-1 text-xs bg-muted text-foreground px-2 py-1 rounded-md">
            {tag}
            <button type="button" aria-label="Remove tag" disabled={disabled} onClick={() => onChange(tags.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors ml-0.5 disabled:opacity-30 disabled:cursor-not-allowed">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </span>
        ))}
        {!expanded && tags.length > 20 && (
          <button type="button" onClick={() => setExpanded(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1">+{tags.length - 20} more</button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Input type="text" value={input} disabled={disabled} onChange={(e) => { setInput(e.target.value); setDupeWarning(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            placeholder={placeholder ?? 'Add item...'} className={`h-8 text-xs ${isDupeInList || isDupeAcrossGroups ? 'border-amber-400' : ''}`}
          />
          {inputLower && (isDupeInList || isDupeAcrossGroups) && (
            <div className="absolute -bottom-5 left-0 text-[10px] text-amber-600">{isDupeInList ? 'Already in this list' : 'Exists in another group'}</div>
          )}
        </div>
        <Button size="xs" variant="outline" onClick={addTag} disabled={disabled || !input.trim() || isDupeInList || isDupeAcrossGroups}>Add</Button>
      </div>
      {dupeWarning && <div className="text-[11px] text-amber-600">{dupeWarning}</div>}
    </div>
  )
}

// ─── Config Section (editable, with save/reset/dirty) ───────────────────────

function ConfigSection({ id, title, description, children, saving, hasChanges, onSave, onReset, disabled }: {
  id: string; title: string; description: string; children: React.ReactNode
  saving: boolean; hasChanges: boolean; onSave: () => void; onReset: () => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (window.location.hash === `#${id}`) setOpen(true)
  }, [id])

  return (
    <section id={id} className="bg-card rounded-lg border overflow-hidden scroll-mt-16">
      <button type="button" onClick={() => setOpen(!open)}
        className={`w-full px-4 py-3 flex items-center justify-between text-left transition-colors ${open ? 'bg-muted/50' : 'hover:bg-muted/50'}`}
      >
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform shrink-0 ml-3 ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <>
          <div className="px-4 py-3 space-y-4">{children}</div>
          <div className="px-4 py-3 border-t flex items-center justify-between">
            {hasChanges && (
              <button type="button" onClick={onReset} disabled={disabled} className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Undo changes</button>
            )}
            {!hasChanges && <span />}
            <Button size="sm" onClick={onSave} disabled={disabled || saving || !hasChanges}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </>
      )}
    </section>
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
  const isDemo = useIsDemo()
  const [liveSources, setLiveSources] = useState<LiveSource[]>([])
  const [procStats, setProcStats] = useState<ProcessorStats | null>(null)
  const [historicalCounts, setHistoricalCounts] = useState<Record<string, number>>({})
  const [scoringConfig, setScoringConfig] = useState<Record<string, any>>({})
  const [liveError, setLiveError] = useState(false)
  const [lastFetch, setLastFetch] = useState(0)
  const [tab, setTab] = useState<'sources' | 'config'>('sources')

  // ── Configuration editing state ────────────────────────────────────────────
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [configToast, setConfigToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const configToastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  interface KWGroup { name: string; weight: number; terms: string[] }
  const [localKeywords, setLocalKeywords] = useState<KWGroup[]>([])
  const [localSeniorityExclude, setLocalSeniorityExclude] = useState<string[]>([])
  const [localSeniorityNewgrad, setLocalSeniorityNewgrad] = useState<string[]>([])
  const [localNonDesign, setLocalNonDesign] = useState<string[]>([])
  const [localBlockedCompanies, setLocalBlockedCompanies] = useState<string[]>([])
  const [localBlockedLocations, setLocalBlockedLocations] = useState<string[]>([])


  // Sync local state from scoring config
  useEffect(() => {
    if (!scoringConfig.keyword_groups) return
    setLocalKeywords(scoringConfig.keyword_groups)
    setLocalSeniorityExclude(scoringConfig.seniority_exclude ?? [])
    setLocalSeniorityNewgrad(scoringConfig.seniority_newgrad ?? [])
    setLocalNonDesign(scoringConfig.non_design_titles ?? [])
    setLocalBlockedCompanies(scoringConfig.blocked_companies ?? [])
    setLocalBlockedLocations(scoringConfig.blocked_locations ?? [])
  }, [scoringConfig])

  // Auto-select config tab on hash navigation
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (['keywords', 'seniority', 'title-blocklist', 'blocklists', 'job-boards'].includes(hash)) {
      setTab('config')
      setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }), 200)
    }
  }, [])

  function showConfigToast(message: string, type: 'success' | 'error' = 'success') {
    setConfigToast({ message, type })
    if (configToastTimeout.current) clearTimeout(configToastTimeout.current)
    configToastTimeout.current = setTimeout(() => setConfigToast(null), 3000)
  }

  async function saveConfig(key: string, value: any) {
    setSavingKey(key)
    const res = await fetch('/api/scoring', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (res.ok) {
      setScoringConfig((prev) => ({ ...prev, [key]: value }))
      showConfigToast(`${key.replace(/_/g, ' ')} saved`)
    } else {
      const { error } = await res.json()
      showConfigToast(error ?? 'Save failed', 'error')
    }
    setSavingKey(null)
  }

  function reloadConfig() {
    fetch('/api/scoring').then(r => r.json()).then(data => setScoringConfig(data)).catch(() => {})
  }

  async function fetchSources() {
    try {
      const [sourcesRes, scoringRes] = await Promise.all([
        fetch('/api/sources'),
        fetch('/api/scoring'),
      ])
      if (!sourcesRes.ok) throw new Error()
      const data = await sourcesRes.json()
      setLiveSources(data.sources ?? [])
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
  const liveGroups = scoringConfig.keyword_groups as KWGroup[] | undefined
  const totalTerms = (liveGroups ?? KEYWORD_GROUPS).reduce((s: number, g: any) => s + (g.terms?.length ?? 0), 0)

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
          {sources.length} data sources &middot; {totalTerms} scoring keywords
        </p>
      </div>

      {/* Tab toggle */}
      <div className="relative inline-flex items-center bg-muted rounded-full p-[3px] text-xs">
        <button type="button" onClick={() => setTab('sources')}
          className={`relative z-10 px-3 py-1 rounded-full transition-colors duration-200 ${tab === 'sources' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
        >Data Sources</button>
        <button type="button" onClick={() => setTab('config')}
          className={`relative z-10 px-3 py-1 rounded-full transition-colors duration-200 ${tab === 'config' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
        >Configuration</button>
      </div>

      {/* Toast */}
      {configToast && (
        <div className={`text-xs rounded-md px-3 py-2 ${configToast.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {configToast.message}
        </div>
      )}

      {/* ══════════════ DATA SOURCES TAB ══════════════ */}
      {tab === 'sources' && (
        <div>
          <div className="grid gap-3 md:grid-cols-2 items-start">
            {sources.map((s) => (
              <LiveSourceCard key={s.id} source={s} onTrigger={fetchSources} dbCount={historicalCounts[s.id]} disabled={isDemo} />
            ))}
          </div>
        </div>
      )}

      {/* ══════════════ CONFIGURATION TAB ══════════════ */}
      {tab === 'config' && (
        <div className="space-y-3">

          <h2 className="text-xs font-medium text-muted-foreground pt-3">Scoring</h2>

          {/* Editable: Keyword Groups */}
          <ConfigSection
            id="keywords"
            title="Scoring Keywords"
            description={`${localKeywords.reduce((s, g) => s + g.terms.length, 0)} words to look for in job posts — more matches = higher fit score`}
            saving={savingKey === 'keyword_groups'}
            hasChanges={JSON.stringify(localKeywords) !== JSON.stringify(scoringConfig.keyword_groups)}
            onSave={() => saveConfig('keyword_groups', localKeywords)}
            onReset={reloadConfig}
            disabled={isDemo}
          >
            <div className="space-y-4">
              {localKeywords.map((group, gi) => (
                <details key={group.name} className="group">
                  <summary className="flex items-center justify-between cursor-pointer py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{group.name.replace(/_/g, ' ')}</span>
                      <Badge variant="secondary" className="text-[10px]">{group.terms.length}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        Weight:
                        <input type="number" min={0} max={10} value={group.weight} disabled={isDemo}
                          onChange={(e) => { const u = [...localKeywords]; u[gi] = { ...u[gi], weight: Number(e.target.value) }; setLocalKeywords(u) }}
                          className="w-12 text-xs px-1.5 py-0.5 rounded border border-input bg-background text-center disabled:opacity-50"
                        />
                      </label>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-muted-foreground/50 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </div>
                  </summary>
                  <div className="pt-2 pb-3">
                    <TagEditor
                      tags={group.terms}
                      onChange={(terms) => { const u = [...localKeywords]; u[gi] = { ...u[gi], terms }; setLocalKeywords(u) }}
                      placeholder={`Add ${group.name.replace(/_/g, ' ')} term...`}
                      allTermsAcrossGroups={new Set(localKeywords.filter((_, i) => i !== gi).flatMap(g => g.terms.map(t => t.toLowerCase())))}
                      disabled={isDemo}
                    />
                  </div>
                </details>
              ))}
            </div>
          </ConfigSection>

          <h2 className="text-xs font-medium text-muted-foreground pt-3">Filtering</h2>

          {/* Editable: Seniority Filters */}
          <ConfigSection
            id="seniority"
            title="Seniority Levels"
            description="Skip too-senior roles, boost new-grad roles"
            saving={savingKey === 'seniority_exclude' || savingKey === 'seniority_newgrad'}
            hasChanges={JSON.stringify(localSeniorityExclude) !== JSON.stringify(scoringConfig.seniority_exclude) || JSON.stringify(localSeniorityNewgrad) !== JSON.stringify(scoringConfig.seniority_newgrad)}
            onSave={async () => { await saveConfig('seniority_exclude', localSeniorityExclude); await saveConfig('seniority_newgrad', localSeniorityNewgrad) }}
            onReset={reloadConfig}
            disabled={isDemo}
          >
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">Excluded seniority levels (jobs deprioritized)</div>
              <TagEditor tags={localSeniorityExclude} onChange={setLocalSeniorityExclude} placeholder="Add pattern (e.g. staff, principal)..." disabled={isDemo} />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">New grad bonus patterns (+10 score)</div>
              <TagEditor tags={localSeniorityNewgrad} onChange={setLocalSeniorityNewgrad} placeholder="Add pattern (e.g. junior, associate)..." disabled={isDemo} />
            </div>
          </ConfigSection>

          {/* Editable: Non-Design Title Blocklist */}
          <ConfigSection
            id="title-blocklist"
            title="Blocked Titles"
            description="Drop jobs with these words in the title (e.g. engineer, intern)"
            saving={savingKey === 'non_design_titles'}
            hasChanges={JSON.stringify(localNonDesign) !== JSON.stringify(scoringConfig.non_design_titles)}
            onSave={() => saveConfig('non_design_titles', localNonDesign)}
            onReset={reloadConfig}
            disabled={isDemo}
          >
            <TagEditor tags={localNonDesign} onChange={setLocalNonDesign} placeholder="Add blocked keyword (e.g. engineer, intern)..." disabled={isDemo} />
          </ConfigSection>

          {/* Editable: Company & Location Blocklists */}
          <ConfigSection
            id="blocklists"
            title="Blocked Companies & Locations"
            description="Always skip these companies and non-US locations"
            saving={savingKey === 'blocked_companies' || savingKey === 'blocked_locations'}
            hasChanges={JSON.stringify(localBlockedCompanies) !== JSON.stringify(scoringConfig.blocked_companies) || JSON.stringify(localBlockedLocations) !== JSON.stringify(scoringConfig.blocked_locations)}
            onSave={async () => { await saveConfig('blocked_companies', localBlockedCompanies); await saveConfig('blocked_locations', localBlockedLocations) }}
            onReset={reloadConfig}
            disabled={isDemo}
          >
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">Blocked companies ({localBlockedCompanies.length})</div>
              <TagEditor tags={localBlockedCompanies} onChange={setLocalBlockedCompanies} placeholder="Add company name..." disabled={isDemo} />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">Blocked locations ({localBlockedLocations.length})</div>
              <TagEditor tags={localBlockedLocations} onChange={setLocalBlockedLocations} placeholder="Add city or country..." disabled={isDemo} />
            </div>
          </ConfigSection>

          <h2 className="text-xs font-medium text-muted-foreground pt-3">System Reference</h2>

          {/* Read-only: Processor Filtering Pipeline */}
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
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-medium mt-0.5">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{f.name}</span>
                        <span className="text-muted-foreground/50 font-normal">{f.scope}</span>
                        {count !== null && count > 0 && <span className="ml-auto tabular-nums text-[10px] font-medium bg-red-50 text-red-700 px-1.5 py-0.5 rounded">{count} blocked</span>}
                        {count !== null && count === 0 && <span className="ml-auto tabular-nums text-[10px] text-muted-foreground/40 px-1.5 py-0.5">0</span>}
                      </div>
                      <div className="text-muted-foreground mt-0.5">{f.description}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>

          {/* Read-only: Fallback Chain */}
          <Section title="Fallback Chain">
            <div className="pt-3 text-xs space-y-3">
              <p className="text-muted-foreground">Checked every 60 minutes. Activates when primary LinkedIn sources fail.</p>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded bg-green-100 text-green-700 flex items-center justify-center text-[10px] font-semibold">1</span>
                  <div>
                    <div className="font-medium text-foreground">Normal operation</div>
                    <div className="text-muted-foreground">ATS (hourly) + Mantiks (weekly) + LinkedIn Scraper (2x/day) + SerpApi (2x/day) + HasData (2x/day) + GitHub Jobright (2x/day)</div>
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

          {/* Read-only: Priority & Location */}
          <Section title="Scoring Rules" badge="Location bonuses · Priority thresholds · Resume fit">
            <div className="space-y-4 pt-3">
              <div>
                <div className="text-xs text-muted-foreground/50 uppercase font-medium mb-2">Location Bonuses</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="bg-muted/50 rounded-md p-2"><div className="font-semibold text-green-700">+5</div><div className="text-muted-foreground">Remote / Hybrid / SF Bay Area / Seattle</div></div>
                  <div className="bg-muted/50 rounded-md p-2"><div className="font-semibold text-blue-700">+3</div><div className="text-muted-foreground">NYC metro</div></div>
                  <div className="bg-muted/50 rounded-md p-2"><div className="font-semibold text-muted-foreground">0</div><div className="text-muted-foreground">Other US locations</div></div>
                  <div className="bg-muted/50 rounded-md p-2"><div className="font-semibold text-red-600">-20</div><div className="text-muted-foreground">Non-US ({localBlockedLocations.length}+ cities)</div></div>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground/50 uppercase font-medium mb-2">Priority Thresholds</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="bg-red-50/80 text-red-800 px-2 py-1 rounded-md font-medium">High: fit &ge; 80%</span>
                  <span className="bg-amber-50/80 text-amber-800 px-2 py-1 rounded-md font-medium">Medium: fit &ge; 50%</span>
                  <span className="bg-muted text-muted-foreground border px-2 py-1 rounded font-medium">Low: fit &ge; 1%</span>
                  <span className="bg-muted text-muted-foreground/50 border px-2 py-1 rounded font-medium">Skip: fit = 0%</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground/50 uppercase font-medium mb-1">Resume Fit</div>
                <p className="text-xs text-muted-foreground">Percentage of posting&apos;s matched keywords that also appear in the active resume. LLM enrichment provides accurate scoring. If fit = 0%, the job is skipped.</p>
              </div>
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// ─── Live Source Card ─────────────────────────────────────────────────────────

function LiveSourceCard({ source, onTrigger, dbCount, disabled }: { source: LiveSource; onTrigger: () => void; dbCount?: number; disabled?: boolean }) {
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
              disabled={disabled || triggering || h.status === 'polling'}
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


