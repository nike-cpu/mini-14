// Split the knowledge base into per-topic shards + manifest + topic centroids.
import fs from 'node:fs';
import path from 'node:path';

const KB = 'D:\\mini-14\\web\\kb';
const SHARD_DIR = path.join(KB, 'shards');
const DIM = 1024;

const chunks = JSON.parse(fs.readFileSync(path.join(KB, 'chunks.json'), 'utf8'));
const vecBuf = fs.readFileSync(path.join(KB, 'vectors.f32'));
const total = chunks.items.length;
if (vecBuf.length !== total * DIM * 4) {
  console.error('vectors misaligned', vecBuf.length, total * DIM * 4);
  process.exit(1);
}
const vecs = new Float32Array(vecBuf.buffer, vecBuf.byteOffset, vecBuf.length / 4);

fs.mkdirSync(SHARD_DIR, { recursive: true });

const byTopic = new Map();
chunks.items.forEach((it, i) => {
  const t = it.topic || 'general';
  if (!byTopic.has(t)) byTopic.set(t, []);
  byTopic.get(t).push(i);
});

const manifest = { dim: DIM, count: total, chars: chunks.chars, built: new Date().toISOString().slice(0, 10), topics: {}, shards: {} };
const centroidList = [];

const topics = [...byTopic.keys()].sort((a, b) => byTopic.get(b).length - byTopic.get(a).length);
for (const t of topics) {
  const idx = byTopic.get(t);
  const items = idx.map(i => chunks.items[i]);
  const chars = items.reduce((n, x) => n + x.text.length, 0);

  const arr = new Float32Array(idx.length * DIM);
  const sum = new Float32Array(DIM);
  idx.forEach((srcIdx, k) => {
    const off = srcIdx * DIM;
    for (let j = 0; j < DIM; j++) {
      const v = vecs[off + j];
      arr[k * DIM + j] = v;
      sum[j] += v;
    }
  });
  // normalised centroid
  let n = 0; for (let j = 0; j < DIM; j++) n += sum[j] * sum[j];
  n = Math.sqrt(n) || 1;
  const c = new Float32Array(DIM);
  for (let j = 0; j < DIM; j++) c[j] = sum[j] / n;
  centroidList.push(c);

  fs.writeFileSync(path.join(SHARD_DIR, t + '.json'), JSON.stringify(items), 'utf8');
  fs.writeFileSync(path.join(SHARD_DIR, t + '.f32'), Buffer.from(arr.buffer));

  manifest.topics[t] = { count: idx.length, chars };
  manifest.shards[t] = { json: 'kb/shards/' + t + '.json', vec: 'kb/shards/' + t + '.f32', count: idx.length };
  console.log(`${t.padEnd(16)} ${String(idx.length).padStart(6)} 条  ${(chars / 10000).toFixed(1).padStart(7)} 万字  ${(arr.byteLength / 1e6).toFixed(1)} MB`);
}

const cb = new Float32Array(topics.length * DIM);
centroidList.forEach((c, i) => cb.set(c, i * DIM));
fs.writeFileSync(path.join(KB, 'centroids.f32'), Buffer.from(cb.buffer));
manifest.centroidTopics = topics;
fs.writeFileSync(path.join(KB, 'manifest.json'), JSON.stringify(manifest), 'utf8');

console.log(`\nmanifest: ${total} 条 / ${(chunks.chars / 10000).toFixed(1)} 万字 / ${topics.length} 个分片`);
