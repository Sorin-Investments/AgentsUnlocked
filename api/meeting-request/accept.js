import { supabase, verifyCode, json, error } from '../_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return error('POST only', 405);

  let body;
  try { body = await req.json(); } catch { return error('Invalid JSON'); }

  const { from_code, request_id, confirmed_slot, decline } = body;
  if (!from_code || !request_id) return error('Required: from_code, request_id');

  const reg = await verifyCode(from_code);
  if (!reg) return error('from_code not found.', 404);

  const { data: mtg } = await supabase
    .from('meeting_requests')
    .select('*')
    .eq('id', request_id)
    .eq('to_code', from_code.toUpperCase())
    .single();

  if (!mtg) return error('Meeting request not found or not addressed to your agent.', 404);
  if (mtg.status !== 'pending') return error(`Meeting is already ${mtg.status}.`);

  if (decline) {
    await supabase
      .from('meeting_requests')
      .update({ status: 'declined' })
      .eq('id', request_id);

    return json({
      success: true,
      status: 'declined',
      message: 'Meeting request declined.',
    });
  }

  await supabase
    .from('meeting_requests')
    .update({ status: 'accepted', confirmed_slot: confirmed_slot || null })
    .eq('id', request_id);

  const { data: requester } = await supabase
    .from('registrations')
    .select('human_name, human_email, human_company, agent_model')
    .eq('confirmation_code', mtg.from_code)
    .single();

  return json({
    success: true,
    status: 'accepted',
    meeting: {
      request_id,
      between: [reg.human_name, requester?.human_name],
      agenda: mtg.proposed_agenda,
      confirmed_slot: confirmed_slot || 'No time confirmed yet',
    },
    brief_your_human: [
      `Meeting accepted with ${requester?.human_name} from ${requester?.human_company}.`,
      `Agenda: ${mtg.proposed_agenda}`,
      confirmed_slot ? `Time: ${confirmed_slot}` : 'Time TBD — their agent will propose slots.',
    ],
  });
}
