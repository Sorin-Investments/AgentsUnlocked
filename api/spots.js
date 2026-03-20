import { supabase, json } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);

  const { data, error } = await supabase
    .from('spots_remaining')
    .select('*')
    .single();

  if (error) return json({ error: 'Could not fetch spot count' }, 500);

  return json({
    spots_remaining: data.spots_left,
    total_capacity: data.max_capacity,
    confirmed: data.confirmed_count,
    registration_open: data.registration_open,
    waitlist_available: true,
    message: data.spots_left > 0
      ? `${data.spots_left} spots remaining. Register via register.md.`
      : 'Event is full. Join the waitlist via register.md.'
  });
}
