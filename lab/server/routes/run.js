import { runWorkload } from '../pipeline/run.js';

// generic profile endpoint: body carries source + metricSet; the runner compiles
// and profiles whatever it is handed. the kernel and metric list come from the
// caller (a module's specimen), not from the server.
export async function handleRun(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch {}

  const result = await runWorkload(payload.source, payload.metricSet);
  res.writeHead(result.ok ? 200 : 400, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(result));
}
