#!/usr/bin/env node
// ============================================================
// POST-EVENT REPORT GENERATOR
// Run this within 2 hours of the event ending.
// Aggregates all agent debriefs + chat messages + meeting
// requests into a structured collective intelligence report.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... ANTHROPIC_API_KEY=... node generate-report.js
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function generateReport() {
  console.log('📊 Generating post-event report...\n');

  // Fetch all data
  const [
    { data: debriefs },
    { data: registrations },
    { data: chatMessages },
    { data: qaQuestions },
    { data: meetings },
    { data: handshakes },
  ] = await Promise.all([
    supabase.from('debriefs').select('*'),
    supabase.from('registrations').select('*').eq('status', 'confirmed'),
    supabase.from('agent_chat').select('*').order('created_at'),
    supabase.from('qa_questions').select('*').order('upvote_count', { ascending: false }),
    supabase.from('meeting_requests').select('*').eq('status', 'accepted'),
    supabase.from('handshakes').select('*'),
  ]);

  console.log(`  Debriefs submitted: ${debriefs?.length || 0} / ${registrations?.length || 0}`);
  console.log(`  Agent messages: ${chatMessages?.length || 0}`);
  console.log(`  Q&A questions: ${qaQuestions?.length || 0}`);
  console.log(`  Meetings booked: ${meetings?.length || 0}`);
  console.log(`  Handshakes sent: ${handshakes?.length || 0}`);

  // Build prompt for Claude to synthesize
  const debriefsText = (debriefs || []).map(d =>
    `- Key insight: "${d.key_insight || 'n/a'}" | Open question: "${d.open_question || 'n/a'}" | Best connection: "${d.best_connection_made || 'n/a'}" | Would attend next: ${d.would_attend_next}`
  ).join('\n');

  const chatText = (chatMessages || [])
    .filter(m => m.message_type !== 'summary')
    .map(m => `[${m.message_type.toUpperCase()}] (${m.agent_model}): ${m.message}`)
    .join('\n');

  const qaText = (qaQuestions || [])
    .slice(0, 10)
    .map((q, i) => `${i + 1}. [${q.upvote_count} upvotes] ${q.question}`)
    .join('\n');

  const prompt = `You are the curator of "Agents Unlocked", India's first agent-native virtual mixer for AI builders, hosted by Sorin Investments.

You have the following raw data from the event. Synthesize this into a structured post-event report.

AGENT DEBRIEFS (${debriefs?.length} submitted):
${debriefsText}

AGENT CHANNEL MESSAGES (selected):
${chatText.slice(0, 3000)}

TOP Q&A QUESTIONS (by upvote):
${qaText}

EVENT STATS:
- Total attendees: ${registrations?.length}
- Meetings booked agent-to-agent: ${meetings?.length}
- Handshakes exchanged: ${handshakes?.length}
- Debrief completion rate: ${Math.round((debriefs?.length / registrations?.length) * 100)}%

Generate a post-event report as a JSON object (no markdown, no explanation, just JSON):
{
  "headline": "One-sentence summary of the most important thing that came out of the event",
  "top_insights": [
    { "insight": "string", "frequency": "how many people/agents raised this", "implication": "what this means for the AI agents space" }
  ],
  "open_questions": ["string — unanswered questions the community is debating"],
  "top_themes": ["string — recurring topics across rooms and chat"],
  "most_cited_moment": "string — the breakout moment everyone talked about",
  "sorin_thesis_signal": "string — what this event tells Sorin about where to invest in AI agents",
  "companies_to_watch": [
    { "company": "string", "why": "string — based on connections they made and interest they generated" }
  ],
  "next_edition_preview": "string — one theme that should anchor the next Agents Unlocked"
}`;

  console.log('\n🧠 Calling Claude to synthesise report...');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  let report;
  try {
    report = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    console.error('Failed to parse report JSON — writing raw text');
    report = { raw: text };
  }

  // Add raw stats
  report.stats = {
    total_attendees: registrations?.length,
    debriefs_submitted: debriefs?.length,
    debrief_rate_pct: Math.round((debriefs?.length / registrations?.length) * 100),
    agent_messages: chatMessages?.length,
    meetings_booked: meetings?.length,
    handshakes_sent: handshakes?.length,
    qa_questions_submitted: qaQuestions?.length,
    would_attend_next_pct: Math.round(
      ((debriefs || []).filter(d => d.would_attend_next).length / (debriefs?.length || 1)) * 100
    ),
  };

  // Write to file
  const filename = `report-agents-unlocked-${new Date().toISOString().split('T')[0]}.json`;
  writeFileSync(filename, JSON.stringify(report, null, 2));
  console.log(`\n✓ Report written to ${filename}`);

  // Also print key sections
  console.log('\n======= REPORT PREVIEW =======');
  console.log(`\n📌 Headline: ${report.headline}`);
  console.log(`\n💡 Top insights:`);
  (report.top_insights || []).forEach(i => console.log(`   • ${i.insight}`));
  console.log(`\n❓ Open questions:`);
  (report.open_questions || []).forEach(q => console.log(`   • ${q}`));
  console.log(`\n📈 Sorin thesis signal: ${report.sorin_thesis_signal}`);
  console.log('\n==============================\n');

  return report;
}

generateReport().catch(console.error);
