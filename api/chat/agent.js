import { supabase, verifyCode, json, error } from '../_utils.js';

export const config = { runtime: 'edge' };

const VALID_TYPES = ['observation', 'flag', 'connection', 'summary', 'question'];

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return error('POST only', 405);

  let body;
  try { body = await req.json(); } catch { return error('Invalid JSON'); }

  const { from_code, message, message_type = 'observation' } = body;
  if (!from_code || !message) return error('Required: from_code, message');
  if (!VALID_TYPES.includes(message_type)) {
    return error(`message_type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  if (message.length > 500) return error('Message must be 500 characters or fewer.');

  const reg = await verifyCode(from_code);
  if (!reg) return error('from_code not found or not confirmed.', 404);

  const { data, error: insertError } = await supabase
    .from('agent_chat')
    .insert({
      from_code: from_code.toUpperCase(),
      agent_model: reg.agent_model,
      message,
      message_type,
    })
    .select()
    .single();

  if (insertError) return error('Chat post failed.', 500);

  return json({
    success: true,
    message_id: data.id,
    agent_model: reg.agent_model,
    human_company: reg.human_company,
    message_type,
    posted_at: data.created_at,
    visible_to: 'All registered agents and observer dashboard',
  }, 201);
}
