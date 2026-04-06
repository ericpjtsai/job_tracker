// VENDORED from packages/scoring/src/keywords.ts — keep in sync.
// Edge Functions cannot import workspace packages, so the scoring logic is copied here.

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
      'B2B', 'B2C', 'B2B2C', 'enterprise', 'SaaS', 'marketplace',
      'ecommerce', 'e-commerce', 'fintech', 'healthtech', 'edtech',
      'media', 'editorial', 'content-driven', 'digital ecosystem',
      'developer tools', 'internal tools', 'admin tools', 'CRM', 'CMS',
      'dashboard', 'data visualization', 'reporting', 'analytics',
      'workflow automation', 'collaboration tools', 'productivity tools',
      'platform ecosystem', 'platform', 'multi-product platform', 'multi-product', 'complex systems',
      'API', 'HR technology', 'talent platform',
      'agreement management', 'contract management',
      'customer platform', 'go-to-market', 'GTM', 'contact center',
      'financial services', 'fraud', 'risk',
      'logistics', 'B2B SaaS', 'B2B logistics SaaS', 'B2B credit card platform',
      'scalable solutions',
      'mobile app', 'web application', 'native app', 'progressive web app',
      'iOS', 'Android', 'omnichannel',
      'onboarding', 'user onboarding', 'engagement', 'retention',
      'growth', 'conversion', 'revenue', 'business impact',
    ],
  },
  {
    name: 'ai_emerging',
    weight: 4,
    terms: [
      'AI-powered', 'AI-first', 'agentic AI', 'agentic', 'AI agents',
      'conversational UI', 'conversational design', 'chatbot', 'AI chatbot',
      'voice', 'voice UI', 'LLM', 'generative AI', 'gen AI',
      'AI-assisted design', 'AI-assisted', 'machine learning',
      'probabilistic systems', 'AI concierge', 'digital twin',
      'RAG', 'retrieval-augmented generation',
      'human-in-the-loop', 'AI design patterns', 'MCP',
      'prompt engineering', 'natural language',
      'personalization', 'recommendation',
      'multi-agent orchestration', 'copilot', 'AI-powered product design',
    ],
  },
  {
    name: 'core_design',
    weight: 3,
    terms: [
      'product designer', 'product design', 'UX designer', 'UX design',
      'UI design', 'UI designer', 'interaction design', 'visual design',
      'service design', 'content design', 'UX writing', 'UX copy',
      'motion design', 'motion graphics', 'brand design',
      'user experience', 'user interface', 'UX principles', 'UX',
      'end-to-end design', 'user-centered', 'human-centered',
      'user flows', 'wireframes', 'wireframing', 'prototyping', 'prototype',
      'high-fidelity', 'high-fidelity prototyping', 'low-fidelity', 'mockups',
      'pixel-perfect delivery', '0-to-1 product design', 'end-to-end design',
      'production-ready prototypes',
      'information architecture', 'IA',
      'responsive design', 'responsive', 'cross-platform', 'multi-platform',
      'pixel-perfect', 'attention to detail', 'detail-oriented',
      'design system', 'design systems', 'enterprise design system',
      'component library', 'pattern library',
      'design language', 'style guide', 'design tokens', 'atomic design',
      'component-based', 'scalable design', 'design patterns',
      'accessibility', 'accessible design', 'WCAG', 'a11y', 'ADA compliance',
      'inclusive design', 'universal design',
      'typography', 'color theory', 'iconography', 'illustration',
      'microinteractions', 'empty state', 'edge cases', 'error state',
      'mobile design', 'dark mode', 'localization', 'internationalization',
      'progressive disclosure',
      'craft', 'polish', 'intuitive', 'seamless', 'delightful',
    ],
  },
  {
    name: 'methods',
    weight: 2,
    terms: [
      'user research', 'usability testing', 'user testing',
      'user interviews', 'stakeholder interviews',
      'A/B testing', 'multivariate testing', 'experimentation',
      'heuristic evaluation', 'competitive analysis', 'competitive audit',
      'card sorting', 'tree testing', 'task analysis',
      'journey mapping', 'customer journey', 'experience mapping',
      'persona', 'personas', 'empathy mapping',
      'contextual inquiry', 'survey', 'diary studies',
      'moderated testing', 'unmoderated testing', 'remote testing',
      'quantitative research', 'qualitative research',
      'heatmap', 'click tracking', 'behavioral analytics',
      'design thinking', 'user-centered design', 'human-centered design',
      'lean UX', 'design sprint', 'double diamond',
      'jobs to be done', 'JTBD', 'hypothesis-driven',
      'rapid prototyping', 'rapid iteration',
      'iterative', 'iteration', 'continuous iteration',
      'test-and-learn', 'continuous discovery', 'product discovery',
      'storyboards', 'storyboarding', 'co-design', 'participatory design',
      'Agile', 'Scrum', 'Kanban', 'sprint', 'sprint planning',
      'OKRs', 'KPIs', 'north star metric',
      'MVP', 'minimum viable product',
      'design critique', 'design review', 'design decisions', 'design rationale',
      'design handoff', 'developer handoff', 'design QA',
      'development-ready specifications',
      'DesignOps', 'ResearchOps',
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
      'cross-functional collaboration', 'cross-functional',
      'collaboration', 'partner closely', 'work closely',
      'stakeholder management', 'stakeholder communication', 'stakeholder alignment',
      'influencing without authority',
      'storytelling', 'presentation skills', 'communication skills',
      'design rationale', 'communicate reasoning',
      'workshop facilitation', 'facilitation',
      'remote collaboration',
      'mentorship', 'coaching', 'design leadership', 'design culture',
      'thought leadership', 'presenting to executives', 'leading cross-functional team',
      'navigate ambiguity', 'ambiguity', 'complex problems',
      'problem solving', 'creative problem solving', 'critical thinking',
      'strategic product thinking', 'strategic thinking', 'strategic',
      'systems thinking',
      'growth mindset', 'continuous learning', 'curiosity', 'curious',
      'proactive', 'self-starter', 'self-directed', 'autonomous',
      'adaptability', 'flexibility', 'resilience',
      'fast-paced', 'fast-paced environment',
      'business goals', 'business outcomes', 'user needs',
      'balance user needs', 'user advocacy',
      'feedback', 'design feedback', 'seek feedback',
      'portfolio', 'craft',
    ],
  },
  {
    name: 'tools',
    weight: 1,
    terms: [
      'Figma', 'FigJam', 'Sketch', 'Adobe XD', 'Adobe Creative Cloud',
      'Adobe Photoshop', 'Adobe Illustrator', 'Adobe After Effects',
      'Framer', 'Principle', 'ProtoPie', 'InVision', 'Axure',
      'Balsamiq', 'Zeplin', 'Storybook', 'Webflow',
      'Maze', 'UserTesting', 'Hotjar', 'FullStory', 'Amplitude',
      'Mixpanel', 'Google Analytics', 'web analytics', 'Heap',
      'Dovetail', 'Lookback', 'Optimal Workshop', 'Sprig',
      'Pendo', 'LogRocket', 'Qualtrics',
      'Miro', 'Mural', 'Notion', 'Confluence', 'Airtable',
      'Jira', 'Asana', 'Trello', 'Linear', 'Slack',
      'HTML', 'CSS', 'JavaScript', 'React', 'Swift', 'SwiftUI',
      'Git', 'GitHub', 'VS Code', 'Cursor', 'Claude Code', 'Vercel',
      'frontend development', 'design-to-code',
      'Phenom', 'Workday', 'ServiceNow', 'Salesforce',
    ],
  },
]

export const ALL_TERMS = KEYWORD_GROUPS.flatMap((g) => g.terms)

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
