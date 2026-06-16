import { runWorkload } from '../pipeline/run.js';

export async function handleRun(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  let knobs = {};
  try { knobs = JSON.parse(body || '{}'); } catch {}

  const result = await runWorkload(knobs);
  res.writeHead(result.ok ? 200 : 400, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(result));
}
