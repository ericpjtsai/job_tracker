// Firehose rule + tap management — multi-tap, idempotent upsert

import https from 'https'

// ─── Shared filters ───────────────────────────────────────────────────────────

// Excludes postings that explicitly mention a non-US location.
const NON_US_EXCLUSION =
  `AND NOT ("London" OR "United Kingdom" OR " UK" OR "Berlin" OR "Germany" OR ` +
  `"Paris" OR "France" OR "Tokyo" OR "Japan" OR "Singapore" OR ` +
  `"Sydney" OR "Melbourne" OR "Australia" OR "Toronto" OR "Vancouver" OR "Canada" OR ` +
  `"Mumbai" OR "Bangalore" OR "India" OR "Dublin" OR "Ireland" OR ` +
  `"Amsterdam" OR "Netherlands" OR "Stockholm" OR "Sweden" OR ` +
  `"Beijing" OR "Shanghai" OR "China" OR "Seoul" OR "Korea" OR ` +
  `"Tel Aviv" OR "Israel" OR "São Paulo" OR "Brazil" OR "Mexico City")`

const FP_EXCLUSION =
  `AND NOT ("graphic designer" OR "interior designer" OR "fashion designer" OR ` +
  `"instructional designer" OR "game designer" OR "industrial designer" OR ` +
  `"freelance" OR "contractor" OR "part-time")`

// Wraps a content query with location exclusion + false-positive exclusion.
function buildRule(base: string): string {
  return `(${base}) ${NON_US_EXCLUSION} ${FP_EXCLUSION}`
}

// Domain-scoped rules use language:"en" instead of keyword-based location exclusion.
function buildDomainRule(base: string, fpFilter = true): string {
  return `${base} AND language:"en"${fpFilter ? ` ${FP_EXCLUSION}` : ''}`
}

// ─── Role title shorthand ─────────────────────────────────────────────────────

const DESIGN_TITLES =
  `"product designer" OR "UX designer" OR "UI/UX designer" OR "UI designer" OR ` +
  `"interaction designer" OR "experience designer" OR "design engineer" OR ` +
  `"UX/UI designer" OR "associate designer" OR "junior designer" OR "senior designer" OR ` +
  `"design technologist" OR "UX researcher" OR "user researcher" OR "design lead" OR ` +
  `"UX lead" OR "product design" OR "UX design" OR "user experience designer"`

// ─── Tap configurations ───────────────────────────────────────────────────────

export interface FirehoseRule {
  tag: string
  value: string
}

export interface TapConfig {
  name: string       // display name, used to match existing taps
  envKey: string     // env var name where token is stored after creation
  rules: FirehoseRule[]
}

export const TAP_CONFIGS: TapConfig[] = [

  // ── Tap 1: Core search ──────────────────────────────────────────────────────
  {
    name: 'Job Tracker',
    envKey: 'FIREHOSE_TAP_TOKEN',
    rules: [
      {
        tag: 'b2b-core',
        value: buildRule(
          `(${DESIGN_TITLES}) AND NOT ("senior staff" OR "principal" OR "director" OR "VP" OR "head of design" OR "design manager" OR "8+ years" OR "10+ years")`
        ),
      },
      {
        tag: 'b2b-enterprise',
        value: buildRule(
          `("product designer" OR "UX designer") AND ("B2B" OR "enterprise" OR "SaaS" OR "platform") AND ("design system" OR "dashboard" OR "workflow" OR "developer tools" OR "API" OR "CRM" OR "fintech" OR "internal tools")`
        ),
      },
      {
        tag: 'b2b-ai',
        value: buildRule(
          `("product designer" OR "UX designer" OR "AI designer") AND ("generative AI" OR "LLM" OR "conversational UI" OR "AI-powered" OR "agentic" OR "AI agent" OR "AI-first" OR "human-in-the-loop")`
        ),
      },
      {
        tag: 'b2b-newgrad',
        value: buildRule(
          `("product designer" OR "UX designer" OR "associate designer") AND ("new grad" OR "early career" OR "2026" OR "entry level" OR "junior" OR "associate" OR "university" OR "recent graduate") AND ("B2B" OR "enterprise" OR "SaaS" OR "AI" OR "platform" OR "fintech")`
        ),
      },
      {
        tag: 'b2b-target-co',
        value: buildRule(
          `("product designer" OR "UX designer" OR "interaction designer" OR "design engineer") AND (` +
          `"Salesforce" OR "Docusign" OR "HubSpot" OR "OpenAI" OR "Plaid" OR "Cisco" OR "Zoom" OR "Atlassian" OR "ServiceNow" OR "Notion" OR "Figma" OR "Datadog" OR "Snowflake" OR "Stripe" OR "Twilio" OR "MongoDB" OR "Airtable" OR "Amplitude" OR "Asana" OR "Monday" OR "Palantir" OR "Okta" OR "PagerDuty" OR "Cloudflare" OR "Vercel" OR "GitLab" OR "Confluent" OR "HashiCorp" OR "Grammarly" OR "Workday" OR "Oracle" OR "SAP" OR "Intuit" OR "Adobe" OR "Zendesk" OR "Freshworks" OR "Intercom" OR "Box" OR "FullStory" OR "Qualtrics" OR "UserTesting" OR "Mixpanel" OR "Dropbox" OR "Coda" OR "ClickUp" OR "Smartsheet" OR "Webflow" OR "Medallia" OR "LogRocket" OR ` +
          `"Anthropic" OR "Contextual AI" OR "ReadAI" OR "Klaviyo" OR "nCino" OR "Fiserv" OR "Outset.ai" OR "Brex" OR "Ramp" OR "Gusto" OR "Rippling" OR "Lattice" OR "Deel" OR "Toast" OR "Veeva" OR "Coupa" OR "Clio" OR "Procore" OR "Samsara" OR "dbt Labs" OR "Retool" OR "Linear" OR "Loom" OR "Miro" OR "Canva" OR "Dovetail" OR "Pendo" OR "LaunchDarkly" OR "Postman" OR "Supabase" OR "Weights & Biases" OR "Scale AI" OR "Cohere" OR "Writer" OR "Framer" OR "Calendly" OR "Carta" OR "Bill.com" OR "Greenhouse" OR "Ashby" OR "HiBob" OR "Talkdesk" OR "Five9" OR "Sprinklr" OR "Sprout Social" OR "Contentful" OR "Optimizely" OR "Segment" OR "Hex" OR "Mural" OR "Lucid" OR "RingCentral" OR "Genesys" OR "UiPath" OR "Celonis" OR "Appian" OR "Blend" OR "Checkr" OR "Marqeta" OR "Tipalti" OR "Pave" OR "Expensify" OR "Statsig" OR "Eppo")`
        ),
      },
      {
        tag: 'b2b-tier3',
        value: buildRule(
          `("product designer" OR "UX designer" OR "interaction designer" OR "design engineer") AND (` +
          `"Microsoft" OR "Google" OR "Amazon" OR "AWS" OR "Meta" OR "Apple" OR "LinkedIn" OR "GitHub" OR "Nvidia" OR "Netflix" OR "Spotify" OR "Snap" OR "Snapchat" OR "PayPal" OR "Venmo" OR "Twitter" OR "ByteDance" OR "TikTok" OR "Twitch" OR "Discord" OR "Duolingo" OR ` +
          `"Shopify" OR "Square" OR "Block" OR "Robinhood" OR "Coinbase" OR "Airbnb" OR "Uber" OR "Lyft" OR "DoorDash" OR "Instacart" OR ` +
          `"Goldman Sachs" OR "Morgan Stanley" OR "JPMorgan" OR "Capital One" OR "American Express" OR "Visa" OR "Mastercard" OR "BlackRock" OR "Fidelity" OR "Bloomberg" OR ` +
          `"Deloitte" OR "Accenture" OR "McKinsey" OR "BCG" OR "PwC" OR "EY" OR ` +
          `"Databricks" OR "Waymo" OR "Rivian" OR "Cruise" OR "Equinix")`
        ),
      },
      {
        tag: 'b2b-design-systems',
        value: buildRule(
          `("design technologist" OR "design engineer" OR "systems designer" OR "design infrastructure" OR "frontend designer" OR "UX engineer" OR "design developer" OR "design ops" OR "DesignOps") AND ("design system" OR "component library" OR "design tokens" OR "Storybook" OR "React" OR "CSS" OR "Figma" OR "accessibility" OR "WCAG")`
        ),
      },
      {
        tag: 'b2b-fintech',
        value: buildRule(
          `("product designer" OR "UX designer" OR "interaction designer") AND ("fintech" OR "financial services" OR "payments" OR "banking" OR "credit" OR "lending" OR "insurance" OR "wealth management" OR "trading" OR "checkout" OR "fraud" OR "risk") AND ("B2B" OR "enterprise" OR "SaaS" OR "platform" OR "API" OR "dashboard" OR "compliance")`
        ),
      },
      {
        tag: 'b2b-startup',
        value: buildRule(
          `("product designer" OR "UX designer") AND ("Series A" OR "Series B" OR "Series C" OR "seed stage" OR "YC" OR "Y Combinator" OR "a16z" OR "Sequoia" OR "Andreessen Horowitz" OR "early stage" OR "growth stage") AND ("B2B" OR "enterprise" OR "SaaS" OR "AI" OR "platform" OR "developer tools" OR "0-to-1")`
        ),
      },
      {
        tag: 'linkedin-design',
        value:
          `domain:linkedin.com AND url:*\\/jobs\\/view\\/* AND ` +
          `(${DESIGN_TITLES} OR "product design") AND ` +
          `language:"en" AND ` +
          `NOT ("graphic designer" OR "interior designer" OR "fashion designer" OR "game designer" OR "industrial designer" OR "instructional designer")`,
      },
      {
        tag: 'linkedin-posts',
        value:
          `domain:linkedin.com AND NOT url:*\\/jobs\\/* AND ` +
          `("product designer" OR "UX designer" OR "interaction designer" OR "design engineer" OR "UX/UI designer") AND ` +
          `("we're hiring" OR "we are hiring" OR "hiring a" OR "now hiring" OR "open role" OR "open position" OR "join our team" OR "looking for a designer" OR "seeking a designer" OR "DM me" OR "link in bio" OR "link in comments" OR "apply below" OR "excited to share" OR "we just posted" OR "new opening" OR "new role") AND ` +
          `language:"en"`,
      },
      {
        tag: 'ats-design',
        value:
          `(domain:greenhouse.io OR domain:lever.co OR domain:ashbyhq.com OR domain:workable.com OR domain:wellfound.com OR domain:jobs.ashbyhq.com) AND ` +
          `(${DESIGN_TITLES}) AND ` +
          `language:"en" AND ` +
          `NOT ("graphic designer" OR "interior designer" OR "fashion designer" OR "game designer" OR "industrial designer")`,
      },
    ],
  },

  // ── Tap 2: Job platforms (6 rules) ─────────────────────────────────────────
  {
    name: 'Job Tracker Platforms',
    envKey: 'FIREHOSE_TAP_TOKEN_2',
    rules: [
      { tag: 'glassdoor',    value: buildDomainRule(`domain:glassdoor.com AND url:*\\/job-listing\\/* AND (${DESIGN_TITLES})`) },
      { tag: 'indeed',       value: buildDomainRule(`domain:indeed.com AND url:*\\/viewjob* AND (${DESIGN_TITLES})`) },
      { tag: 'dice',         value: buildDomainRule(`domain:dice.com AND url:*\\/jobs\\/* AND (${DESIGN_TITLES})`) },
      { tag: 'builtin',      value: buildDomainRule(`(domain:builtin.com OR domain:builtinnyc.com OR domain:builtinla.com OR domain:builtinsf.com OR domain:builtinseattle.com OR domain:builtinaustin.com OR domain:builtinboston.com OR domain:builtinchicago.com OR domain:builtincolorado.com) AND (${DESIGN_TITLES})`) },
      { tag: 'remote-boards', value: buildDomainRule(`(domain:weworkremotely.com OR domain:remotive.com OR domain:remote.co OR domain:flexjobs.com OR domain:nodesk.co) AND (${DESIGN_TITLES})`) },
      { tag: 'design-boards', value: buildDomainRule(`(domain:dribbble.com OR domain:coroflot.com OR domain:aiga.org OR domain:workingnotworking.com OR domain:authenticjobs.com OR domain:krop.com) AND (${DESIGN_TITLES})`) },
    ],
  },

  // ── Tap 3: Signals & intelligence (7 rules) ─────────────────────────────────
  {
    name: 'Job Tracker Signals',
    envKey: 'FIREHOSE_TAP_TOKEN_3',
    rules: [
      { tag: 'hacker-news',    value: buildDomainRule(`domain:news.ycombinator.com AND (${DESIGN_TITLES}) AND ("hiring" OR "looking for" OR "seeking" OR "open to" OR "remote ok")`, false) },
      { tag: 'twitter-x',      value: buildDomainRule(`(domain:twitter.com OR domain:x.com) AND (${DESIGN_TITLES}) AND ("we're hiring" OR "we are hiring" OR "open role" OR "DM me" OR "apply" OR "now hiring" OR "join us")`, false) },
      { tag: 'wellfound',      value: buildDomainRule(`domain:wellfound.com AND (${DESIGN_TITLES})`) },
      { tag: 'vc-jobs',        value: buildDomainRule(`(domain:workatastartup.com OR domain:ycombinator.com OR domain:jobs.a16z.com OR domain:jobs.sequoiacap.com OR domain:greylock.com) AND (${DESIGN_TITLES})`, false) },
      { tag: 'producthunt',    value: buildDomainRule(`domain:producthunt.com AND (${DESIGN_TITLES}) AND ("hiring" OR "we're hiring" OR "join" OR "open role")`, false) },
      { tag: 'reddit-jobs',    value: `domain:reddit.com AND (url:*\\/r\\/forhire\\/* OR url:*\\/r\\/UXDesign\\/* OR url:*\\/r\\/design\\/* OR url:*\\/r\\/userexperience\\/*) AND (${DESIGN_TITLES}) AND ("hiring" OR "[hiring]" OR "job" OR "looking for" OR "open position") AND language:"en"` },
      { tag: 'company-careers', value: buildRule(`url:*\\/careers\\/* AND (${DESIGN_TITLES}) AND ("apply" OR "job description" OR "responsibilities" OR "qualifications")`) },
    ],
  },
  // ── Tap 4: Extended ATS + job boards (account 2) ────────────────────────────
  {
    name: 'Job Tracker Extended',
    envKey: 'FIREHOSE_TAP_TOKEN_4',
    rules: [
      { tag: 'ziprecruiter',    value: buildDomainRule(`domain:ziprecruiter.com AND url:*\\/jobs\\/* AND (${DESIGN_TITLES})`) },
      { tag: 'simplyhired',     value: buildDomainRule(`domain:simplyhired.com AND (${DESIGN_TITLES})`) },
      { tag: 'jobvite',         value: buildDomainRule(`domain:jobs.jobvite.com AND (${DESIGN_TITLES})`) },
      { tag: 'smartrecruiters', value: buildDomainRule(`domain:jobs.smartrecruiters.com AND (${DESIGN_TITLES})`) },
      { tag: 'workday-jobs',    value: buildDomainRule(`domain:myworkdayjobs.com AND (${DESIGN_TITLES})`) },
      { tag: 'icims',           value: buildDomainRule(`domain:icims.com AND (${DESIGN_TITLES})`) },
      { tag: 'taleo',           value: buildDomainRule(`domain:taleo.net AND (${DESIGN_TITLES})`) },
      { tag: 'bamboohr-jobs',   value: buildDomainRule(`domain:bamboohr.com AND url:*\\/jobs\\/* AND (${DESIGN_TITLES})`) },
      { tag: 'techjobs',        value: buildDomainRule(`(domain:techjobs.com OR domain:cybercoders.com OR domain:hired.com) AND (${DESIGN_TITLES})`) },
      // Direct career pages: Tier 1 B2B companies on custom ATS platforms
      {
        tag: 'tier1-careers-direct',
        value: buildDomainRule(
          `(domain:careers.salesforce.com OR domain:openai.com OR domain:stripe.com OR ` +
          `domain:careers.atlassian.com OR domain:careers.servicenow.com OR domain:careers.adobe.com OR ` +
          `domain:careers.zoom.us OR domain:jobs.cisco.com OR domain:careers.datadoghq.com OR ` +
          `domain:careers.snowflake.com OR domain:jobs.lever.co OR domain:careers.twilio.com OR ` +
          `domain:jobs.intuit.com OR domain:jobs.sap.com OR domain:careers.oracle.com) AND (${DESIGN_TITLES})`
        ),
      },
      // Direct career pages: Tier 2 + select Tier 3 companies
      {
        tag: 'tier2-careers-direct',
        value: buildDomainRule(
          `(domain:canva.com OR domain:miro.com OR domain:jobs.ashbyhq.com OR ` +
          `domain:writer.com OR domain:cohere.com OR domain:gusto.com OR domain:rippling.com OR ` +
          `domain:lattice.com OR domain:careers.toasttab.com OR domain:procore.com OR domain:samsara.com OR ` +
          `domain:careers.doordash.com OR domain:careers.robinhood.com OR domain:careers.coinbase.com OR ` +
          `domain:careers.airbnb.com OR domain:careers.databricks.com) AND (${DESIGN_TITLES})`
        ),
      },
      // Handshake — new grad / entry-level focus
      { tag: 'handshake', value: buildDomainRule(`domain:joinhandshake.com AND (${DESIGN_TITLES})`) },
    ],
  },

  // ── Tap 5: Niche sources + communities (account 2) ──────────────────────────
  {
    name: 'Job Tracker Niche',
    envKey: 'FIREHOSE_TAP_TOKEN_5',
    rules: [
      { tag: 'substack-jobs',      value: buildDomainRule(`domain:substack.com AND (${DESIGN_TITLES}) AND ("job" OR "role" OR "opening" OR "hiring" OR "opportunity")`, false) },
      { tag: 'tech-news-hiring',   value: buildDomainRule(`(domain:techcrunch.com OR domain:venturebeat.com OR domain:theverge.com OR domain:wired.com OR domain:forbes.com) AND ("product designer" OR "design team" OR "UX designer") AND ("hiring" OR "open roles" OR "growing the team")`, false) },
      { tag: 'design-communities', value: buildDomainRule(`(domain:uxdesign.cc OR domain:nngroup.com OR domain:smashingmagazine.com OR domain:medium.com) AND (${DESIGN_TITLES}) AND ("hiring" OR "job" OR "open role" OR "we're looking for")`, false) },
      { tag: 'angel-co',           value: buildDomainRule(`domain:angel.co AND (${DESIGN_TITLES})`) },
      { tag: 'arc-dev',            value: buildDomainRule(`domain:arc.dev AND (${DESIGN_TITLES})`) },
      { tag: 'jobs-lever-all',     value: buildDomainRule(`domain:jobs.lever.co AND (${DESIGN_TITLES})`) },
      { tag: 'ashby-all',          value: buildDomainRule(`domain:jobs.ashbyhq.com AND (${DESIGN_TITLES})`) },
      { tag: 'rippling-ats',       value: buildDomainRule(`domain:ats.rippling.com AND (${DESIGN_TITLES})`) },
      { tag: 'workable-all',       value: buildDomainRule(`domain:apply.workable.com AND (${DESIGN_TITLES})`) },
      { tag: 'toptal-jobs',        value: buildDomainRule(`domain:toptal.com AND (${DESIGN_TITLES})`) },
      // Welcome to the Jungle / Otta — strong US tech & startup coverage
      { tag: 'otta-jungle',        value: buildDomainRule(`(domain:welcometothejungle.com OR domain:otta.com) AND (${DESIGN_TITLES})`) },
      // Simplify + Cord — modern job aggregators
      { tag: 'simplify-cord',      value: buildDomainRule(`(domain:simplify.jobs OR domain:cord.com) AND (${DESIGN_TITLES})`) },
      // Behance Jobs + UX Jobs Board — design-specific boards
      { tag: 'behance-ux',         value: buildDomainRule(`(domain:behance.net OR domain:uxjobsboard.com OR domain:uxdesignjobs.net OR domain:designerjobs.co) AND (${DESIGN_TITLES})`) },
    ],
  },

  // ── Tap 6: Big Tech & Fortune 500 direct (account 3) ───────────────────────
  {
    name: 'Job Tracker BigTech',
    envKey: 'FIREHOSE_TAP_TOKEN_6',
    rules: [
      { tag: 'amazon-direct',    value: buildDomainRule(`domain:amazon.jobs AND (${DESIGN_TITLES})`) },
      { tag: 'google-direct',    value: buildDomainRule(`(domain:careers.google.com OR domain:careers.googleplex.com) AND (${DESIGN_TITLES})`) },
      { tag: 'meta-direct',      value: buildDomainRule(`domain:metacareers.com AND (${DESIGN_TITLES})`) },
      { tag: 'apple-direct',     value: buildDomainRule(`domain:jobs.apple.com AND (${DESIGN_TITLES})`) },
      { tag: 'microsoft-direct', value: buildDomainRule(`domain:careers.microsoft.com AND (${DESIGN_TITLES})`) },
      { tag: 'linkedin-direct',  value: buildDomainRule(`domain:careers.linkedin.com AND (${DESIGN_TITLES})`) },
      // Chip / hardware companies
      { tag: 'chip-hardware',    value: buildDomainRule(`(domain:nvidia.com OR domain:amd.com OR domain:qualcomm.com OR domain:broadcom.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Media + social platforms
      { tag: 'media-social-direct', value: buildDomainRule(`(domain:jobs.netflix.com OR domain:lifeatspotify.com OR domain:snap.com OR domain:discord.com OR domain:duolingo.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Large fintech + banking (direct custom career portals)
      { tag: 'bigbank-direct',   value: buildDomainRule(`(domain:capitalonecareers.com OR domain:careers.jpmorgan.com OR domain:higher.gs.com OR domain:morganstanley.com OR domain:americanexpress.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // B2B SaaS companies with custom career pages not captured by ATS rules
      { tag: 'b2b-custom-careers', value: buildDomainRule(`(domain:hubspot.com OR domain:airtable.com OR domain:asana.com OR domain:monday.com OR domain:amplitude.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Mobility / automotive / autonomous
      { tag: 'mobility-direct',  value: buildDomainRule(`(domain:tesla.com OR domain:waymo.com OR domain:uber.com OR domain:rivian.com OR domain:cruise.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Consulting & design consultancies
      { tag: 'consulting-design', value: buildDomainRule(`(domain:deloitte.com OR domain:thoughtworks.com OR domain:accenture.com OR domain:ideo.com OR domain:frog.co) AND url:*career* AND (${DESIGN_TITLES})`) },
    ],
  },

  // ── Tap 7: More direct + niche (account 3) ──────────────────────────────────
  {
    name: 'Job Tracker Niche2',
    envKey: 'FIREHOSE_TAP_TOKEN_7',
    rules: [
      // AI labs not covered by Greenhouse ATS rule
      { tag: 'ai-labs-direct',   value: buildDomainRule(`(domain:scale.com OR domain:cohere.com OR domain:mistral.ai OR domain:perplexity.ai OR domain:huggingface.co) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Dev tools & infrastructure
      { tag: 'devtools-direct',  value: buildDomainRule(`(domain:github.com OR domain:vercel.com OR domain:hashicorp.com OR domain:getdbt.com OR domain:retool.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Data platforms
      { tag: 'data-platform-direct', value: buildDomainRule(`(domain:databricks.com OR domain:snowflake.com OR domain:fivetran.com OR domain:airbyte.com OR domain:dbt.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Collaboration + creative tools (direct pages as complement to ATS)
      { tag: 'collab-creative-direct', value: buildDomainRule(`(domain:miro.com OR domain:canva.com OR domain:figma.com OR domain:coda.io OR domain:loom.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // HR / payroll / people ops
      { tag: 'hris-payroll-direct', value: buildDomainRule(`(domain:gusto.com OR domain:rippling.com OR domain:deel.com OR domain:lattice.com OR domain:greenhouse.io) AND url:*career* AND (${DESIGN_TITLES})`) },
      // E-commerce & marketplace
      { tag: 'ecom-direct',      value: buildDomainRule(`(domain:shopify.com OR domain:ebay.com OR domain:wayfair.com OR domain:etsy.com OR domain:instacart.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Health tech & life sciences
      { tag: 'healthtech-direct', value: buildDomainRule(`(domain:epic.com OR domain:athenahealth.com OR domain:veeva.com OR domain:teladoc.com OR domain:doximity.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Security / cloud infrastructure
      { tag: 'cloud-security-direct', value: buildDomainRule(`(domain:paloaltonetworks.com OR domain:crowdstrike.com OR domain:zscaler.com OR domain:cloudflare.com OR domain:sentinelone.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Fintech startups
      { tag: 'fintech-startup-direct', value: buildDomainRule(`(domain:plaid.com OR domain:robinhood.com OR domain:coinbase.com OR domain:chime.com OR domain:affirm.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Gaming + entertainment + creative
      { tag: 'gaming-entertain-direct', value: buildDomainRule(`(domain:roblox.com OR domain:unity.com OR domain:ea.com OR domain:epicgames.com OR domain:activision.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Enterprise legacy + workflow
      { tag: 'enterprise-legacy-direct', value: buildDomainRule(`(domain:servicenow.com OR domain:zendesk.com OR domain:freshworks.com OR domain:sap.com OR domain:salesforce.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Property tech + real estate
      { tag: 'proptech-retail-direct', value: buildDomainRule(`(domain:opendoor.com OR domain:realpage.com OR domain:appfolio.com OR domain:walmart.com OR domain:target.com) AND url:*career* AND (${DESIGN_TITLES})`) },
      // Research + user insights platforms
      { tag: 'research-platform-direct', value: buildDomainRule(`(domain:dovetail.com OR domain:userinterviews.com OR domain:usertesting.com OR domain:qualtrics.com OR domain:fullstory.com) AND url:*career* AND (${DESIGN_TITLES})`) },
    ],
  },

]

// ─── HTTPS helper ─────────────────────────────────────────────────────────────

function httpsRequest(path: string, method = 'GET', body?: string, token?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const authToken = token ?? process.env.FIREHOSE_TAP_TOKEN
    if (!authToken) return reject(new Error('No Firehose token available'))

    const options: https.RequestOptions = {
      hostname: 'api.firehose.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Firehose API ${path} → ${res.statusCode}: ${data}`))
        } else {
          resolve(data)
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function apiFetch(path: string, init?: { method?: string; body?: string; token?: string }) {
  return httpsRequest(path, init?.method ?? 'GET', init?.body, init?.token)
    .then(raw => ({ json: () => JSON.parse(raw) }))
}

// ─── Rule sync (per tap token) ────────────────────────────────────────────────

async function syncRulesForTap(token: string, rules: FirehoseRule[], tapName: string): Promise<void> {
  const res = await apiFetch('/v1/rules', { token })
  const { data: existing } = res.json() as { data: Array<{ id: string; tag: string; value: string }> }
  const existingByTag = new Map(existing.map(r => [r.tag, r]))
  const desiredTags = new Set(rules.map(r => r.tag))

  // Delete orphaned rules first (frees slots before creating new ones)
  let deleted = 0
  for (const [tag, ex] of existingByTag) {
    if (!desiredTags.has(tag)) {
      await apiFetch(`/v1/rules/${ex.id}`, { method: 'DELETE', token })
      console.log(`    - Deleted orphaned rule: ${tag}`)
      deleted++
    }
  }

  let created = 0, updated = 0

  for (const rule of rules) {
    const ex = existingByTag.get(rule.tag)
    if (!ex) {
      await apiFetch('/v1/rules', { method: 'POST', body: JSON.stringify({ value: rule.value, tag: rule.tag }), token })
      console.log(`    + Created rule: ${rule.tag}`)
      created++
    } else if (ex.value !== rule.value) {
      await apiFetch(`/v1/rules/${ex.id}`, { method: 'PUT', body: JSON.stringify({ value: rule.value }), token })
      console.log(`    ↺ Updated rule: ${rule.tag}`)
      updated++
    } else {
      console.log(`    ✓ Rule up to date: ${rule.tag}`)
    }
  }

  console.log(`  [${tapName}] ${deleted} deleted, ${created} created, ${updated} updated, ${rules.length - created - updated} unchanged`)
}

// ─── Tap sync ─────────────────────────────────────────────────────────────────

export interface TapInfo {
  name: string
  token: string
  envKey: string
}

/**
 * Syncs all taps: creates missing taps via management key, upserts rules per tap.
 * Returns { name, token } for every tap so the listener can open SSE streams.
 */
// Map tap name → which management key account to use
const TAP_ACCOUNT_MAP: Record<string, 1 | 2 | 3> = {
  'Job Tracker':          1,
  'Job Tracker Platforms': 1,
  'Job Tracker Signals':  1,
  'Job Tracker Extended': 2,
  'Job Tracker Niche':    2,
  'Job Tracker BigTech':  3,
  'Job Tracker Niche2':   3,
}

export async function syncAllTaps(): Promise<TapInfo[]> {
  const mgmtKey1 = process.env.FIREHOSE_MANAGEMENT_KEY
  const mgmtKey2 = process.env.FIREHOSE_MANAGEMENT_KEY_2
  const mgmtKey3 = process.env.FIREHOSE_MANAGEMENT_KEY_3
  if (!mgmtKey1) throw new Error('FIREHOSE_MANAGEMENT_KEY is not set')

  const mgmtKeys = [mgmtKey1, mgmtKey2, mgmtKey3]

  // Fetch existing taps from all accounts in parallel
  const tapResults = await Promise.all(
    mgmtKeys.map(key =>
      key ? apiFetch('/v1/taps', { token: key }).then(r => r.json().data as Array<{ id: string; name: string; token: string }>)
          : Promise.resolve([])
    )
  )
  const tapByName = new Map(tapResults.flat().map(t => [t.name, t]))

  const result: TapInfo[] = []

  for (const config of TAP_CONFIGS) {
    const accountNum = TAP_ACCOUNT_MAP[config.name] ?? 1
    const mgmtKey = mgmtKeys[accountNum - 1]
    if (!mgmtKey) {
      console.log(`  ⚠ Skipping "${config.name}" — FIREHOSE_MANAGEMENT_KEY_${accountNum} not set`)
      continue
    }

    let token: string
    const existing = tapByName.get(config.name)

    if (existing) {
      token = existing.token
      console.log(`  ✓ Tap exists: "${config.name}" (${config.rules.length} rules)`)
    } else {
      console.log(`  + Creating tap: "${config.name}"...`)
      const createRes = await apiFetch('/v1/taps', {
        method: 'POST',
        body: JSON.stringify({ name: config.name }),
        token: mgmtKey,
      })
      token = createRes.json().token
      console.log(`  ✓ Created tap: "${config.name}"`)
    }

    await syncRulesForTap(token, config.rules, config.name)
    result.push({ name: config.name, token, envKey: config.envKey })
  }

  const totalRules = TAP_CONFIGS.reduce((s, c) => s + c.rules.length, 0)
  console.log(`\nSynced ${result.length} taps, ${totalRules} total rules across 3 accounts`)
  return result
}

// ─── Legacy export (single-tap backward compat) ──────────────────────────────

export async function syncRules(): Promise<void> {
  const token = process.env.FIREHOSE_TAP_TOKEN
  if (!token) throw new Error('FIREHOSE_TAP_TOKEN not set')
  const tap1Rules = TAP_CONFIGS[0].rules
  await syncRulesForTap(token, tap1Rules, TAP_CONFIGS[0].name)
}
