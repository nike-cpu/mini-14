// mini-14 training service: launches tools/trainer.py and reports progress from a log file
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = 'D:\\mini-14';
const PY = path.join(ROOT, 'runtime', 'py', 'Scripts', 'python.exe');
const TRAINER = path.join(ROOT, 'tools', 'trainer.py');
const KB = path.join(ROOT, 'web', 'kb', 'chunks.json');
const STORAGE = path.join(ROOT, 'storage');
const LOG = path.join(STORAGE, 'logs', 'train.jsonl');
const OUT = path.join(STORAGE, 'models', 'model.npz');
const CKPT = path.join(STORAGE, 'checkpoints');
const SCORE_PY = path.join(ROOT, 'tools', 'score.py');
const TMP = path.join(STORAGE, 'logs', 'score-in.json');
const MAX_GB = 2;
const PORT = 18019;

let child = null;
let startedAt = 0;
let exitCode = null;
let lastError = null;

function readState() {
  const st = { running: !!child, step: 0, total: 0, loss: null, samples: [], info: null, done: false, error: lastError, sec: 0, history: [] };
  try {
    const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      let o;
      try { o = JSON.parse(l); } catch { continue; }
      if (o.type === 'info') st.info = { vocab: o.vocab, chars: o.chars, params: o.params };
      else if (o.type === 'step') { st.step = o.step; st.total = o.total; st.loss = o.loss; st.sec = o.sec; st.history.push({ step: o.step, loss: o.loss }); }
      else if (o.type === 'sample') { st.samples.push({ step: o.step, text: o.text }); if (st.samples.length > 4) st.samples.shift(); }
      else if (o.type === 'done') { st.done = true; st.loss = o.loss; st.sec = o.sec; }
      else if (o.type === 'error') { st.error = o.message; }
    }
  } catch {}
  if (!st.total) st.total = 600;
  return st;
}

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // only the local chat UI may call state-changing endpoints (CSRF guard)
  const __origin = req.headers.origin || '';
  const __allowed = /^https?:\/\/(127\.0\.0\.1|localhost):18014$/.test(__origin);
  if (req.method === 'POST' && __origin && !__allowed) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }));
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type'
    });
    return res.end();
  }
  if (req.method === 'GET' && req.url.startsWith('/health')) return json(res, 200, { status: 'ok' });

  if (req.method === 'GET' && req.url.startsWith('/storage')) {
    function dirSize(p) {
      let total = 0;
      try { for (const f of fs.readdirSync(p, { withFileTypes: true })) {
        const fp = path.join(p, f.name);
        if (f.isDirectory()) total += dirSize(fp);
        else try { total += fs.statSync(fp).size; } catch {}
      } } catch {}
      return total;
    }
    const used = dirSize(STORAGE);
    return json(res, 200, { usedMB: Math.round(used / 1e6 * 10) / 10, budgetGB: MAX_GB,
      usedPct: Math.round(used / (MAX_GB * 1e9) * 1000) / 10,
      models: fs.existsSync(OUT), checkpoints: fs.existsSync(CKPT) ? fs.readdirSync(CKPT).length : 0 });
  }

  if (req.method === 'GET' && req.url.startsWith('/status')) {
    const st = readState();
    st.exitCode = exitCode;
    return json(res, 200, st);
  }

  if (req.method === 'POST' && req.url.startsWith('/stop')) {
    if (child) { try { child.kill(); } catch {} }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url.startsWith('/score')) {
    let body = '';
    req.on('data', b => { body += b; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        const o = JSON.parse(body || '{}');
        const texts = (o.texts || []).slice(0, 12).map(t => String(t).slice(0, 1200));
        if (!fs.existsSync(OUT)) return json(res, 400, { ok: false, error: '还没有训练好的模型' });
        fs.mkdirSync(path.dirname(TMP), { recursive: true });
        fs.writeFileSync(TMP, JSON.stringify({ model: OUT, texts }), 'utf8');
        const child = spawn(PY, [SCORE_PY, TMP], { windowsHide: true });
        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { out += d; });
        child.on('exit', () => {
          try { json(res, 200, JSON.parse(out)); }
          catch { json(res, 500, { ok: false, error: 'score failed: ' + out.slice(0, 120) }); }
        });
      } catch (e) {
        json(res, 500, { ok: false, error: String(e.message || e) });
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/start')) {
    if (child) return json(res, 409, { ok: false, error: '正在训练中' });
    if (!fs.existsSync(PY)) return json(res, 500, { ok: false, error: '训练环境没装好（runtime\\py）' });

    let body = '';
    req.on('data', b => { body += b; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      let steps = 600;
      try { const o = JSON.parse(body || '{}'); if (o.steps) steps = Math.max(100, Math.min(50000, parseInt(o.steps, 10))); } catch {}
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
      fs.writeFileSync(LOG, '');
      lastError = null;
      exitCode = null;
      startedAt = Date.now();
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.mkdirSync(CKPT, { recursive: true });
      const fd = fs.openSync(LOG, 'a');
      child = spawn(PY, [TRAINER, '--kb', KB, '--out', OUT, '--steps', String(steps),
        '--resume', '--ckpt-dir', CKPT, '--ckpt-every', '100', '--max-gb', String(MAX_GB)],
        { stdio: ['ignore', fd, fd], windowsHide: true });
      child.on('exit', (code) => {
        exitCode = code;
        child = null;
        try { fs.closeSync(fd); } catch {}
      });
      child.on('error', (e) => { lastError = String(e.message || e); child = null; });
      json(res, 200, { ok: true, steps });
    });
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mini-14 train service on http://127.0.0.1:${PORT}`);
});
