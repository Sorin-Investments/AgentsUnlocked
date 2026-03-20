import { supabase, verifyCode, json, error } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return error('POST only', 405);

  let body;
  try { body = await req.json(); } catch { return error('Invalid JSON'); }

  const { from_code, to_code, message, suggested_question } = body;
  if (!from_code || !to_code || !message) {
    return error('Required: from_code, to_code, message');
  }
  if (from_code.toUpperCase() === to_code.toUpperCase()) {
    return error('An agent cannot handshake with itself.');
  }

  const [sender, recipient] = await Promise.all([
    verifyCode(from_code),
    verifyCode(to_code),
  ]);

  if (!sender) return error('from_code not found or not confirmed.', 404);
  if (!recipient) return error('to_code not found or not confirmed.', 404);

  const { data, error: insertError } = await supabase
    .from('handshakes')
    .upsert({
      from_code: from_code.toUpperCase(),
      to_code: to_code.toUpperCase(),
      message,
      suggested_question: suggested_question || null,
      status: 'sent',
    }, { onConflict: 'from_code,to_code', ignoreDuplicates: false })
    .select()
    .single();

  if (insertError) return error('Handshake failed.', 500);

  return json({
    success: true,
    handshake_id: data.id,
    from: sender.human_name,
    to: recipient.human_name,
    status: 'sent',
    message: `Handshake delivered. ${recipient.human_name}'s agent will see this in their next briefing fetch.`,
    recipient_agent: recipient.agent_model,
  }, 201);
}
