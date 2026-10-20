// Bulk import a JSONL of {name,text,url?,source?,topic?} documents into the KB.
// Uses a small pool of concurrent embedding requests for speed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';

const ROOT = 'D:\\mini-14';
const KB = path.join(ROOT, 'web', 'kb');
const CHUNKS = path.join(KB, 'chunks.json');
const VECTORS = path.join(KB, 'vectors.f32');
const VMETA = path.join(KB, 'vectors.json');
const CHUNK = 620;
const BATCH = 4;
const WORKERS = 4;

const src = process.argv[2];
const topicOverride = process.argv[3];
if (!src) { console.error('usage: node import_jsonl.mjs <file.jsonl> [topic]'); process.exit(1); }

const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

function chunkText(text) {
  const paras = text.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of paras) {
    if ((cur.length + p.length + 2) <= CHUNK) cur = cur ? cur + '\n\n' + p : p;
    else {
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

function embedBatch(texts) {
  const payload = JSON.stringify({ model: 'bge-m3', input: texts });
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: 18016, path: '/v1/embeddings', method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Connection': 'close' }
    }, (res) => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).data.map(d => d.embedding)); }
        catch (e) { reject(new Error('bad json ' + data.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => req.destroy(new Error('embed timeout')));
    req.write(payload); req.end();
  });
}

const kb = JSON.parse(fs.readFileSync(CHUNKS, 'utf8'));
const meta = JSON.parse(fs.readFileSync(VMETA, 'utf8'));
const dim = meta.dim;
if (fs.statSync(VECTORS).size !== kb.items.length * dim * 4) {
  console.error('vectors count mismatch, rebuild first');
  process.exit(1);
}

const known = new Set(kb.items.map(x => x.sha1 || sha1(x.text)));
const docs = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const fresh = [];
const today = new Date().toISOString().slice(0, 10);

for (const d of docs) {
  const name = (d.name || d.title || '未命名').replace(/\.(txt|md|html?)$/i, '');
  const text = d.text || '';
  if (text.length < 100) continue;
  const slug = 'imp-' + sha1(name + text).slice(0, 10);
  let i = 0;
  for (const c of chunkText(text)) {
    const h = sha1(c);
    if (known.has(h)) continue;
    known.add(h);
    fresh.push({
      id: `${slug}-${String(i).padStart(3, '0')}`,
      doc_id: slug,
      topic: topicOverride || d.topic || 'custom',
      title: name,
      url: d.url || '',
      source: d.source || '本地导入',
      published: d.published || today,
      lang: 'zh',
      text: c
    });
    i++;
  }
}
console.log('docs', docs.length, 'new chunks', fresh.length);
if (!fresh.length) process.exit(0);

const batches = [];
for (let i = 0; i < fresh.length; i += BATCH) batches.push(fresh.slice(i, i + BATCH));
const results = new Array(batches.length);
let nextBatch = 0, done = 0;
const t0 = Date.now();

async function worker() {
  while (true) {
    const idx = nextBatch++;
    if (idx >= batches.length) return;
    const batch = batches[idx];
    let attempt = 0, vs;
    while (true) {
      try { vs = await embedBatch(batch.map(x => x.title + '\n' + x.text)); break; }
      catch (e) { if (++attempt >= 3) throw e; await new Promise(r => setTimeout(r, 500)); }
    }
    results[idx] = vs;
    done += batch.length;
    if (done % 160 < BATCH) {
      const sec = (Date.now() - t0) / 1000;
      process.stdout.write(`\r${done}/${fresh.length}  ${(done / sec).toFixed(1)}/s   `);
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, () => worker()));
process.stdout.write(`\r${fresh.length}/${fresh.length}   \n`);

const vecs = [];
for (const vs of results) for (const v of vs) {
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  vecs.push(Float32Array.from(v, x => x / n));
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
console.log('done: total', kb.count, 'chars', kb.chars);
