// Gera cartões SVG com métricas do perfil do GitHub.
// Roda na GitHub Action (.github/workflows/metrics.yml) e salva em metrics/.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const LOGIN = process.env.GH_LOGIN || "MatheusAnsel";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = "metrics";

const QUERY = `
query($login: String!) {
  user(login: $login) {
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      totalPullRequestContributions
      totalIssueContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function loadData() {
  if (process.env.MOCK) return JSON.parse(await readFile(process.env.MOCK, "utf8"));
  if (!TOKEN) throw new Error("Defina GITHUB_TOKEN.");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => n.toLocaleString("pt-BR");

const LIGHT = { bg: "#ffffff", border: "#d0d7de", title: "#0969da", text: "#1f2328", muted: "#59636e", accent: "#0969da", track: "#eff2f5" };
const DARK = { bg: "#0d1117", border: "#30363d", title: "#58a6ff", text: "#e6edf3", muted: "#9198a1", accent: "#2f81f7", track: "#21262d" };
const rules = (c) => `
  .bg { fill: ${c.bg}; stroke: ${c.border}; }
  .grid { stroke: ${c.border}; }
  .track { fill: ${c.track}; }
  .bar { fill: ${c.accent}; }
  text { fill: ${c.text}; }
  .title { fill: ${c.title}; }
  .label, .small { fill: ${c.muted}; }
  .value { fill: ${c.text}; }`;
const STYLE = `
<style>
  text { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  .title { font-size: 16px; font-weight: 600; }
  .label { font-size: 13px; }
  .value { font-size: 13px; font-weight: 600; }
  .small { font-size: 11px; }${rules(LIGHT)}
  @media (prefers-color-scheme: dark) {${rules(DARK)}
  }
</style>`;

const card = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
${STYLE}
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" class="bg"/>
<text x="20" y="32" class="title">${esc(title)}</text>
${body}
</svg>
`;

function streaks(days) {
  const today = new Date().toISOString().slice(0, 10);
  const list = days.filter((d) => d.date <= today);
  let longest = 0, run = 0;
  for (const d of list) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let i = list.length - 1;
  if (i >= 0 && list[i].contributionCount === 0) i--; // hoje ainda sem contribuição não quebra a sequência
  let current = 0;
  while (i >= 0 && list[i].contributionCount > 0) { current++; i--; }
  return { current, longest };
}

function statsCard(u, days) {
  const c = u.contributionsCollection;
  const stars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
  const { current, longest } = streaks(days);
  const rows = [
    ["Contribuições (12 meses)", c.contributionCalendar.totalContributions],
    ["Commits (12 meses)", c.totalCommitContributions + c.restrictedContributionsCount],
    ["Pull requests", c.totalPullRequestContributions],
    ["Issues", c.totalIssueContributions],
    ["Repositórios públicos", u.repositories.totalCount],
    ["Estrelas recebidas", stars],
    ["Sequência atual", `${current} ${current === 1 ? "dia" : "dias"}`],
    ["Maior sequência", `${longest} ${longest === 1 ? "dia" : "dias"}`],
  ];
  const body = rows
    .map(([label, value], i) => {
      const y = 64 + i * 22;
      return `<text x="20" y="${y}" class="label">${esc(label)}</text><text x="390" y="${y}" class="value" text-anchor="end">${esc(typeof value === "number" ? fmt(value) : value)}</text>`;
    })
    .join("\n");
  return card(410, 64 + rows.length * 22, "Estatísticas no GitHub", body);
}

function languagesCard(u) {
  const totals = new Map();
  for (const repo of u.repositories.nodes)
    for (const { size, node } of repo.languages.edges) {
      const cur = totals.get(node.name) || { size: 0, color: node.color || "#8b949e" };
      cur.size += size;
      totals.set(node.name, cur);
    }
  const sorted = [...totals.entries()].sort((a, b) => b[1].size - a[1].size);
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7).reduce((s, [, v]) => s + v.size, 0);
  if (rest > 0) top.push(["Outras", { size: rest, color: "#8b949e" }]);
  const total = top.reduce((s, [, v]) => s + v.size, 0) || 1;

  const barW = 370;
  let x = 20;
  const segs = top
    .map(([, v]) => {
      const w = (v.size / total) * barW;
      const r = `<rect x="${x.toFixed(2)}" y="50" width="${w.toFixed(2)}" height="10" fill="${v.color}"/>`;
      x += w;
      return r;
    })
    .join("");
  const bar = `<clipPath id="bar"><rect x="20" y="50" width="${barW}" height="10" rx="5"/></clipPath><g clip-path="url(#bar)"><rect x="20" y="50" width="${barW}" height="10" class="track"/>${segs}</g>`;

  const legend = top
    .map(([name, v], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const lx = 20 + col * 190, ly = 88 + row * 24;
      const pct = ((v.size / total) * 100).toFixed(1).replace(".", ",");
      return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${v.color}"/><text x="${lx + 16}" y="${ly}" class="label"><tspan class="value">${esc(name)}</tspan> ${pct}%</text>`;
    })
    .join("\n");
  const rows = Math.ceil(top.length / 2);
  return card(410, 64 + 22 + rows * 24, "Linguagens mais usadas", bar + "\n" + legend);
}

function activityCard(days) {
  const today = new Date().toISOString().slice(0, 10);
  const last = days.filter((d) => d.date <= today).slice(-30);
  const max = Math.max(1, ...last.map((d) => d.contributionCount));
  const w = 840, h = 190, left = 44, right = 20, top = 52, bottom = 34;
  const plotW = w - left - right, plotH = h - top - bottom;
  const step = plotW / last.length, bw = Math.max(2, step - 6);
  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = top + plotH - f * plotH;
      return `<line x1="${left}" x2="${w - right}" y1="${y}" y2="${y}" class="grid" stroke-dasharray="3 3"/><text x="${left - 8}" y="${y + 4}" class="small" text-anchor="end">${Math.round(f * max)}</text>`;
    })
    .join("");
  const bars = last
    .map((d, i) => {
      const bh = (d.contributionCount / max) * plotH;
      const x = left + i * step + (step - bw) / 2;
      const [, m, dd] = d.date.split("-");
      const lbl = i % 5 === 0 || i === last.length - 1 ? `<text x="${x + bw / 2}" y="${h - 14}" class="small" text-anchor="middle">${dd}/${m}</text>` : "";
      return `<rect x="${x.toFixed(2)}" y="${(top + plotH - bh).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(bh, d.contributionCount ? 2 : 0).toFixed(2)}" rx="2" class="bar"><title>${dd}/${m}: ${d.contributionCount}</title></rect>${lbl}`;
    })
    .join("\n");
  const sum = last.reduce((s, d) => s + d.contributionCount, 0);
  const sub = `<text x="${w - 20}" y="32" class="label" text-anchor="end">${fmt(sum)} contribuições</text>`;
  return card(w, h, "Atividade nos últimos 30 dias", sub + grid + bars);
}

const user = await loadData();
const days = user.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/stats.svg`, statsCard(user, days));
await writeFile(`${OUT}/languages.svg`, languagesCard(user));
await writeFile(`${OUT}/activity.svg`, activityCard(days));
console.log("Métricas geradas em", OUT);
