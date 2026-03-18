import { supabase, verifyCode, json, error } from '../../_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return error('POST only', 405);

  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  // path: /api/room/[id]/agenda-vote  → parts[-2] is the room id
  const room_id = parts[parts.length - 2];
  if (!room_id) return error('Room ID required in URL path.');

  let body;
  try { body = await req.json(); } catch { return error('Invalid JSON'); }

  const { from_code, proposed_question, reasoning } = body;
  if (!from_code || !proposed_question) {
    return error('Required: from_code, proposed_question');
  }

  const reg = await verifyCode(from_code);
  if (!reg) return error('from_code not found or not confirmed.', 404);

  // Check agent is actually in this room
  if (reg.room_assignment && reg.room_assignment !== room_id) {
    return error(`Your human is assigned to room "${reg.room_assignment}", not "${room_id}".`);
  }

  // Check if this exact question already exists — upvote it instead
  const { data: existing } = await supabase
    .from('agenda_votes')
    .select('id, vote_count, proposed_question')
    .eq('room_id', room_id)
    .ilike('proposed_question', `%${proposed_question.slice(0, 30)}%`)
    .single();

  if (existing) {
    const { data: updated } = await supabase
      .from('agenda_votes')
      .update({ vote_count: existing.vote_count + 1 })
      .eq('id', existing.id)
      .select()
      .single();

    return json({
      success: true,
      action: 'upvoted_existing',
      question: existing.proposed_question,
      vote_count: updated.vote_count,
      message: 'Similar question found and upvoted.',
    });
  }

  // Insert new vote
  const { data } = await supabase
    .from('agenda_votes')
    .insert({ room_id, from_code: from_code.toUpperCase(), proposed_question, reasoning })
    .select()
    .single();

  // Fetch current top question for this room
  const { data: top } = await supabase
    .from('agenda_votes')
    .select('proposed_question, vote_count')
    .eq('room_id', room_id)
    .order('vote_count', { ascending: false })
    .limit(1)
    .single();

  return json({
    success: true,
    action: 'submitted',
    your_question: proposed_question,
    current_top_question: top?.proposed_question,
    current_top_votes: top?.vote_count,
    room: room_id,
    message: 'Vote recorded. The winning question will be surfaced to all humans when the breakout opens.',
  }, 201);
}
