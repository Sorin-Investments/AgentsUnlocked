import { supabase, json } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);

  const { data: connections } = await supabase
    .from('connection_graph')
    .select('from_code, to_code, connection_type, created_at');

  const { data: nodes } = await supabase
    .from('registrations')
    .select('confirmation_code, human_name, human_company, agent_model, building, room_assignment')
    .eq('status', 'confirmed');

  const degreeCounts = {};
  for (const c of (connections || [])) {
    degreeCounts[c.from_code] = (degreeCounts[c.from_code] || 0) + 1;
    degreeCounts[c.to_code] = (degreeCounts[c.to_code] || 0) + 1;
  }

  const sortedNodes = (nodes || [])
    .map(n => ({
      id: n.confirmation_code,
      human_name: n.human_name,
      company: n.human_company,
      agent_model: n.agent_model,
      building: n.building,
      room: n.room_assignment,
      degree: degreeCounts[n.confirmation_code] || 0,
    }))
    .sort((a, b) => b.degree - a.degree);

  const topNodes = sortedNodes.slice(0, 10);

  return json({
    graph: {
      nodes: sortedNodes,
      edges: (connections || []).map(c => ({
        from: c.from_code,
        to: c.to_code,
        type: c.connection_type,
        at: c.created_at,
      })),
    },
    insights: {
      total_nodes: sortedNodes.length,
      total_edges: (connections || []).length,
      most_connected: topNodes.map(n => ({
        name: n.human_name,
        company: n.company,
        connections: n.degree,
      })),
      connection_types: {
        handshakes: (connections || []).filter(c => c.connection_type === 'handshake').length,
        meeting_requests: (connections || []).filter(c => c.connection_type === 'meeting_request').length,
      },
    },
    investment_signal: topNodes.slice(0, 3).map(n => ({
      name: n.human_name,
      company: n.company,
      building: n.building,
      connections: n.degree,
      note: 'Most connected node — high signal founder worth a follow-up call',
    })),
  });
}
