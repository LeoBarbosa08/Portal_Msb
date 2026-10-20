// Troca a família azul/navy da Biomedical pelo teal da MSB (#56A4BB, matiz ~194°).
// Regra: cor com matiz azul (197°–232°; índigo/roxo de categoria fica) e croma visível → matiz teal, saturação
// reduzida (a MSB é mais sóbria) e a MESMA luminância relativa (WCAG) da original,
// para não mexer em nenhum contraste (texto sobre fundo, botão, tema escuro).
// Cinzas neutros, verdes, âmbar, vermelho, violeta e o teal/ciano que já existe ficam.
// Uso: node scripts/msb-cores.js . [--write] arquivo1 [arquivo2 ...]
//   sem --write = só relatório. SÓ em arquivos que acabaram de vir do portal completo
//   (ainda azuis): a conversão NÃO é idempotente — rodar de novo num arquivo já
//   convertido acinzenta os cinzas frios. Ver README › Identidade visual MSB.
const fs = require('fs'), path = require('path');
const RAIZ = process.argv[2];
const WRITE = process.argv.includes('--write');
const EXCLUI = new Set(['cotacoes-proposta.js']);   // proposta em PDF fica com o timbrado atual

const LISTA = process.argv.slice(3).filter(a => !a.startsWith('--'));
if (!LISTA.length) { console.error('Informe os arquivos (só os que vieram agora do portal completo). Ver o cabeçalho.'); process.exit(1); }
const files = LISTA.map(f => f.replace(/\\/g, '/'))
  .filter(f => /\.(css|html|js|webmanifest)$/.test(f) && !f.startsWith('api/') && !EXCLUI.has(path.basename(f)));

const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const Y = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function toHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  let h = 0; const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) { if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
  if (h < 0) h += 360;
  return { h, s, l, c: d };
}
function fromHsl(h, s, l) {
  const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - C / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [C, X, 0]; else if (h < 120) [r, g, b] = [X, C, 0]; else if (h < 180) [r, g, b] = [0, C, X];
  else if (h < 240) [r, g, b] = [0, X, C]; else if (h < 300) [r, g, b] = [X, 0, C]; else [r, g, b] = [C, 0, X];
  return [r + m, g + m, b + m].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
}
// azuis de marcas de terceiros (logo/botão da Microsoft): não mudam
const PROTEGE = new Set(['0,164,239', '0,120,212', '16,110,190']);
const MEMO = new Map();
function msb(r, g, b) {
  const key = r + ',' + g + ',' + b;
  if (MEMO.has(key)) return MEMO.get(key);
  const k = toHsl(r, g, b);
  let out = null;
  if (k.c >= 0.03 && k.h >= 197 && k.h <= 232 && !PROTEGE.has(key)) {
    // cor viva → teal da marca (194°); cinza-azulado → cinza frio (203°), sem esverdear
    const t = Math.min(1, Math.max(0, (k.c - 0.03) / 0.32));
    const h = (203 - 9 * t) + (k.h - 214) * 0.3;
    // escuros guardam mais saturação (navy → petróleo, não quase-preto)
    const s = Math.min(k.s * Math.min(0.8, Math.max(0.5, 0.5 + 0.3 * (1 - k.l) * (0.4 + 0.6 * t))), 0.62);
    const alvo = Y(r, g, b);
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; const c = fromHsl(h, s, mid); if (Y(...c) < alvo) lo = mid; else hi = mid; }
    out = fromHsl(h, s, (lo + hi) / 2);
  }
  MEMO.set(key, out);
  return out;
}
const hex2 = n => n.toString(16).padStart(2, '0');

const HEX = /(#|%23)([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const RGB = /(rgba?\(\s*)(\d{1,3})(\s*,\s*)(\d{1,3})(\s*,\s*)(\d{1,3})/g;
const report = new Map();   // "antes → depois" → contagem
const suspeitos = [];
let totalArq = 0, totalTroca = 0;

for (const f of files) {
  const p = path.join(RAIZ, f);
  const src = fs.readFileSync(p, 'utf8');
  let n = 0;
  let out = src.replace(HEX, (m, pre, hx, off, all) => {
    const full = hx.length === 3 ? hx.split('').map(c => c + c).join('') : hx;
    const v = parseInt(full, 16);
    const res = msb(v >> 16, (v >> 8) & 255, v & 255);
    if (!res) return m;
    const ctx = all.slice(Math.max(0, off - 12), off);
    if (/href=["']?$|url\(["']?$|location\.hash|['"]\/?$/.test(ctx) && pre === '#' && !/(color|fill|stroke|background|border|:\s*|,\s*)['"]?$/i.test(ctx))
      suspeitos.push(f + ': …' + all.slice(Math.max(0, off - 40), off + 10).replace(/\s+/g, ' '));
    let novo = res.map(hex2).join('');
    if (hx === hx.toUpperCase()) novo = novo.toUpperCase();
    report.set('#' + full.toUpperCase() + ' → #' + novo.toUpperCase(), (report.get('#' + full.toUpperCase() + ' → #' + novo.toUpperCase()) || 0) + 1);
    n++;
    return pre + novo;
  });
  out = out.replace(RGB, (m, a, r, s1, g, s2, b) => {
    const res = msb(+r, +g, +b);
    if (!res) return m;
    const k = 'rgb(' + r + ',' + g + ',' + b + ') → rgb(' + res.join(',') + ')';
    report.set(k, (report.get(k) || 0) + 1);
    n++;
    return a + res[0] + s1 + res[1] + s2 + res[2];
  });
  if (n) { totalArq++; totalTroca += n; if (WRITE) fs.writeFileSync(p, out); }
}

const linhas = [...report.entries()].sort((a, b) => b[1] - a[1]);
console.log((WRITE ? 'GRAVADO' : 'SIMULAÇÃO') + ': ' + totalTroca + ' trocas em ' + totalArq + ' arquivos, ' + linhas.length + ' cores distintas');
linhas.slice(0, 70).forEach(([k, v]) => console.log(String(v).padStart(4) + '  ' + k));
if (suspeitos.length) { console.log('\nSUSPEITOS (não parecem cor):'); suspeitos.forEach(s => console.log('  ' + s)); }

