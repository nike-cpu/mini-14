// Build the mini-14 knowledge base from one or more rag_chunks.jsonl files.
// Usage: node build_kb.mjs <file1.jsonl> [file2.jsonl ...]
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = 'D:\\mini-14\\web\\kb';
const inputs = process.argv.slice(2);
if (!inputs.length) { console.error('usage: node build_kb.mjs <a.jsonl> [b.jsonl ...]'); process.exit(1); }

const seenSha = new Set();
const seenId = new Set();
const items = [];
let seq = 0;

for (const file of inputs) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim());
  let added = 0, skipped = 0;
  for (const line of lines) {
    const r = JSON.parse(line);
    const sha = r.sha1 || '';
    if (sha && seenSha.has(sha)) { skipped++; continue; }
    if (r.id && seenId.has(r.id)) { skipped++; continue; }
    if (sha) seenSha.add(sha);
    if (r.id) seenId.add(r.id);
    items.push({
      id: r.id,
      doc_id: r.doc_id,
      topic: r.topic,
      title: r.title,
      url: r.url || '',
      source: r.source || '',
      published: r.published || '',
      lang: r.lang || '',
      text: (r.text || '').replace(/\r/g, '').trim(),
      seq: seq++
    });
    added++;
  }
  console.log(`${path.basename(file)}: +${added} (dupes skipped ${skipped})`);
}

const topics = {};
for (const it of items) topics[it.topic] = (topics[it.topic] || 0) + 1;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'chunks.json'), JSON.stringify({
  built: new Date().toISOString().slice(0, 10),
  count: items.length,
  chars: items.reduce((n, x) => n + x.text.length, 0),
  topics,
  items
}), 'utf8');

console.log('total chunks:', items.length, 'topics:', JSON.stringify(topics));
