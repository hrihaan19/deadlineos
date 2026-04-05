import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

// Load .env if present
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.trim().split('=');
    if (k && !k.startsWith('#')) process.env[k] = v.join('=');
  }
} catch { /* no .env, that's fine */ }

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function proxyClaudeAPI(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }

    const { system, messages, stream, apiKey } = parsed;
    const key = apiKey || process.env.ANTHROPIC_API_KEY;

    if (!key) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No ANTHROPIC_API_KEY in environment or request. Add it to .env or enter in Settings.' }));
    }

    const anthropicBody = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages,
      stream: !!stream,
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(anthropicBody),
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
    };

    const upstream = https.request(options, (upRes) => {
      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        let buffer = '';
        upRes.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const p = JSON.parse(line.slice(6));
                if (p.type === 'content_block_delta' && p.delta?.type === 'text_delta') {
                  res.write(`data: ${JSON.stringify({ text: p.delta.text })}\n\n`);
                }
              } catch { /* skip */ }
            }
          }
        });
        upRes.on('end', () => {
          res.write('data: [DONE]\n\n');
          res.end();
        });
      } else {
        let data = '';
        upRes.on('data', (chunk) => (data += chunk));
        upRes.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.content?.[0]?.text || '';
            res.writeHead(upRes.statusCode || 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ text }));
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to parse upstream response', raw: data }));
          }
        });
      }
    });

    upstream.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    upstream.write(anthropicBody);
    upstream.end();
  });
}

const server = http.createServer((req, res) => {
  // Claude API proxy
  if (req.url === '/api/claude') {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(200);
      return res.end();
    }
    if (req.method === 'POST') return proxyClaudeAPI(req, res);
  }

  // Static files
  let urlPath = req.url === '/' ? '/landing.html' : req.url;
  urlPath = urlPath.split('?')[0];
  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`DeadlineOS dev server → http://localhost:${PORT}`);
  console.log(`Claude API proxy  → http://localhost:${PORT}/api/claude`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`⚠  ANTHROPIC_API_KEY not set — add it to .env or enter in Settings`);
  }
});
