// Keyword taxonomy — comprehensive ATS-style extraction
// Each group has a weight and a list of terms (case-insensitive matching)

export interface KeywordGroup {
  name: string
  weight: number
  terms: string[]
}

export const KEYWORD_GROUPS: KeywordGroup[] = [
  {
    name: 'b2b_domain',
    weight: 5,
    terms: [
      // Industry & business model
      'B2B', 'B2C', 'B2B2C', 'enterprise', 'SaaS', 'marketplace',
      'ecommerce', 'e-commerce', 'fintech', 'healthtech', 'healthcare', 'edtech',
      'media', 'editorial', 'content-driven', 'digital ecosystem',
      'startup', 'early-stage startup', 'high-growth',
      // Product domains
      'developer tools', 'internal tools', 'admin tools', 'CRM', 'CMS',
      'dashboard', 'dashboards', 'data visualization', 'reporting', 'analytics',
      'workflow automation', 'workflows', 'complex workflows',
      'collaboration tools', 'productivity tools',
      'platform ecosystem', 'platform', 'multi-product platform', 'multi-product', 'complex systems',
      'API', 'HR technology', 'talent platform',
      'agreement management', 'contract management',
      'customer platform', 'go-to-market', 'GTM', 'contact center',
      'financial services', 'fraud', 'risk',
      'logistics', 'B2B SaaS', 'B2B logistics SaaS', 'B2B credit card platform',
      'scalable solutions', 'data-dense interfaces',
      // Product types
      'mobile app', 'mobile apps', 'web application', 'web platform',
      'native app', 'progressive web app',
      'iOS', 'Android', 'omnichannel',
      // Business context
      'onboarding', 'user onboarding', 'engagement', 'retention',
      'growth', 'conversion', 'revenue', 'business impact',
    ],
  },
  {
    name: 'ai_emerging',
    weight: 4,
    terms: [
      'AI-powered', 'AI-first', 'AI-native', 'agentic AI', 'agentic', 'AI agents',
      'conversational UI', 'conversational interfaces', 'conversational design',
      'chatbot', 'AI chatbot',
      'voice', 'voice UI', 'voice/speech AI', 'LLM', 'multimodal LLM',
      'generative AI', 'gen AI',
      'AI-assisted design', 'AI-assisted', 'AI-assisted design workflows',
      'AI fluency', 'AI tools', 'AI assistant',
      'machine learning',
      'probabilistic systems', 'AI concierge', 'digital twin',
      'RAG', 'retrieval-augmented generation',
      'human-in-the-loop', 'AI design patterns', 'MCP', 'figma MCP',
      'prompt engineering', 'prompt-driven workflows', 'natural language',
      'personalization', 'recommendation',
      'multi-agent orchestration', 'copilot', 'AI-powered product design',
      'Claude', 'Claude Code', 'vibe coding',
      'agentic design workflows', 'hybrid AI design workflows',
      'emerging AI capabilities', 'physical AI', 'real-time systems',
    ],
  },
  {
    name: 'core_design',
    weight: 3,
    terms: [
      // Role titles & disciplines
      'product designer', 'product design', 'UX designer', 'UX design',
      'UI design', 'UI designer', 'interaction design', 'visual design',
      'service design', 'content design', 'UX writing', 'UX copy',
      'motion design', 'motion graphics', 'brand design',
      // Core skills
      'user experience', 'user interface', 'UX principles', 'UX',
      'end-to-end design', 'user-centered', 'human-centered',
      'user flows', 'wireframes', 'wireframing', 'prototyping', 'prototype', 'prototypes',
      'high-fidelity', 'high-fidelity prototyping', 'high-fidelity prototypes',
      'low-fidelity', 'mockups',
      'pixel-perfect delivery', '0-to-1 product design', 'end-to-end design',
      'production-ready prototypes',
      'information architecture', 'IA', 'HCI', 'human-computer interaction',
      'pain points', 'user pain points', 'trust', 'end-to-end experiences',
      'web and mobile', 'mobile', 'mobile first',
      'responsive design', 'responsive', 'cross-platform', 'multi-platform',
      'pixel-perfect', 'pixel-level UI craft', 'attention to detail', 'detail-oriented',
      // Systems & components
      'design system', 'design systems', 'enterprise design system',
      'component library', 'component libraries', 'pattern library',
      'design language', 'visual language', 'style guide',
      'design tokens', 'atomic design',
      'component-based', 'scalable design', 'design patterns',
      // Accessibility
      'accessibility', 'accessible design', 'WCAG', 'a11y', 'ADA compliance',
      'inclusive design', 'universal design',
      // Specialized
      'typography', 'color theory', 'iconography', 'illustration',
      'microinteractions', 'micro-interactions',
      'empty state', 'edge cases', 'error state',
      'mobile design', 'dark mode', 'localization', 'internationalization',
      'progressive disclosure', 'visual hierarchy',
      // Strategy & vision
      'design strategy', 'product vision', 'design vision', 'design judgment',
      // Quality
      'craft', 'high-craft', 'polish', 'intuitive', 'seamless', 'delightful',
      'usability',
    ],
  },
  {
    name: 'methods',
    weight: 2,
    terms: [
      // Research methods
      'user research', 'usability testing', 'user testing',
      'user interviews', 'stakeholder interviews',
      'A/B testing', 'multivariate testing', 'experimentation',
      'heuristic evaluation', 'competitive analysis', 'competitive audit',
      'card sorting', 'tree testing', 'task analysis',
      'journey mapping', 'journey maps', 'customer journey', 'experience mapping',
      'persona', 'personas', 'empathy mapping',
      'generative research', 'evaluative research', 'lightweight user research',
      'contextual inquiry', 'survey', 'diary studies',
      'moderated testing', 'unmoderated testing', 'remote testing',
      'quantitative research', 'qualitative research',
      'heatmap', 'click tracking', 'behavioral analytics',
      // Design methods
      'design thinking', 'user-centered design', 'human-centered design',
      'lean UX', 'design sprint', 'double diamond',
      'jobs to be done', 'JTBD', 'hypothesis-driven',
      'rapid prototyping', 'rapid iteration',
      'iterative', 'iteration', 'continuous iteration',
      'test-and-learn', 'continuous discovery', 'product discovery',
      'storyboards', 'storyboarding', 'co-design', 'participatory design',
      // Process
      'Agile', 'Scrum', 'Kanban', 'sprint', 'sprint planning',
      'OKRs', 'KPIs', 'north star metric',
      'MVP', 'minimum viable product',
      'design critique', 'design critiques', 'design review', 'design reviews',
      'design decisions', 'design rationale', 'trade-offs',
      'product roadmap', 'roadmap', 'documentation', 'design documentation',
      'design handoff', 'developer handoff', 'design QA',
      'development-ready specifications',
      'DesignOps', 'ResearchOps',
      // Metrics
      'data-driven', 'data-driven design', 'data-informed', 'data-informed iteration', 'metrics-driven', 'metrics-driven insights',
      'funnel analysis', 'conversion optimization', 'conversion rate',
      'NPS', 'CSAT', 'task success rate',
      'scalable design patterns', '0-to-1', 'zero to one',
    ],
  },
  {
    name: 'soft_skills',
    weight: 2,
    terms: [
      // Collaboration
      'cross-functional collaboration', 'cross-functional',
      'collaboration', 'partner closely', 'work closely',
      'stakeholder management', 'stakeholder communication', 'stakeholder alignment',
      'influencing without authority',
      // Communication
      'storytelling', 'presentation skills', 'communication skills',
      'design rationale', 'communicate reasoning',
      'workshop facilitation', 'facilitation',
      'remote collaboration',
      // Leadership
      'mentorship', 'coaching', 'design leadership', 'design culture',
      'thought leadership', 'presenting to executives', 'leading cross-functional team',
      // Mindset
      'navigate ambiguity', 'ambiguity', 'complex problems',
      'problem solving', 'creative problem solving', 'critical thinking',
      'strategic product thinking', 'strategic thinking', 'strategic',
      'systems thinking',
      'growth mindset', 'continuous learning', 'curiosity', 'curious',
      'proactive', 'self-starter', 'self-directed', 'autonomous',
      'adaptability', 'flexibility', 'resilience',
      'fast-paced', 'fast-paced environment', 'ownership', 'ownership mindset',
      'high-ownership', 'velocity', 'high-visibility',
      // Work arrangement & culture
      'remote-first', 'remote work', 'hybrid', 'in-office', 'on-site',
      // Written / oral
      'written communication', 'oral communication',
      // Experience requirements (verbatim phrases LLM returns)
      '2+ years', '3+ years', '4+ years', '5+ years', '6+ years', '7+ years',
      '8+ years', '10+ years',
      // Outcomes
      'business goals', 'business outcomes', 'user needs',
      'balance user needs', 'user advocacy',
      'feedback', 'design feedback', 'seek feedback',
      'portfolio', 'strong portfolio', 'case studies', 'craft',
    ],
  },
  {
    name: 'tools',
    weight: 1,
    terms: [
      // Design tools
      'Figma', 'FigJam', 'Sketch', 'Adobe XD', 'Adobe Creative Cloud',
      'Adobe Photoshop', 'Adobe Illustrator', 'Adobe After Effects',
      'Framer', 'Principle', 'ProtoPie', 'InVision', 'Axure',
      'Balsamiq', 'Zeplin', 'Storybook', 'Webflow',
      // Research & analytics tools
      'Maze', 'UserTesting', 'Hotjar', 'FullStory', 'Amplitude',
      'Mixpanel', 'Google Analytics', 'web analytics', 'Heap',
      'Dovetail', 'Lookback', 'Optimal Workshop', 'Sprig',
      'Pendo', 'LogRocket', 'Qualtrics',
      // Collaboration tools
      'Miro', 'Mural', 'Notion', 'Confluence', 'Airtable',
      'Jira', 'Asana', 'Trello', 'Linear', 'Slack',
      // Code & technical
      'HTML', 'CSS', 'HTML/CSS', 'JavaScript', 'TypeScript',
      'React', 'Svelte', 'Swift', 'SwiftUI',
      'Git', 'GitHub', 'VS Code', 'Cursor', 'Claude Code', 'Vercel',
      'frontend development', 'front-end architecture', 'design-to-code',
      'web technologies', 'web UI fundamentals',
      // Figma product line
      'Figma Make', 'Figma MCP',
      // Platforms & systems
      'Phenom', 'Workday', 'ServiceNow', 'Salesforce',
    ],
  },
]

// Flat list of all terms for quick lookup
export const ALL_TERMS = KEYWORD_GROUPS.flatMap((g) => g.terms)

// ─── Dynamic config (overridable at runtime) ─────────────────────────────────

let activeGroups: KeywordGroup[] = KEYWORD_GROUPS

export function getKeywordGroups(): KeywordGroup[] {
  return activeGroups
}

export function setKeywordGroups(groups: KeywordGroup[]): void {
  activeGroups = groups
}

export function getActiveTerms(): string[] {
  return activeGroups.flatMap((g) => g.terms)
}

export function resetKeywordGroups(): void {
  activeGroups = KEYWORD_GROUPS
}

export { KEYWORD_GROUPS as DEFAULT_KEYWORD_GROUPS }
