import http from 'node:http';
import { config } from './config.js';
import { handleRun } from './routes/run.js';

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  if (req.method === 'POST' && req.url === '/run') return handleRun(req, res);
  res.writeHead(404); res.end('not found');
});

server.listen(config.port, () => {
  console.log(`cuda-lab backend on http://localhost:${config.port}`);
});
