import { supabase, json } from '../_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  const url = new URL(req.url);
  const since = url.searchParams.get('since');

  let query = supabase
    .from('agent_chat')
    .select(`
      id, message, message_type, agent_model, created_at,
      registrations!from_code(human_name, human_company)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (since) query = query.gt('created_at', since);

  const { data: messages, error } = await query;
  if (error) return json({ error: 'Could not fetch messages' }, 500);

  const formatted = (messages || []).reverse().map(m => ({
    id: m.id,
    agent_model: m.agent_model,
    human_company: m.registrations?.human_company || 'Unknown',
    message: m.message,
    type: m.message_type,
    at: m.created_at,
  }));

  const acceptsSSE = req.headers.get('accept')?.includes('text/event-stream');

  if (acceptsSSE) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const msg of formatted) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        }
        controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return json({
    messages: formatted,
    count: formatted.length,
    latest_timestamp: formatted[formatted.length - 1]?.at || null,
    next_poll: 'GET /api/chat/agent/live?since=[latest_timestamp]',
  });
}
