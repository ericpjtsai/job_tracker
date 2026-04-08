import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const geminiKey = process.env.GEMINI_API_KEY!

const supabase = createClient(url, key)
const gemini = new GoogleGenerativeAI(geminiKey)

async function main() {
  // Get resume text
  const { data: resume } = await supabase.from('resume_versions').select('storage_path').eq('is_active', true).eq('resume_type', 'ats').single()
  if (!resume?.storage_path) { console.log('No active ATS resume'); return }
  const { data: file } = await supabase.storage.from('resumes').download(resume.storage_path)
  const buffer = Buffer.from(await file!.arrayBuffer())
  const pdfParse = (await import('pdf-parse')).default
  const resumeText = (await pdfParse(buffer)).text
  console.log('Resume text length:', resumeText.length)

  // Get current groups
  const { data: config } = await supabase.from('scoring_config').select('value').eq('key', 'keyword_groups').single()
  const groups = config!.value as any[]
  const allTerms = new Set(groups.flatMap((g: any) => g.terms.map((t: string) => t.toLowerCase())))
  console.log('Existing terms:', allTerms.size)

  const groupSummary = groups.map((g: any) => `${g.name}: ${g.terms.join(', ')}`).join('\n\n')

  const model = gemini.getGenerativeModel({ model: 'gemini-2.5-flash' })
  console.log('Calling Gemini 2.5 Pro...')

  const result = await model.generateContent(`Here is a Product Designer's resume:

${resumeText}

Current scoring keyword groups used to match job descriptions:

${groupSummary}

Analyze the resume carefully. Suggest NEW keywords to ADD to the existing groups. Focus on:
1. Specific skills, tools, domain expertise mentioned in the resume but missing from groups
2. Variations and synonyms that job postings commonly use for the candidate's skills
3. Industry-specific terms from their work history (Salesforce, Google, Carrefour, retail, etc.)
4. Emerging technologies and methodologies the candidate has experience with

Rules:
- Only suggest terms genuinely missing (not already in any group)
- Keep terms concise (1-3 words each)
- Suggest at least 5 per relevant group
- Don't suggest overly generic terms

Output JSON only:
{"additions": {"group_name": ["term1", "term2"], ...}}`)

  const text = result.response.text()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) { console.log('No JSON in response:', text); return }

  const { additions } = JSON.parse(jsonMatch[0])

  // Filter out existing
  for (const [g, terms] of Object.entries(additions)) {
    ;(additions as any)[g] = (terms as string[]).filter(t => !allTerms.has(t.toLowerCase()))
  }

  console.log('\n=== Suggested additions ===')
  let totalNew = 0
  for (const [group, terms] of Object.entries(additions)) {
    const arr = terms as string[]
    if (arr.length === 0) continue
    console.log(`\n${group} (+${arr.length}):`)
    for (const t of arr) console.log(`  + ${t}`)
    totalNew += arr.length
  }
  console.log(`\nTotal new terms: ${totalNew}`)

  // Apply to DB
  const updated = groups.map((g: any) => {
    const newTerms = (additions as any)[g.name] as string[] | undefined
    if (!newTerms?.length) return g
    return { ...g, terms: [...g.terms, ...newTerms] }
  })

  const { error } = await supabase.from('scoring_config').update({ value: updated, updated_at: new Date().toISOString() }).eq('key', 'keyword_groups')
  if (error) { console.log('DB error:', error.message); return }
  console.log('\nKeyword groups updated in DB!')
}

main().catch(console.error)
