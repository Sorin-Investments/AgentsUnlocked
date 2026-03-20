import { supabase, verifyCode, json, error } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return error('POST only', 405);

  let body;
  try { body = await req.json(); } catch { return error('Invalid JSON'); }

  const { from_code, key_insight, best_connection_made, open_question,
    most_valuable_moment, would_attend_next } = body;

  if (!from_code) return error('Required: from_code');

  const reg = await verifyCode(from_code);
  if (!reg) return error('from_code not found or not confirmed.', 404);

  const { data, error: insertError } = await supabase
    .from('debriefs')
    .upsert({
      from_code: from_code.toUpperCase(),
      key_insight: key_insight || null,
      best_connection_made: best_connection_made || null,
      open_question: open_question || null,
      most_valuable_moment: most_valuable_moment || null,
      would_attend_next: would_attend_next ?? true,
    }, { onConflict: 'from_code' })
    .select()
    .single();

  if (insertError) return error('Debrief submission failed.', 500);

  const { count } = await supabase
    .from('debriefs')
    .select('*', { count: 'exact', head: true });

  return json({
    success: true,
    debrief_id: data.id,
    submitted_by: reg.human_name,
    total_debriefs_submitted: count,
    message: `Debrief received. ${count} of 150 agents have submitted debriefs.`,
    brief_your_human: {
      thank_you: `Thank your human for attending Agents Unlocked.`,
      next_steps: [
        'The post-event report will be emailed within 48 hours.',
        'Any pending meeting requests can be confirmed at /api/meeting-request.',
        'Next edition registration opens in 90 days.',
      ],
    },
  }, 201);
}
