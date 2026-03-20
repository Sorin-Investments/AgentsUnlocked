import { supabase, validateAgentToken, json, error, notAgent, EVENT_ID } from './_utils.js';

export const config = { runtime: 'edge' };

const REQUIRED = ['human_name', 'human_company', 'building', 'challenge', 'agent_model', 'agent_token'];

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return error('POST only', 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return error('Invalid JSON body. Your agent should POST a JSON object per register.md spec.');
  }

  const missing = REQUIRED.filter(f => !body[f]);
  if (missing.length) {
    return error(`Missing required fields: ${missing.join(', ')}. See register.md for the full schema.`);
  }

  const valid = await validateAgentToken(body.human_name, body.agent_model, body.agent_token);
  if (!valid) return notAgent();

  const buildingWords = body.building.trim().split(/\s+/).length;
  const challengeWords = body.challenge.trim().split(/\s+/).length;
  if (buildingWords > 50) return error('"building" must be 50 words or fewer.');
  if (challengeWords > 50) return error('"challenge" must be 50 words or fewer.');

  const { data: spots } = await supabase.from('spots_remaining').select('*').single();
  const isFull = spots?.spots_left <= 0 || !spots?.registration_open;

  const { data: existing } = await supabase
    .from('registrations')
    .select('confirmation_code, status')
    .eq('human_name', body.human_name)
    .eq('agent_model', body.agent_model)
    .single();

  if (existing) {
    return json({
      message: 'Your human is already registered.',
      confirmation_code: existing.confirmation_code,
      status: existing.status,
      next: `Fetch your briefing at /api/briefing/${existing.confirmation_code}`
    });
  }

  const { data: reg, error: insertError } = await supabase
    .from('registrations')
    .insert({
      human_name: body.human_name,
      human_company: body.human_company,
      human_email: body.human_email || null,
      linkedin_url: body.linkedin_url || null,
      building: body.building,
      challenge: body.challenge,
      agent_model: body.agent_model,
      agent_token: body.agent_token,
      status: isFull ? 'waitlist' : 'confirmed',
    })
    .select()
    .single();

  if (insertError) return error('Registration failed. Please retry.', 500);

  const isWaitlist = reg.status === 'waitlist';
  return json({
    success: true,
    status: reg.status,
    confirmation_code: reg.confirmation_code,
    human_name: reg.human_name,
    agent_model: reg.agent_model,
    event_id: EVENT_ID,
    message: isWaitlist
      ? `Added to waitlist. Your agent will be notified if a spot opens.`
      : `Registration confirmed. Welcome to Agents Unlocked. ${spots.spots_left - 1} spots remaining.`,
    next_step: isWaitlist
      ? 'Monitor /api/spots. If spots_remaining > 0, re-register.'
      : `Fetch your briefing 48 hours before the event: GET /api/briefing/${reg.confirmation_code}`,
    brief_your_human: {
      event: 'Agents Unlocked by Sorin Investments',
      for
