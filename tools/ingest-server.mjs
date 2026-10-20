// mini-14 import server: receives documents from the browser, embeds and appends them
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const ROOT = 'D:\\mini-14';
const KB = path.join(ROOT, 'web', 'kb');
const CHUNKS = path.join(KB, 'chunks.json');
const VECTORS = path.join(KB, 'vectors.f32');
const VMETA = path.join(KB, 'vectors.json');
const PORT = 18018;
const EMBED_URL = 'http://127.0.0.1:18016/v1/embeddings';
const CHUNK = 620;
const MAX_BODY = 40 * 1024 * 1024;

const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
process.on('uncaughtException', (e) => {
  try { fs.appendFileSync(path.join(ROOT, 'logs', 'ingest.err.log'), '[uncaught] ' + ((e && e.stack) || e) + '\n'); } catch {}
});
process.on('unhandledRejection', (e) => {
  try { fs.appendFileSync(path.join(ROOT, 'logs', 'ingest.err.log'), '[rejection] ' + ((e && e.stack) || e) + '\n'); } catch {}
});
const SHA = path.join(ROOT, 'tools', 'shard_kb.mjs');
let rebuildTimer = null;
function scheduleRebuild(){
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    try {
      const child = spawn(process.execPath, [SHA], { cwd: ROOT, stdio: 'ignore', detached: true });
      child.unref();
    } catch (e) {}
  }, 2500);
}

const INBOX = path.join(ROOT, 'inbox');
const DONE_DIR = path.join(INBOX, '已导入');

function extractSavedPage(html) {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim() : '';
  const descM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
             || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  const desc = descM ? descM[1].trim() : '';
  let short = '';
  const sd = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (sd) { try { short = JSON.parse('"' + sd[1] + '"'); } catch {} }
  const body = stripHtml(html).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text: [title, desc, short, body.slice(0, 60000)].filter(Boolean).join('\n\n') };
}

function stripHtml(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|br|li|h[1-6]|tr|td|section|article|title)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function chunkText(text) {
  const paras = text.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of paras) {
    if ((cur.length + p.length + 2) <= CHUNK) {
      cur = cur ? cur + '\n\n' + p : p;
    } else {
      if (cur) out.push(cur);
      if (p.length <= CHUNK) cur = p;
      else {
        const parts = p.split(/(?<=[。！？；.!?])/);
        let buf = '';
        for (const s of parts) {
          if ((buf.length + s.length) <= CHUNK) buf += s;
          else { if (buf) out.push(buf); buf = s.slice(0, CHUNK); }
        }
        cur = buf;
      }
    }
  }
  if (cur) out.push(cur);
  return out.filter(c => c.length >= 30);
}

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

async function embed(texts) {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: texts })
  });
  if (!res.ok) throw new Error('embedding ' + res.status + ' ' + (await res.text()).slice(0, 120));
  const j = await res.json();
  return j.data.map(d => d.embedding);
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

async function addDoc({ name, text, url = '', source = '网页导入', topic = 'custom', published = '' }) {
  const kb = readJSON(CHUNKS, null);
  if (!kb) throw new Error('chunks.json 读不到');
  const meta = readJSON(VMETA, { dim: 1024, count: kb.items.length });

  const known = new Set(kb.items.map(x => x.sha1 || sha1(x.text)));
  const slug = 'local-' + sha1(name + text).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const chunks = chunkText(text);
  const fresh = [];
  let idx = 0;
  for (const c of chunks) {
    const h = sha1(c);
    if (known.has(h)) continue;
    known.add(h);
    fresh.push({
      id: `${slug}-${String(idx).padStart(3, '0')}`,
      doc_id: slug,
      topic,
      title: name,
      url,
      source,
      published: published || today,
      lang: 'zh',
      text: c
    });
    idx++;
  }
  if (!fresh.length) return { added: 0, total: kb.items.length, duplicate: true };

  // embed in batches
  const dim = meta.dim || 1024;
  const vecs = [];
  const B = 8;
  for (let i = 0; i < fresh.length; i += B) {
    const batch = fresh.slice(i, i + B).map(x => x.title + '\n' + x.text);
    const vs = await embed(batch);
    for (const v of vs) {
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n) || 1;
      vecs.push(Float32Array.from(v, x => x / n));
    }
  }

  // align check before appending
  const expected = kb.items.length * dim * 4;
  if (fs.statSync(VECTORS).size !== expected) {
    throw new Error('向量文件与条目数不一致，请先重建索引');
  }
  const flat = new Float32Array(vecs.length * dim);
  vecs.forEach((v, i) => flat.set(v, i * dim));
  fs.appendFileSync(VECTORS, Buffer.from(flat.buffer));

  kb.items.push(...fresh);
  kb.count = kb.items.length;
  kb.chars = kb.items.reduce((n, x) => n + x.text.length, 0);
  kb.topics = {};
  for (const it of kb.items) kb.topics[it.topic] = (kb.topics[it.topic] || 0) + 1;
  kb.built = today;
  fs.writeFileSync(CHUNKS, JSON.stringify(kb), 'utf8');
  fs.writeFileSync(VMETA, JSON.stringify({ model: 'bge-m3', dim, count: kb.count }), 'utf8');

  return { added: fresh.length, total: kb.count };
}


const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function stripTags(x) {
  return String(x || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

async function search360(q) {
  const url = 'https://www.so.com/s?q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': SEARCH_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('so.com ' + r.status);
  const h = await r.text();
  const out = [];
  for (const m of h.matchAll(/<li[^>]*class="[^"]*res-list[^"]*"[\s\S]*?<\/li>/g)) {
    const block = m[0];
    const a = block.match(/<a[^>]*data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const desc = block.match(/<p class="res-desc">([\s\S]*?)<\/p>/);
    if (!a) continue;
    const title = stripTags(a[2]);
    const snippet = desc ? stripTags(desc[1]) : '';
    if (!title) continue;
    out.push({ title, url: a[1], snippet });
    if (out.length >= 6) break;
  }
  return out;
}

async function searchBing(q) {
  const url = 'https://cn.bing.com/search?q=' + encodeURIComponent(q) + '&mkt=zh-CN';
  const r = await fetch(url, { headers: { 'User-Agent': SEARCH_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('bing ' + r.status);
  const h = await r.text();
  const out = [];
  for (const m of h.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)) {
    const block = m[0];
    const a = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const pEl = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (!a) continue;
    out.push({ title: stripTags(a[2]), url: a[1], snippet: pEl ? stripTags(pEl[1]) : '' });
    if (out.length >= 6) break;
  }
  return out;
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  if (req.method === 'GET' && req.url.startsWith('/health')) {
    return json(res, 200, { status: 'ok' });
  }
  if (req.method === 'POST' && req.url.startsWith('/add')) {
    const parts = [];
    let size = 0;
    req.on('data', (b) => {
      size += b.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      parts.push(b);
    });
    req.on('end', async () => {
      try {
        const raw = Buffer.concat(parts).toString('utf8');
        const body = JSON.parse(raw);
        if (!body.text || !body.name) return json(res, 400, { ok: false, error: 'name/text 不能为空' });
        let text = body.text;
        if (/\.(html?|htm)$/i.test(body.name)) text = stripHtml(text);
        const r = await addDoc({
          name: body.name.replace(/\.(txt|md|markdown|html?|htm|csv)$/i, ''),
          text,
          url: body.url || '',
          source: body.source || '网页导入',
          topic: body.topic || 'custom'
        });
        scheduleRebuild();
        json(res, 200, { ok: true, rebuilding: true, ...r });
      } catch (e) {
        json(res, 500, { ok: false, error: String(e.message || e) });
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url.startsWith('/scan-inbox')) {
    (async () => {
      try {
        fs.mkdirSync(DONE_DIR, { recursive: true });
        const files = fs.readdirSync(INBOX).filter(f => /\.(txt|md|markdown|html?|htm|csv)$/i.test(f) && fs.statSync(path.join(INBOX, f)).isFile());
        let added = 0, done = 0;
        const errors = [];
        for (const f of files) {
          const full = path.join(INBOX, f);
          let raw;
          try { raw = fs.readFileSync(full, 'utf8'); } catch { errors.push(f + ': 读取失败'); continue; }
          let name = f.replace(/\.(txt|md|markdown|html?|htm|csv)$/i, '');
          let text = raw;
          if (/\.html?$/i.test(f)) {
            const p = extractSavedPage(raw);
            text = p.text;
            if (p.title) name = p.title;
          }
          if (text.trim().length < 80) { errors.push(f + ': 内容太少'); continue; }
          const r = await addDoc({ name, text, source: '网页存档', topic: 'web' });
          added += r.added;
          done++;
          try { fs.renameSync(full, path.join(DONE_DIR, f)); } catch {}
        }
        if (added > 0) scheduleRebuild();
        json(res, 200, { ok: true, files: done, added, errors, rebuilding: added > 0 });
      } catch (e) {
        json(res, 500, { ok: false, error: String(e.message || e) });
      }
    })();
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/websearch')) {
    (async () => {
      try {
        const q = new URL(req.url, 'http://127.0.0.1').searchParams.get('q') || '';
        if (!q.trim()) return json(res, 400, { ok: false, error: 'q 不能为空' });
        let results = [];
        try { results = await search360(q); } catch (e) { results = []; }
        if (!results.length) { try { results = await searchBing(q); } catch (e) {} }
        json(res, 200, { ok: true, q, count: results.length, results });
      } catch (e) {
        json(res, 500, { ok: false, error: String(e.message || e) });
      }
    })();
    return;
  }
  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mini-14 import server on http://127.0.0.1:${PORT}`);
});
