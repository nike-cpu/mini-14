// Compute chunk embeddings with the local bge-m3 server -> web/kb/vectors.f32
import fs from 'node:fs';

const KB = 'D:\\mini-14\\web\\kb\\chunks.json';
const OUT = 'D:\\mini-14\\web\\kb\\vectors.f32';
const ENDPOINT = process.env.EMBED_URL || 'http://127.0.0.1:18016/v1/embeddings';
const BATCH = 8;

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

const vectors = [];
let dim = 0;
for (let i = 0; i < items.length; i += BATCH) {
  const batch = items.slice(i, i + BATCH);
  const texts = batch.map(x => x.title + '\n' + x.text);
  const vecs = await embed(texts);
  if (!dim) dim = vecs[0].length;
  for (const v of vecs) {
    if (v.length !== dim) throw new Error('dim mismatch');
    // L2 normalize so dot product == cosine
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    vectors.push(Float32Array.from(v, x => x / n));
  }
  process.stdout.write(`\r${Math.min(i + BATCH, items.length)}/${items.length}`);
}

const flat = new Float32Array(vectors.length * dim);
vectors.forEach((v, i) => flat.set(v, i * dim));
fs.writeFileSync(OUT, Buffer.from(flat.buffer));
fs.writeFileSync(OUT.replace('.f32', '.json'), JSON.stringify({ model: 'bge-m3', dim, count: vectors.length }));
console.log(`\nsaved ${vectors.length} x ${dim} -> ${OUT}`);
