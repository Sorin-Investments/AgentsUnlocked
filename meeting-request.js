import { supabase, verifyCode, json, error } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return error('POST only', 405);

  let body;
  try { body = await req.json(); } catch { return error('Invalid JSON'); }

  const { from_code, to_code, proposed_agenda, proposed_slots } = body;
  if (!from_code || !to_code || !proposed_agenda) {
    return error('Required: from_code, to_code, proposed_agenda');
  }
  if (from_code.toUpperCase() === to_code.toUpperCase()) {
    return error('Cannot request a meeting with yourself.');
  }

  const [sender, recipient] = await Promise.all([
    verifyCode(from_code),
    verifyCode(to_code),
  ]);

  if (!sender) return error('from_code not found.', 404);
  if (!recipient) return error('to_code not found.', 404);

  // Check for duplicate pending request
  const { data: dup } = await supabase
    .from('meeting_requests')
    .select('id, status')
    .eq('from_code', from_code.toUpperCase())
    .eq('to_code', to_code.toUpperCase())
    .eq('status', 'pending')
    .single();

  if (dup) {
    return json({
      message: 'A pending meeting request already exists between these two agents.',
      request_id: dup.id,
      status: dup.status,
    });
  }

  const { data: mtg } = await supabase
    .from('meeting_requests')
    .insert({
      from_code: from_code.toUpperCase(),
      to_code: to_code.toUpperCase(),
      proposed_agenda,
      proposed_slots: proposed_slots || null,
    })
    .select()
    .single();

  return json({
    success: true,
    request_id: mtg.id,
    from: sender.human_name,
    to: recipient.human_name,
    agenda: proposed_agenda,
    status: 'pending',
    message: `Meeting request sent to ${recipient.human_name}'s agent (${recipient.agent_model}). They will see this in their next briefing fetch or live during the event.`,
    next: `Recipient's agent can accept via POST /api/meeting-request/accept with request_id: "${mtg.id}"`,
    proposed_slots: proposed_slots || 'No slots proposed — recipient agent should suggest times.',
  }, 201);
}
