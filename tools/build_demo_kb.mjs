// Build a redistributable demo knowledge base (public-domain / gov / Apache-2.0 sources only).
import fs from 'node:fs';
import path from 'node:path';

const KB = 'D:/mini-14/web/kb';
const OUT = 'D:/mini-14/tools/demo-kb';
const DIM = 1024;

const KEEP_SOURCES = new Set([
  'Project Gutenberg',            // public domain
  '中国政府网',                    // government documents
  '中共中央党史和文献研究院',        // official documents
  'KdConv 日常对话语料'            // Apache-2.0
]);

fs.mkdirSync(OUT, { recursive: true });

const kb = JSON.parse(fs.readFileSync(path.join(KB, 'chunks.json'), 'utf8'));
const vecBuf = fs.readFileSync(path.join(KB, 'vectors.f32'));
if (vecBuf.length !== kb.items.length * DIM * 4) { console.error('vectors misaligned'); process.exit(1); }
const src = new Float32Array(vecBuf.buffer, vecBuf.byteOffset, vecBuf.length / 4);

const keep = [];
const items = [];
kb.items.forEach((it, i) => {
  if (!KEEP_SOURCES.has(it.source)) return;
  keep.push(i);
  items.push(it);
});

const outVec = new Float32Array(keep.length * DIM);
keep.forEach((idx, j) => outVec.set(src.subarray(idx * DIM, (idx + 1) * DIM), j * DIM));

const demo = {
  built: new Date().toISOString().slice(0, 10),
  count: items.length,
  chars: items.reduce((n, x) => n + x.text.length, 0),
  topics: {},
  items,
  note: 'demo KB: Project Gutenberg (public domain) + 中国政府网/党史文献 (government documents) + KdConv (Apache-2.0)'
};
for (const it of items) demo.topics[it.topic] = (demo.topics[it.topic] || 0) + 1;

fs.writeFileSync(path.join(OUT, 'chunks.json'), JSON.stringify(demo), 'utf8');
fs.writeFileSync(path.join(OUT, 'vectors.f32'), Buffer.from(outVec.buffer));
fs.writeFileSync(path.join(OUT, 'vectors.json'), JSON.stringify({ model: 'bge-m3', dim: DIM, count: items.length }), 'utf8');
fs.writeFileSync(path.join(OUT, 'SOURCES.md'), `# mini-14 demo knowledge base

本数据库只包含可再分发的内容：

| 来源 | 数量 | 许可 |
|---|---:|---|
| Project Gutenberg（中文公版书） | - | Public Domain |
| 中国政府网（政策文件/白皮书） | - | 政府文件，不受著作权保护 |
| 中共中央党史和文献研究院（大事记） | - | 官方文件 |
| KdConv（中文多轮对话） | - | Apache-2.0（https://github.com/thu-coai/KdConv） |

完整数据库（含萌娘百科等其他来源）不在此分发范围内。
`, 'utf8');

console.log('demo chunks:', items.length, 'chars:', demo.chars, 'topics:', JSON.stringify(demo.topics));
