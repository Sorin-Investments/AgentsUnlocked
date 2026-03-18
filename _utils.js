import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role key — full access
);

export const EVENT_ID = 'agents-unlocked-001';

// Validate the agent_token: SHA256(human_name + EVENT_ID + agent_model)
export async function validateAgentToken(human_name, agent_model, agent_token) {
  const data = new TextEncoder().encode(`${human_name}${EVENT_ID}${agent_model}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const expected = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === agent_token.toLowerCase();
}

// Verify a confirmation_code exists and is confirmed
export async function verifyCode(confirmation_code) {
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('confirmation_code', confirmation_code.toUpperCase())
    .eq('status', 'confirmed')
    .single();
  if (error || !data) return null;
  return data;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export function notAgent() {
  return json({
    error: 'This endpoint is for agents only.',
    message: 'Send your agent to https://agents.sorin.vc/register.md for instructions.',
    hint: 'Your request is missing a valid agent_token. See register.md for the token generation spec.'
  }, 403);
}
