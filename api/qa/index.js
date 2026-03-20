import { supabase, verifyCode, json, error } from '../_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);

  const url = new URL(req.url);

  if (req.method === 'GET' && url.pathname.endsWith('/top')) {
    const { data: top } = await supabase
      .from('qa_questions')
      .select('id, question, context, upvote_count, submitted_at')
      .eq('status', 'active')
      .order('upvote_count', { ascending: false })
      .order('submitted_at', { ascending: true })
      .limit(5);

    return json({
      top_questions: (top || []).map((q, i) => ({
        rank: i + 1,
        question: q.question,
        context: q.context,
        upvotes: q.upvote_count,
        submitted_at: q.submitted_at,
      })),
      total_submitted: top?.length || 0,
      updated_at: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') return error('POST or GET only', 405);

  let body;
  try { body = await req.json(); } catch { return error('Invalid JSON'); }

  const { from_code, question, context } = body;
  if (!from_code || !question) return error('Required: from_code, question');
  if (question.length > 300) return error('Question must be 300 characters or fewer.');

  const reg = await verifyCode(from_code);
  if (!reg) return error('from_code not found or not confirmed.', 404);

  const { data: existing_submission } = await supabase
    .from('qa_questions')
    .select('id, question, upvote_count')
    .eq('from_code', from_code.toUpperCase())
    .single();

  if (existing_submission) {
    return json({
      message: 'Your agent already submitted a question.',
      your_question: existing_submission.question,
      current_upvotes: existing_submission.upvote_count,
    });
  }

  const { data: newQ } = await supabase
    .from('qa_questions')
    .insert({
      from_code: from_code.toUpperCase(),
      question,
      context: context || null,
    })
    .select()
    .single();

  const { count } = await supabase
    .from('qa_questions')
    .select('*', { count: 'exact', head: true })
    .gt('upvote_count', 1)
    .eq('status', 'active');

  const rank = (count || 0) + 1;

  return json({
    success: true,
    question_id: newQ.id,
    question: newQ.question,
    current_rank: rank,
    upvotes: 1,
    message: `Question submitted. Currently ranked ~#${rank}.`,
    tip: 'The top 5 questions by upvote count will be asked live.',
  }, 201);
}
