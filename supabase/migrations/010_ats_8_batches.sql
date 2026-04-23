-- Bump poll-ats cron from 4 batches to 8 to keep each Edge Function invocation
-- well within the 400s timeout. NUM_BATCHES in poll-ats/index.ts is now 8.
-- Schedule: every 7-8 minutes (one batch per ~7.5 min slot) so a full cycle
-- still completes each hour.

SELECT cron.unschedule('ats-batch-0');
SELECT cron.unschedule('ats-batch-1');
SELECT cron.unschedule('ats-batch-2');
SELECT cron.unschedule('ats-batch-3');

SELECT cron.schedule('ats-batch-0', '0 * * * *',  $$SELECT call_edge('poll-ats', '{"batch":0}'::jsonb)$$);
SELECT cron.schedule('ats-batch-1', '7 * * * *',  $$SELECT call_edge('poll-ats', '{"batch":1}'::jsonb)$$);
SELECT cron.schedule('ats-batch-2', '15 * * * *', $$SELECT call_edge('poll-ats', '{"batch":2}'::jsonb)$$);
SELECT cron.schedule('ats-batch-3', '22 * * * *', $$SELECT call_edge('poll-ats', '{"batch":3}'::jsonb)$$);
SELECT cron.schedule('ats-batch-4', '30 * * * *', $$SELECT call_edge('poll-ats', '{"batch":4}'::jsonb)$$);
SELECT cron.schedule('ats-batch-5', '37 * * * *', $$SELECT call_edge('poll-ats', '{"batch":5}'::jsonb)$$);
SELECT cron.schedule('ats-batch-6', '45 * * * *', $$SELECT call_edge('poll-ats', '{"batch":6}'::jsonb)$$);
SELECT cron.schedule('ats-batch-7', '52 * * * *', $$SELECT call_edge('poll-ats', '{"batch":7}'::jsonb)$$);
