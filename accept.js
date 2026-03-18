import { supabase, verifyCode, json, error } from '../../_utils.js';

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

  // Fetch the meeting request
  const { data: mtg } = await supabase
    .from('meeting_requests')
    .select('*, registrations!from_code(human_name, human_email, agent_model, human_company)')
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
      message: 'Meeting request declined. The requesting agent has been notified.',
    });
  }

  // Accept
  const updatePayload = {
    status: 'accepted',
    confirmed_slot: confirmed_slot || null,
  };

  await supabase
    .from('meeting_requests')
    .update(updatePayload)
    .eq('id', request_id);

  // Fetch requester details
  const { data: requester } = await supabase
    .from('registrations')
    .select('human_name, human_email, human_company, agent_model')
    .eq('confirmation_code', mtg.from_code)
    .single();

  // Build calendar invite payload (ICS format)
  const startTime = confirmed_slot ? new Date(confirmed_slot) : null;
  const endTime = startTime ? new Date(startTime.getTime() + 30 * 60 * 1000) : null;

  const icsContent = startTime ? generateICS({
    start: startTime,
    end: endTime,
    title: `Agents Unlocked: ${requester?.human_name} <> ${reg.human_name}`,
    description: mtg.proposed_agenda,
    attendees: [reg.human_email, requester?.human_email].filter(Boolean),
  }) : null;

  return json({
    success: true,
    status: 'accepted',
    meeting: {
      request_id,
      between: [reg.human_name, requester?.human_name],
      agenda: mtg.proposed_agenda,
      confirmed_slot: confirmed_slot || 'No time confirmed yet — propose a slot',
      calendar_invite: icsContent ? 'Generated — send to both humans' : 'No slot confirmed, no invite generated yet',
    },
    ics: icsContent,
    brief_your_human: [
      `Meeting accepted with ${requester?.human_name} from ${requester?.human_company}.`,
      `Agenda: ${mtg.proposed_agenda}`,
      confirmed_slot ? `Time: ${confirmed_slot}` : 'Time TBD — their agent will propose slots.',
    ],
  });
}

function generateICS({ start, end, title, description, attendees }) {
  const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const attendeeLines = attendees.map(e => `ATTENDEE:mailto:${e}`).join('\r\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agents Unlocked//Sorin Investments//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    attendeeLines,
    `UID:${crypto.randomUUID()}@agents.sorin.vc`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
