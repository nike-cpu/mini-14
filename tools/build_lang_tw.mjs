// Build web/lang-tw.js (OpenCC STPhrases + STCharacters) and wire it into index.html.
import fs from 'node:fs';

const stp = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/stp.txt', 'utf8');
const stc = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/stc.txt', 'utf8');

const phrases = {};
let maxLen = 2;
for (const line of stp.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const [s, t] = line.split('\t');
  if (!s || !t) continue;
  phrases[s] = t.split(' ')[0];
  if (s.length > maxLen) maxLen = s.length;
}

const chars = {};
for (const line of stc.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const [s, t] = line.split('\t');
  if (!s || !t) continue;
  chars[s] = t.split(' ')[0];
}

const js = 'window.M14_MAXP=' + maxLen + ';\nwindow.M14_STP=' + JSON.stringify(phrases) + ';\nwindow.M14_TS=' + JSON.stringify(chars) + ';\n';
fs.writeFileSync('D:/mini-14/web/lang-tw.js', js, 'utf8');
console.log('lang-tw.js bytes:', js.length, 'phrases:', Object.keys(phrases).length, 'chars:', Object.keys(chars).length, 'maxLen:', maxLen);

// index.html: drop the embedded char map, load the external file, upgrade toTW
const p = 'D:/mini-14/web/index.html';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/<script>window\.M14_TS=[\s\S]*?<\/script>\n/, '');
s = s.replace('<script>\nconst $ = (s) => document.querySelector(s);', '<script src="lang-tw.js?v=1"></script>\n<script>\nconst $ = (s) => document.querySelector(s);');

const newToTW = String.raw`function toTW(t){
  const P = window.M14_STP, C = window.M14_TS, max = window.M14_MAXP || 2;
  if (!C || !t) return t;
  let out = '', i = 0;
  while (i < t.length){
    let matched = false;
    for (let L = Math.min(max, t.length - i); L >= 2; L--){
      const sub = t.substr(i, L);
      if (P && P[sub]) { out += P[sub]; i += L; matched = true; break; }
    }
    if (matched) continue;
    const ch = t[i];
    out += C[ch] || ch;
    i++;
  }
  return out;
}`;
const oldToTW = String.raw`function toTW(t){
  const m = window.M14_TS;
  if (!m || !t) return t;
  let out = '';
  for (const ch of t) out += (m[ch] || ch);
  return out;
}`;
if (!s.includes(oldToTW)) { console.error('old toTW not found'); process.exit(1); }
s = s.replace(oldToTW, newToTW);
fs.writeFileSync(p, s, 'utf8');
console.log('index.html wired to lang-tw.js');
