// Gera as imagens animadas do README do perfil. Roda no GitHub Actions uma vez por dia
// (.github/workflows/perfil.yml) e tambem pode rodar na mao: `node scripts/gerar.mjs`.
//
// Fontes, todas publicas:
//   - https://matheusansel.pages.dev/me.json  -> resumo do portfolio (cargo, stack, projetos, testes)
//   - https://brasil-econ-api.onrender.com     -> Selic, IPCA e juro real (API do brasil-econ-dashboard)
//   - API do GitHub                            -> ultimo commit e status do CI de cada projeto
//
// Se uma fonte falhar, a imagem correspondente nao e regravada: o README continua com a ultima
// versao boa em vez de mostrar erro. Sem dependencias: so Node 20.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = (name) => `${root}assets/gerado/${name}`;

const PORTFOLIO_JSON = 'https://matheusansel.pages.dev/me.json';
const ECON_API = 'https://brasil-econ-api.onrender.com';
const GH = 'https://api.github.com';

// --- tema ---------------------------------------------------------------------------------------

const THEMES = {
  dark: { bg: '#0a0a0a', panel: '#111111', border: '#262626', text: '#ededed', muted: '#8b8b8b', faint: '#3a3a3a', strong: '#ffffff', ok: '#ededed', bad: '#ff6b6b' },
  light: { bg: '#ffffff', panel: '#f6f8fa', border: '#d0d7de', text: '#1f2328', muted: '#59636e', faint: '#d8dee4', strong: '#000000', ok: '#1f2328', bad: '#cf222e' },
};

const FONT_SIZE = 13;
const CHAR_W = FONT_SIZE * 0.6; // JetBrains Mono: 600 de avanco em 1000 unidades
const LINE_H = 21;
const CARD_H = 330; // os dois cartoes ficam lado a lado no README: mesma altura

function fontFace() {
  const b64 = (w) => readFileSync(`${root}assets/fonts/jetbrains-mono-${w}.woff2`).toString('base64');
  return `@font-face{font-family:JBM;font-weight:400;src:url(data:font/woff2;base64,${b64(400)}) format('woff2')}
@font-face{font-family:JBM;font-weight:700;src:url(data:font/woff2;base64,${b64(700)}) format('woff2')}`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 1000) / 1000;

const dataBR = (iso) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const diaMes = (iso) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const pct = (n) => `${n.toFixed(2).replace('.', ',')}%`;

// --- rede ---------------------------------------------------------------------------------------

async function getJson(url, { tries = 1, timeoutMs = 20000, headers = {} } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'MatheusAnsel-profile', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} em ${url}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 15000));
    }
  }
  throw last;
}

function gh(path) {
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return getJson(`${GH}${path}`, { tries: 2, headers }).catch((e) => {
    // O token do Actions e restrito a este repositorio; dados publicos de outros repos saem sem ele.
    if (headers.authorization && /\b(401|403|404)\b/.test(String(e.message))) {
      return getJson(`${GH}${path}`, { tries: 2, headers: { accept: headers.accept } });
    }
    throw e;
  });
}

const repoPath = (url) => url?.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\/?$/)?.[1];

// --- 1. terminal --------------------------------------------------------------------------------

/** Linhas do terminal: {kind:'cmd'|'out', parts:[[texto, classe]]}. Classe: k chave, s string, p pontuacao, m apagado. */
export function terminalLines(me) {
  const L = [];
  const cmd = (t) => L.push({ kind: 'cmd', parts: [[t, '']] });
  const out = (...parts) => L.push({ kind: 'out', parts });
  const str = (s) => [`"${s}"`, 's'];

  cmd(`curl -s matheusansel.pages.dev/me.json | jq '{nome, cargo, local, stack, emProducao}'`);
  out(['{', 'p']);
  const campos = [
    ['nome', me.nome],
    ['cargo', me.cargo],
    ['local', me.local],
  ];
  for (const [k, v] of campos) out(['  ', ''], [`"${k}"`, 'k'], [': ', 'p'], str(v), [',', 'p']);
  out(['  ', ''], ['"stack"', 'k'], [': [', 'p']);
  me.stack.forEach((s, i) => out(['    ', ''], str(s), [i < me.stack.length - 1 ? ',' : '', 'p']));
  out(['  ],', 'p']);
  out(['  ', ''], ['"emProducao"', 'k'], [': ', 'p'], str(me.emProducao ?? ''));
  out(['}', 'p']);
  cmd(`curl -s matheusansel.pages.dev/me.json | jq -r '.projetos[] | "\\(.status)\\t\\(.nome)"'`);
  // "Em desenvolvimento · código não público" -> "Em desenvolvimento": a coluna fica curta.
  const st = (p) => p.status.split(' · ')[0];
  const w = Math.max(...me.projetos.map((p) => st(p).length)) + 3;
  for (const p of me.projetos) out([st(p).padEnd(w), 'm'], [p.nome, '']);
  return L;
}

export function terminalSvg(me, themeName) {
  const t = THEMES[themeName];
  const lines = terminalLines(me);
  const PROMPT = 'matheus@rio:~$ ';
  const padX = 22;
  const top = 52;
  const maxCols = Math.max(...lines.map((l) => (l.kind === 'cmd' ? PROMPT.length : 0) + l.parts.reduce((n, [s]) => n + s.length, 0)));
  const width = Math.max(760, Math.ceil(padX * 2 + maxCols * CHAR_W));
  const height = top + lines.length * LINE_H + 22;

  // Linha do tempo: comandos digitados letra a letra; a saida aparece linha a linha, como num terminal.
  // Tudo em SMIL (<set>/<animate>) para letras e cursor andarem no mesmo relogio.
  const show = (tm) => `<set attributeName="opacity" to="1" begin="${r1(tm)}s" fill="freeze"/>`;
  const TYPE = 0.034;
  const OUT = 0.05;
  let time = 0.6;
  const cursor = []; // [tempo, coluna, linha]
  const body = [];
  lines.forEach((l, row) => {
    const y = top + row * LINE_H;
    if (l.kind === 'cmd') {
      if (row > 0) time += 0.5;
      const text = l.parts[0][0];
      let spans = `<tspan class="pr" opacity="0">${show(time)}${esc(PROMPT)}</tspan>`;
      cursor.push([time, PROMPT.length, row]);
      time += 0.35;
      [...text].forEach((ch, i) => {
        spans += `<tspan opacity="0">${show(time)}${esc(ch)}</tspan>`;
        cursor.push([time, PROMPT.length + i + 1, row]);
        time += TYPE;
      });
      time += 0.3;
      body.push(`<text x="${padX}" y="${y}" class="c" xml:space="preserve">${spans}</text>`);
    } else {
      time += OUT;
      const spans = l.parts.map(([s, cls]) => `<tspan class="${cls}">${esc(s)}</tspan>`).join('');
      body.push(`<text x="${padX}" y="${y}" opacity="0" xml:space="preserve">${show(time)}${spans}</text>`);
      cursor.push([time, 0, row + 1]);
    }
  });
  // Prompt final, esperando o proximo comando.
  time += 0.3;
  const lastRow = lines.length;
  body.push(`<text x="${padX}" y="${top + lastRow * LINE_H}" class="c" xml:space="preserve"><tspan class="pr" opacity="0">${show(time)}${esc(PROMPT)}</tspan></text>`);
  cursor.push([time, PROMPT.length, lastRow]);
  const end = time;

  const total = end + 0.01;
  const k5 = (n) => Math.round(n * 1e5) / 1e5;
  const kt = cursor.map(([tm]) => k5(Math.min(tm / total, 1)));
  kt[0] = 0;
  // keyTimes precisam crescer; tempos iguais ganham um passo minimo.
  for (let i = 1; i < kt.length; i++) if (kt[i] <= kt[i - 1]) kt[i] = k5(kt[i - 1] + 0.00001);
  kt[kt.length - 1] = 1;
  const xs = cursor.map(([, c]) => r1(padX + c * CHAR_W)).join(';');
  const ys = cursor.map(([, , rw]) => r1(top + rw * LINE_H - FONT_SIZE + 1)).join(';');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Terminal: ${esc(me.nome)}, ${esc(me.cargo)}. ${esc(me.stack.join(', '))}.">
<title>${esc(me.nome)} · ${esc(me.cargo)}</title>
<style>
${fontFace()}
text{font-family:JBM,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:${FONT_SIZE}px;fill:${t.text}}
.pr{fill:${t.muted}}
.k{fill:${t.strong};font-weight:700}.s{fill:${t.text}}.p,.m{fill:${t.muted}}
.cur{fill:${t.text}}
</style>
<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
<path d="M.5 30.5h${width - 1}" stroke="${t.border}"/>
<circle cx="20" cy="15.5" r="5" fill="${t.faint}"/><circle cx="37" cy="15.5" r="5" fill="${t.faint}"/><circle cx="54" cy="15.5" r="5" fill="${t.faint}"/>
<text x="${width / 2}" y="20" text-anchor="middle" style="font-size:12px;fill:${t.muted}">matheus@rio: ~</text>
${body.join('\n')}
<rect class="cur" width="${r1(CHAR_W)}" height="${FONT_SIZE + 3}" x="${padX}" y="${top - FONT_SIZE + 1}">
<animate attributeName="x" dur="${r1(total)}s" fill="freeze" calcMode="discrete" keyTimes="${kt.join(';')}" values="${xs}"/>
<animate attributeName="y" dur="${r1(total)}s" fill="freeze" calcMode="discrete" keyTimes="${kt.join(';')}" values="${ys}"/>
<animate attributeName="opacity" values="1;0" keyTimes="0;0.5" calcMode="discrete" dur="1s" begin="${r1(end)}s" repeatCount="indefinite"/>
</rect>
</svg>
`;
}

// --- 2. Selic x inflacao ------------------------------------------------------------------------

export function econSvg(data, themeName, atualizadoEm) {
  const t = THEMES[themeName];
  const W = 860;
  const H = 330;
  const L = 52, R = 24, T = 92, B = 52;
  const pts = data.filter((d) => [d.selic, d.ipca12m].every(Number.isFinite));
  const last = pts[pts.length - 1];
  const vals = pts.flatMap((d) => [d.selic, d.ipca12m]);
  const yMax = Math.ceil(Math.max(...vals) / 2) * 2;
  const yMin = Math.max(0, Math.floor(Math.min(...vals) / 2) * 2);
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const path = (key) => pts.map((d, i) => `${i ? 'L' : 'M'}${r1(x(i))} ${r1(y(d[key]))}`).join('');
  const area =
    pts.map((d, i) => `${i ? 'L' : 'M'}${r1(x(i))} ${r1(y(d.selic))}`).join('') +
    pts.slice().reverse().map((d, j) => `L${r1(x(pts.length - 1 - j))} ${r1(y(d.ipca12m))}`).join('') + 'Z';

  const grid = [];
  for (let v = yMin; v <= yMax; v += 2) {
    grid.push(`<path d="M${L} ${r1(y(v))}H${W - R}" stroke="${t.faint}" stroke-width="1"/>`);
    grid.push(`<text x="${L - 8}" y="${r1(y(v) + 4)}" text-anchor="end" class="ax">${v}%</text>`);
  }
  const mes = (iso) => new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(iso)).replace('.', '').replace(' de ', '/');
  const ticks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
    .map((i) => `<text x="${r1(x(i))}" y="${H - B + 22}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" class="ax">${mes(pts[i].date)}</text>`)
    .join('');
  const len = 2400;

  const stat = (lx, label, value) =>
    `<text x="${lx}" y="44" class="lb">${label}</text><text x="${lx}" y="72" class="big">${value}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Selic ${pct(last.selic)}, IPCA 12 meses ${pct(last.ipca12m)}, juro real ${pct(last.realRate)}, dados de ${mes(last.date)}.">
<title>Selic contra inflação, dados da API do brasil-econ-dashboard</title>
<style>
${fontFace()}
text{font-family:JBM,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:${t.text}}
.lb{font-size:11px;fill:${t.muted};letter-spacing:.06em}
.big{font-size:24px;font-weight:700;fill:${t.strong}}
.ax{font-size:11px;fill:${t.muted}}
.ft{font-size:11px;fill:${t.muted}}
.ln{stroke-dasharray:${len};stroke-dashoffset:${len};animation:d 2.4s ease-out .3s forwards}
.ar{opacity:0;animation:f 1s ease-out 2.2s forwards}
@keyframes d{to{stroke-dashoffset:0}}
@keyframes f{to{opacity:.08}}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
${stat(24, 'SELIC (META)', pct(last.selic))}
${stat(214, 'IPCA 12 MESES', pct(last.ipca12m))}
${stat(404, 'JURO REAL', pct(last.realRate))}
<text x="${W - 24}" y="44" text-anchor="end" class="lb">ÚLTIMO MÊS</text><text x="${W - 24}" y="72" text-anchor="end" class="big" style="font-size:16px">${mes(last.date)}</text>
${grid.join('\n')}
<path d="${area}" fill="${t.text}" class="ar"/>
<path d="${path('ipca12m')}" fill="none" stroke="${t.muted}" stroke-width="2" class="ln"/>
<path d="${path('selic')}" fill="none" stroke="${t.strong}" stroke-width="2.5" class="ln"/>
${ticks}
<path d="M${L} ${H - 14}h18" stroke="${t.strong}" stroke-width="2.5"/><text x="${L + 24}" y="${H - 10}" class="ft">Selic</text>
<path d="M${L + 80} ${H - 14}h18" stroke="${t.muted}" stroke-width="2"/><text x="${L + 104}" y="${H - 10}" class="ft">IPCA 12m</text>
<text x="${W - 24}" y="${H - 10}" text-anchor="end" class="ft">Banco Central, via API do brasil-econ-dashboard · ${dataBR(atualizadoEm)}</text>
</svg>
`;
}

// --- 3. testes e CI ----------------------------------------------------------------------------

export function testesSvg(rows, themeName, atualizadoEm) {
  const t = THEMES[themeName];
  const W = 420;
  const H = CARD_H;
  const top = 140;
  const rowH = Math.min(34, (H - top - 46) / Math.max(rows.length - 1, 1));
  const comNumero = rows.filter((r) => r.testes);
  const total = comNumero.reduce((n, r) => n + r.testes.total, 0);
  const aprox = comNumero.some((r) => r.testes.aproximado);
  const totalTxt = aprox ? `~${Math.round(total / 10) * 10}` : String(total);
  const body = rows
    .map((r, i) => {
      const y = top + i * rowH;
      const n = r.testes ? `${r.testes.aproximado ? '~' : ''}${r.testes.total}` : '';
      const ok = r.ci?.conclusion === 'success';
      const falha = { failure: 'falhou', cancelled: 'cancelado', timed_out: 'expirou', skipped: 'pulado' };
      const ci = r.ci ? (ok ? `CI ok · ${diaMes(r.ci.date)}` : `CI ${falha[r.ci.conclusion] ?? r.ci.conclusion ?? 'rodando'}`) : 'sem CI';
      return `<g class="r" style="animation-delay:${r1(0.6 + i * 0.12)}s">
<circle cx="30" cy="${y - 4}" r="4" fill="${ok ? t.ok : r.ci ? t.bad : t.faint}"/>
<text x="44" y="${y}">${esc(r.nome.length > 25 ? `${r.nome.slice(0, 24)}…` : r.nome)}</text>
<text x="${W - 150}" y="${y}" text-anchor="end" class="n">${n}</text>
<text x="${W - 24}" y="${y}" text-anchor="end" class="m">${esc(ci)}</text></g>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(totalTxt)} testes automatizados nos projetos; status do CI de cada um.">
<title>Testes automatizados e CI</title>
<style>
${fontFace()}
text{font-family:JBM,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;fill:${t.text}}
.lb{font-size:11px;fill:${t.muted};letter-spacing:.06em}
.big{font-size:44px;font-weight:700;fill:${t.strong}}
.n{font-weight:700;fill:${t.strong}}.m{fill:${t.muted};font-size:11.5px}
.r,.h{opacity:0;animation:v .5s ease-out forwards}
@keyframes v{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
<text x="24" y="36" class="lb">TESTES AUTOMATIZADOS</text>
<text x="24" y="86" class="big h" style="animation-delay:.1s">${esc(totalTxt)}</text>
<text x="24" y="108" class="m h" style="animation-delay:.3s">somados nos projetos, conforme o README de cada um</text>
${body}
<text x="24" y="${H - 16}" class="m">CI: GitHub Actions, última execução · ${dataBR(atualizadoEm)}</text>
</svg>
`;
}

// --- 4. em construcao agora ---------------------------------------------------------------------

export function atividadeSvg(items, themeName, atualizadoEm) {
  const t = THEMES[themeName];
  const W = 420;
  const H = CARD_H;
  const top = 66;
  const rowH = Math.min(48, (H - top - 50) / Math.max(items.length - 1, 1));
  const body = items
    .map((c, i) => {
      const y = top + i * rowH;
      const msg = c.mensagem.length > 46 ? `${c.mensagem.slice(0, 45)}…` : c.mensagem;
      return `<g class="r" style="animation-delay:${r1(0.3 + i * 0.15)}s">
<text x="24" y="${y}" class="n">${esc(c.projeto)}</text>
<text x="${W - 24}" y="${y}" text-anchor="end" class="m">${diaMes(c.data)}</text>
<text x="24" y="${y + 18}" class="m">${esc(msg)}</text></g>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Último commit em cada projeto.">
<title>Em construção agora</title>
<style>
${fontFace()}
text{font-family:JBM,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;fill:${t.text}}
.lb{font-size:11px;fill:${t.muted};letter-spacing:.06em}
.n{font-weight:700;fill:${t.strong}}.m{fill:${t.muted};font-size:11.5px}
.r{opacity:0;animation:v .5s ease-out forwards}
@keyframes v{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
<text x="24" y="36" class="lb">EM CONSTRUÇÃO AGORA · ÚLTIMO COMMIT</text>
${body}
<text x="24" y="${H - 16}" class="m">atualizado em ${dataBR(atualizadoEm)}</text>
</svg>
`;
}

// --- coleta e gravacao --------------------------------------------------------------------------

async function ultimoCommit(repo) {
  const commits = await gh(`/repos/${repo}/commits?per_page=15`);
  const humano = commits.find((c) => c.author?.type !== 'Bot' && !/\[bot\]/i.test(c.commit?.author?.name ?? '')) ?? commits[0];
  if (!humano) return undefined;
  return { mensagem: humano.commit.message.split('\n')[0].trim(), data: humano.commit.committer?.date ?? humano.commit.author?.date };
}

async function ultimoCi(repo) {
  const info = await gh(`/repos/${repo}`);
  const runs = await gh(`/repos/${repo}/actions/runs?branch=${encodeURIComponent(info.default_branch)}&status=completed&per_page=10`);
  // Prefere o workflow de CI; se nao houver um com esse nome, vale a ultima execucao concluida.
  const run = runs.workflow_runs.find((w) => /\bci\b/i.test(w.name)) ?? runs.workflow_runs[0];
  return run ? { conclusion: run.conclusion, date: run.updated_at } : undefined;
}

function grava(name, svg) {
  writeFileSync(out(name), svg);
  console.log(`ok  ${name}`);
}

async function etapa(nome, fn) {
  try {
    await fn();
  } catch (e) {
    console.warn(`::warning::${nome} nao atualizado: ${e.message}`);
  }
}

async function main() {
  const agora = new Date().toISOString();
  const me = await getJson(PORTFOLIO_JSON, { tries: 3 });

  await etapa('terminal', async () => {
    for (const th of ['dark', 'light']) grava(`terminal-${th}.svg`, terminalSvg(me, th));
  });

  await etapa('selic', async () => {
    const from = new Date();
    from.setUTCMonth(from.getUTCMonth() - 36);
    const url = `${ECON_API}/analytics/real-rate?from=${from.toISOString().slice(0, 10)}`;
    // No plano gratuito do Render a API dorme: as tentativas dao tempo para ela acordar.
    const { data } = await getJson(url, { tries: 4, timeoutMs: 90000 });
    if (!Array.isArray(data) || data.length < 6) throw new Error('serie curta demais');
    for (const th of ['dark', 'light']) grava(`selic-${th}.svg`, econSvg(data, th, agora));
  });

  const publicos = me.projetos.filter((p) => repoPath(p.repo));

  await etapa('testes', async () => {
    const rows = [];
    for (const p of publicos.filter((p) => p.testes || ['oficina'].includes(p.id))) {
      const ci = await ultimoCi(repoPath(p.repo)).catch(() => undefined);
      if (p.testes || ci) rows.push({ nome: p.nome, testes: p.testes, ci });
    }
    if (!rows.length) throw new Error('nenhum projeto com testes');
    for (const th of ['dark', 'light']) grava(`testes-${th}.svg`, testesSvg(rows, th, agora));
  });

  await etapa('atividade', async () => {
    const items = [];
    for (const p of publicos) {
      const c = await ultimoCommit(repoPath(p.repo)).catch(() => undefined);
      if (c) items.push({ projeto: p.nome, ...c });
    }
    items.sort((a, b) => b.data.localeCompare(a.data));
    if (!items.length) throw new Error('nenhum commit encontrado');
    for (const th of ['dark', 'light']) grava(`atividade-${th}.svg`, atividadeSvg(items.slice(0, 5), th, agora));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(`${root}assets/gerado`)) throw new Error('crie a pasta assets/gerado');
  await main();
}
