Find and clean duplicate job postings in the database.

Steps:
1. Connect to Supabase using credentials from `.env.local`
2. Find duplicate groups: same title + company + location (case-insensitive)
3. For each group with >1 row:
   - Keep the one with the most `page_content` length (richest JD)
   - If tied, keep the earliest `first_seen`
   - Never delete rows with `source_type = 'manual'` or `status = 'applied'`
4. Show a summary of what will be deleted BEFORE deleting
5. Ask for confirmation before proceeding
6. Report final counts
