import { createClient } from '@supabase/supabase-js'
import { extractKeywordsLLM, validateKeywords } from '../packages/scoring/src/llm-keywords'

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (!anthropicKey) { console.log('No ANTHROPIC_API_KEY set'); return }

  const { data: resume } = await supabase.from('resume_versions').select('keywords_extracted').eq('is_active', true).eq('resume_type', 'ats').single()
  const resumeKeywords: string[] = (resume as any)?.keywords_extracted ?? []
  console.log('Resume keywords:', resumeKeywords.length)

  // Get ALL jobs with JD content
  const { data: jobs } = await supabase.from('job_postings')
    .select('id, title, company, page_content')
    .not('page_content', 'is', null)
    .order('first_seen', { ascending: false })

  const toScore = (jobs || []).filter((j: any) => j.page_content && j.page_content.length > 100)
  console.log('Jobs to rescore:', toScore.length)

  let scored = 0, failed = 0
  for (let i = 0; i < toScore.length; i++) {
    const job = toScore[i]
    const plainText = stripHtml(job.page_content!)
    if (plainText.length < 50) { failed++; continue }

    const content = plainText.slice(0, 12000)
    try {
      const raw = await extractKeywordsLLM(content, resumeKeywords, anthropicKey)
      const result = raw ? validateKeywords(raw, content, resumeKeywords) : null
      if (result) {
        const allKw = [...result.matched, ...result.missing]
        const fit = result.role_fit
        const priority = fit >= 80 ? 'high' : fit >= 50 ? 'medium' : fit >= 1 ? 'low' : 'skip'
        await supabase.from('job_postings').update({ keywords_matched: allKw, resume_fit: fit, priority }).eq('id', job.id)
        scored++
        console.log(`[${i + 1}/${toScore.length}] fit:${fit} ${job.title} — ${job.company}`)
      } else {
        failed++
        console.log(`[${i + 1}/${toScore.length}] FAILED ${job.title} — ${job.company}`)
      }
    } catch (err: any) {
      failed++
      console.log(`[${i + 1}/${toScore.length}] ERROR ${job.title}: ${err.message?.substring(0, 80)}`)
    }
    // Rate limit: 200ms between calls
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\nDone: ${scored} scored, ${failed} failed out of ${toScore.length}`)
}

main().catch(console.error)
