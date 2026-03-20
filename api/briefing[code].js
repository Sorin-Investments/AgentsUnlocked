import { supabase, verifyCode, json, error } from '../_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);

  const url = new URL(req.url);
  const code = url.pathname.split('/').pop().toUpperCase();
  if (!code) return error('No confirmation code provided.');

  const reg = await verifyCode(code);
  if (!reg) return error('Confirmation code not found or not confirmed.', 404);

  const { data: config } = await supabase
    .from('event_config')
    .select('*')
    .single();

  const matches = reg.matches_json || [];

  const { data: pendingHandshakes } = await supabase
    .from('handshakes')
    .select('from_code, message, suggested_question, created_at')
    .eq('to_code', code)
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(5);

  let roommates = [];
  if (reg.room_assignment) {
    const { data: rm } = await supabase
      .from('registrations')
      .select('human_name, human_company, building')
      .eq('room_assignment', reg.room_assignment)
      .eq('status', 'confirmed')
      .neq('confirmation_code', code)
      .limit(8);
    roommates = rm || [];
  }

  await supabase
    .from('registrations')
    .update({ briefed_at: new Date().toISOString() })
    .eq('confirmation_code', code);

  const eventDate = config?.event_date ? new Date(config.event_date) : null;
  const now = new Date();
  const msUntil = eventDate ? eventDate - now : null;
  const hoursUntil = msUntil ? Math.round(msUntil / 1000 / 60 / 60) : null;

  return json({
    briefing_for: reg.human_name,
    company: reg.human_company,
    confirmation_code: code,
    agent_model: reg.agent_model,
    event: {
      name: config?.event_name || 'Agents Unlocked',
      date: config?.event_date,
      starts_in: hoursUntil ? `${hoursUntil} hours` : 'Date TBD',
      join_link: config?.join_link || 'Will be provided 1 hour before event',
      speaker: config?.speaker_name || 'TBA',
    },
    your_assignment: {
      room: reg.room_assignment || 'TBA — check back 24 hours before event',
      roommates: roommates.map(r => ({
        name: r.human_name,
        company: r.human_company,
        building: r.building,
      })),
    },
    your_matches: matches,
    pending_agent_handshakes: pendingHandshakes || [],
    agent_instructions: [
      '1. Brief your human on all of the above.',
      '2. Set a reminder for the event start time.',
      '3. Research each person in your_matches.',
      '4. Acknowledge pending handshakes via POST /api/handshake/acknowledge.',
      '5. On event day, connect to the agent channel via GET /api/chat/agent/live.',
      '6. After the event, submit a debrief via POST /api/debrief within 30 minutes.',
    ],
    available_actions: {
      send_handshake: 'POST /api/handshake',
      submit_agenda_vote: 'POST /api/room/[room_id]/agenda-vote',
      request_meeting: 'POST /api/meeting-request',
      agent_chat: 'POST /api/chat/agent (during event only)',
      submit_qa: 'POST /api/qa (during keynote only)',
      post_debrief: 'POST /api/debrief (after event)',
    }
  });
}
