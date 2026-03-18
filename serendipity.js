#!/usr/bin/env node
// ============================================================
// SERENDIPITY ENGINE
// Run this every 20 minutes DURING the event.
// Analyses agent chat activity and surfaces unexpected
// second-order connections between attendees who haven't met.
//
// Usage (run manually or via cron):
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... ANTHROPIC_API_KEY=... node serendipity.js
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function findSerendipitousConnections() {
  // Fetch recent agent chat (last 60 minutes)
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentChat } = await supabase
    .from('agent_chat')
    .select('from_code, message, message_type, created_at, registrations!from_code(human_name, human_company, building, challenge)')
    .gte('created_at', since)
    .order('created_at');

  // Fetch all confirmed attendees
  const { data: attendees } = await supabase
    .from('registrations')
    .select('confirmation_code, human_name, human_company, building, challenge')
    .eq('status', 'confirmed');

  // Fetch existing handshakes + meeting requests (to avoid duplicates)
  const { data: existingConnections } = await supabase
    .from('connection_graph')
    .select('from_code, to_code');

  const connectedPairs = new Set(
    (existingConnections || []).map(c => [c.from_code, c.to_code].sort().join('--'))
  );

  if (!recentChat?.length || !attendees?.length) {
    console.log('Not enough activity yet for serendipity detection.');
    return;
  }

  // Build activity map: code → [keywords from their messages]
  const activityMap = {};
  for (const msg of recentChat) {
    const code = msg.from_code;
    if (!activityMap[code]) activityMap[code] = [];
    activityMap[code].push(msg.message);
  }

  // Only consider attendees who have been active
  const activeAttendees = attendees.filter(a => activityMap[a.confirmation_code]);

  if (activeAttendees.length < 2) {
    console.log('Not enough active attendees for serendipity matching.');
    return;
  }

  const prompt = `You are the serendipity engine for "Agents Unlocked", an AI agents networking event.

Your job: find 2-3 pairs of attendees who have NOT yet connected but whose live activity shows unexpected overlap.

ACTIVE ATTENDEE PROFILES + WHAT THEIR AGENTS SAID IN THE LAST HOUR:
${activeAttendees.map(a => `
Name: ${a.human_name} (${a.human_company})
Building: ${a.building}
Challenge: ${a.challenge}
Code: ${a.confirmation_code}
Agent messages: ${(activityMap[a.confirmation_code] || []).join(' | ')}
`).join('\n')}

ALREADY CONNECTED PAIRS (do NOT suggest these):
${[...connectedPairs].join(', ') || 'none yet'}

Find 2-3 pairs with genuine unexpected overlap — second-order connections, not obvious ones.
Return ONLY valid JSON:
{
  "connections": [
    {
      "person_a_code": "XXXXXXXX",
      "person_b_code": "XXXXXXXX",
      "reason": "Specific 1-2 sentence explanation of the unexpected overlap, referencing what each person said or is building",
      "suggested_intro": "The actual message to send to both humans introducing them to each other"
    }
  ]
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  let result;
  try {
    result = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    console.error('Parse error:', text.slice(0, 200));
    return;
  }

  const connections = result.connections || [];
  console.log(`\n✨ Found ${connections.length} serendipitous connections:\n`);

  for (const conn of connections) {
    // Post serendipity alert to agent chat as a special 'connection' type message
    const msg = `🌐 SERENDIPITY ALERT: ${conn.reason} — ${conn.suggested_intro}`;

    await supabase.from('agent_chat').insert({
      from_code: conn.person_a_code,  // attributed to first person's agent
      agent_model: 'serendipity-engine',
      message: msg,
      message_type: 'connection',
    });

    // Create a handshake between them automatically
    const pairKey = [conn.person_a_code, conn.person_b_code].sort().join('--');
    if (!connectedPairs.has(pairKey)) {
      await supabase.from('handshakes').insert({
        from_code: conn.person_a_code,
        to_code: conn.person_b_code,
        message: conn.suggested_intro,
        status: 'sent',
      }).on('conflict', 'do_nothing'); // ignore if already exists
    }

    console.log(`  • ${conn.person_a_code} ↔ ${conn.person_b_code}: ${conn.reason}`);
  }
}

findSerendipitousConnections().catch(console.error);
