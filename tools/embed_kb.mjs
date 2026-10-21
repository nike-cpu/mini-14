// Compute chunk embeddings with the local bge-m3 server -> web/kb/vectors.f32
import fs from 'node:fs';

const ROOT = process.env.MINI14_ROOT || 'D:\\mini-14';
const KB = ROOT + '\\web\\kb\\chunks.json';
const OUT = ROOT + '\\web\\kb\\vectors.f32';
const ENDPOINT = process.env.EMBED_URL || 'http://127.0.0.1:18016/v1/embeddings';
const BATCH = 4;

const kb = JSON.parse(fs.readFileSync(KB, 'utf8'));
const items = kb.items;

async function embed(texts) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: texts })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  return j.data.map(d => d.embedding);
}

const vectors = new Array(items.length);
let dim = 0, done = 0;
const WORKERS = 4;
const total = Math.ceil(items.length / BATCH);
let nextBatch = 0;

async function worker() {
  while (true) {
    const bi = nextBatch++;
    if (bi >= total) return;
    const start = bi * BATCH;
    const batch = items.slice(start, start + BATCH);
    let attempt = 0, vecs;
    while (true) {
      try { vecs = await embed(batch.map(x => x.title + '\n' + x.text)); break; }
      catch (e) { if (++attempt >= 3) throw e; await new Promise(r => setTimeout(r, 400)); }
    }
    if (!dim) dim = vecs[0].length;
    vecs.forEach((v, k) => {
      if (v.length !== dim) throw new Error('dim mismatch');
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n) || 1;
      vectors[start + k] = Float32Array.from(v, x => x / n);
    });
    done += vecs.length;
    process.stdout.write(`\r${done}/${items.length}   `);
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()));

const flat = new Float32Array(vectors.length * dim);
vectors.forEach((v, i) => flat.set(v, i * dim));
fs.writeFileSync(OUT, Buffer.from(flat.buffer));
fs.writeFileSync(OUT.replace('.f32', '.json'), JSON.stringify({ model: 'bge-m3', dim, count: vectors.length }));
console.log(`\nsaved ${vectors.length} x ${dim} -> ${OUT}`);
