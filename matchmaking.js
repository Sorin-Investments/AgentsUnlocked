#!/usr/bin/env node
// ============================================================
// MATCHMAKING JOB
// Run this script 48–72 hours before the event
// It reads all registrations, calls Claude API to generate
// personalised match recommendations, and writes them back
// to the registrations table.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... ANTHROPIC_API_KEY=... node matchmaking.js
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MATCHES_PER_PERSON = 3;

async function generateMatches(targetAttendee, allAttendees) {
  const others = allAttendees.filter(a => a.confirmation_code !== targetAttendee.confirmation_code);

  const prompt = `You are the curator of an AI agents-focused networking event called "Agents Unlocked" run by Sorin Investments, a VC firm.

Your job: find the 3 most valuable people for ${targetAttendee.human_name} to meet.

TARGET ATTENDEE:
Name: ${targetAttendee.human_name}
Company: ${targetAttendee.human_company}
Building: ${targetAttendee.building}
Challenge: ${targetAttendee.challenge}

ALL OTHER ATTENDEES:
${others.map((a, i) => `
[${i + 1}] ${a.human_name} (${a.human_company})
  Building: ${a.building}
  Challenge: ${a.challenge}
  Confirmation: ${a.confirmation_code}
`).join('')}

Return ONLY valid JSON — no markdown, no explanation, just the JSON object:
{
  "matches": [
    {
      "confirmation_code": "XXXXXXXX",
      "name": "Person's name",
      "company": "Their company",
      "reason": "One specific sentence explaining exactly why these two should meet — reference what ${targetAttendee.human_name} is building and what this person specifically offers."
    }
  ]
}

Rules:
- Pick exactly ${MATCHES_PER_PERSON} matches
- Prioritise genuine technical overlap, not superficial similarity
- The reason must be specific — mention actual details from both profiles
- Do NOT match people who are direct competitors building identical things`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
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

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean).matches || [];
  } catch {
    console.error(`  ✗ JSON parse failed for ${targetAttendee.human_name}`);
    return [];
  }
}

async function assignRooms(attendees) {
  // Room definitions — edit these to match your actual breakout rooms
  const rooms = [
    { id: 'room-1', name: 'Autonomous coding agents', keywords: ['cod', 'engineer', 'developer', 'software', 'bug', 'test'] },
    { id: 'room-2', name: 'Multi-agent orchestration', keywords: ['orchestrat', 'multi', 'workflow', 'pipeline', 'coordinat'] },
    { id: 'room-3', name: 'Vernacular AI agents', keywords: ['hindi', 'vernacular', 'language', 'bharat', 'india', 'regional', 'multilingual'] },
    { id: 'room-4', name: 'Agents in healthcare', keywords: ['health', 'medical', 'clinic', 'patient', 'doctor', 'diagnos'] },
    { id: 'room-5', name: 'Enterprise agents', keywords: ['enterprise', 'b2b', 'saas', 'crm', 'erp', 'corporate', 'sales'] },
    { id: 'room-6', name: 'Agent memory & context', keywords: ['memory', 'context', 'retriev', 'vector', 'embed', 'rag', 'knowledge'] },
    { id: 'room-7', name: 'Open — early-stage founders', keywords: [] }, // catch-all
  ];

  const roomCounts = Object.fromEntries(rooms.map(r => [r.id, 0]));
  const MAX_PER_ROOM = 8;

  const assignments = [];
  for (const attendee of attendees) {
    const text = `${attendee.building} ${attendee.challenge}`.toLowerCase();

    let bestRoom = null;
    let bestScore = -1;

    for (const room of rooms) {
      if (roomCounts[room.id] >= MAX_PER_ROOM) continue;
      if (!room.keywords.length) continue; // skip catch-all in scoring pass

      const score = room.keywords.filter(kw => text.includes(kw)).length;
      if (score > bestScore) { bestScore = score; bestRoom = room; }
    }

    // Fallback to least-full room
    if (!bestRoom) {
      bestRoom = rooms
        .filter(r => roomCounts[r.id] < MAX_PER_ROOM)
        .sort((a, b) => roomCounts[a.id] - roomCounts[b.id])[0] || rooms[rooms.length - 1];
    }

    roomCounts[bestRoom.id]++;
    assignments.push({ code: attendee.confirmation_code, room: bestRoom.id, room_name: bestRoom.name });
  }

  return assignments;
}

async function run() {
  console.log('🤖 Agents Unlocked — Matchmaking Job');
  console.log('=====================================\n');

  // 1. Fetch all confirmed attendees
  const { data: attendees, error } = await supabase
    .from('registrations')
    .select('confirmation_code, human_name, human_company, building, challenge, agent_model')
    .eq('status', 'confirmed')
    .order('registered_at', { ascending: true });

  if (error) { console.error('Failed to fetch attendees:', error); process.exit(1); }
  console.log(`✓ Fetched ${attendees.length} confirmed attendees\n`);

  // 2. Assign rooms
  console.log('📍 Assigning breakout rooms...');
  const roomAssignments = await assignRooms(attendees);
  for (const assignment of roomAssignments) {
    await supabase
      .from('registrations')
      .update({ room_assignment: assignment.room })
      .eq('confirmation_code', assignment.code);
  }
  console.log('✓ Room assignments complete\n');

  // Room summary
  const roomSummary = {};
  roomAssignments.forEach(a => {
    roomSummary[a.room_name] = (roomSummary[a.room_name] || 0) + 1;
  });
  Object.entries(roomSummary).forEach(([room, count]) => {
    console.log(`  ${room}: ${count} attendees`);
  });
  console.log('');

  // 3. Generate AI matches for each attendee
  console.log('🧠 Generating AI match recommendations...');
  console.log(`   ${attendees.length} attendees × ${MATCHES_PER_PERSON} matches = ${attendees.length * MATCHES_PER_PERSON} total recommendations\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < attendees.length; i++) {
    const attendee = attendees[i];
    process.stdout.write(`  [${i + 1}/${attendees.length}] ${attendee.human_name}... `);

    try {
      const matches = await generateMatches(attendee, attendees);

      await supabase
        .from('registrations')
        .update({ matches_json: matches })
        .eq('confirmation_code', attendee.confirmation_code);

      console.log(`✓ (${matches.length} matches)`);
      successCount++;
    } catch (err) {
      console.log(`✗ Error: ${err.message}`);
      failCount++;
    }

    // Rate limit: 1 request per second
    if (i < attendees.length - 1) await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`\n=====================================`);
  console.log(`✓ Matchmaking complete`);
  console.log(`  Success: ${successCount} | Failed: ${failCount}`);
  console.log(`\nNext step: Run the briefing push to notify all agents.`);
}

run().catch(console.error);
