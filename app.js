"use strict";
// All page text is built with textContent / createElement; data never goes into innerHTML.

const state = { stocks: [], meta: {}, market: "india", view: "Shortlist", sort: "rank", dir: 1, open: null, subj: true };
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : "#"; }
  catch (e) { return "#"; }
}
function link(u, text) {
  const a = el("a", null, text || u); a.href = safeUrl(u); a.target = "_blank"; a.rel = "noopener noreferrer";
  return a;
}
function fmt(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  if (typeof v !== "number") return String(v);
  if (Math.abs(v) >= 1e6) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
function scoreCell(v) {
  const s = el("span", "sc " + (v == null ? "" : v >= 6.5 ? "hi" : v >= 4 ? "md" : "lo"), v == null ? "–" : v.toFixed(1));
  return s;
}
async function getJson(p) {
  const r = await fetch(p + "?v=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error(p + " HTTP " + r.status);
  return r.json();
}

async function init() {
  try {
    const [s, m] = await Promise.all([getJson("data/stocks.json"), getJson("data/meta.json")]);
    state.stocks = s.stocks || []; state.meta = m || {};
  } catch (e) {
    $("meta").textContent = "No data yet: the first weekly run has not been published.";
    return;
  }
  const m = state.meta;
  document.querySelectorAll("[data-market]").forEach((b) => b.addEventListener("click", () => {
    state.market = b.dataset.market; state.open = null;
    document.querySelectorAll("[data-market]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    fillSectors(); render();
  }));
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    state.view = b.dataset.view; state.open = null;
    document.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    render();
  }));
  ["q", "sector", "minscore", "noflags"].forEach((id) => $(id).addEventListener("input", render));
  try { state.subj = localStorage.getItem("screener.subj") !== "off"; } catch (e) { /* storage unavailable */ }
  $("subj").checked = state.subj;
  $("subj").addEventListener("input", () => {
    state.subj = $("subj").checked;
    try { localStorage.setItem("screener.subj", state.subj ? "on" : "off"); } catch (e) { /* ignore */ }
    recompute(); render();
  });
  recompute(); fillSectors(); render();
}

// Recompute section scores, composite, coverage, ranks and tiers in the browser, with or without the
// judgement-based parameters switched off (with them on, the weekly run's own results are shown).
function pyRound(x) { const f = Math.floor(x), d = x - f; if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1; return Math.round(x); }
function recompute() {
  const m = state.meta, minCov = m.min_coverage || 0.6, frac = m.shortlist_top_fraction || 0.1;
  const subjFlags = new Set(m.subjective_flags || []);
  if (state.subj) {
    // Switch on: use the weekly run's own results unchanged.
    for (const s of state.stocks) {
      s.v = { sections: s.sections || {}, composite: s.composite, coverage: s.coverage, flags: s.flags || [],
              rank: s.rank, tier: s.tier, sector_rank: s.sector_rank, change: s.change };
    }
    $("meta").textContent = `Screen of ${m.date} · ${state.stocks.length} stocks · Shortlist = top ${Math.round(100 * frac)}% per market with no red flag`;
    return;
  }
  for (const s of state.stocks) {
    const acc = {}, wt = {}; let app = 0, scored = 0;
    for (const p of s.params || []) {
      if (!state.subj && p.subjective) continue;
      if (p.counts === false) continue;
      app += 1;
      if (p.score == null) continue;
      scored += 1;
      const w = p.weight || 1;
      acc[p.section] = (acc[p.section] || 0) + p.score * w; wt[p.section] = (wt[p.section] || 0) + w;
    }
    const sections = {};
    for (const k of Object.keys(acc)) sections[k] = acc[k] / wt[k];
    const W = (m.weights || {})[s.kind === "bank" ? "bank" : "general"] || {};
    let num = 0, den = 0;
    for (const [k, v] of Object.entries(sections)) { const w = W[k] ?? 1; num += v * w; den += w; }
    s.v = { sections, composite: den ? num / den : null, coverage: app ? scored / app : 0,
            flags: state.subj ? (s.flags || []) : (s.flags || []).filter((f) => !subjFlags.has(f)),
            rank: null, tier: "Insufficient data", sector_rank: "", change: state.subj ? s.change : null };
  }
  for (const market of ["india", "us"]) {
    const ranked = state.stocks.filter((s) => s.market === market && s.v.composite != null && s.v.coverage >= minCov)
      .sort((a, b) => b.v.composite - a.v.composite);
    const cut = Math.max(1, pyRound(ranked.length * frac));
    ranked.forEach((s, i) => { s.v.rank = i + 1; s.v.tier = (i + 1 <= cut && !s.v.flags.length) ? "Shortlist" : "Ranked"; });
    const bySec = {};
    for (const s of ranked) (bySec[s.sector] = bySec[s.sector] || []).push(s);
    for (const g of Object.values(bySec)) g.forEach((s, i) => { s.v.sector_rank = `${i + 1} of ${g.length}`; });
  }
  const off = !state.subj;
  $("meta").textContent = `Screen of ${m.date} · ${state.stocks.length} stocks · Shortlist = top ${Math.round(100 * frac)}% per market with no red flag` +
    (off ? " · judgement-based parameters OFF (measured and reported figures only)" : "");
}

function fillSectors() {
  const sel = $("sector"); const keep = sel.value;
  sel.replaceChildren(new Option("All sectors", ""));
  const secs = [...new Set(state.stocks.filter((s) => s.market === state.market).map((s) => s.sector))].sort();
  for (const s of secs) sel.append(new Option(s, s));
  sel.value = secs.includes(keep) ? keep : "";
}

function inView(s, view) {
  if (view === "Shortlist") return s.v.tier === "Shortlist";
  if (view === "Insufficient data") return s.v.tier === "Insufficient data";
  if (view === "banks") return s.kind === "bank";
  return s.kind !== "bank";
}

function rows() {
  const q = $("q").value.trim().toLowerCase(), sector = $("sector").value;
  const min = Number($("minscore").value || 0), nof = $("noflags").checked;
  return state.stocks.filter((s) => s.market === state.market
    && (!q || (s.ticker + " " + s.name).toLowerCase().includes(q))
    && (!sector || s.sector === sector)
    && (!min || (s.v.composite || 0) >= min)
    && (!nof || !s.v.flags.length));
}

function columns() {
  const sec = state.view === "banks" ? state.meta.sections.bank : state.view === "companies" ? state.meta.sections.general : [];
  const cols = [
    { k: "rank", t: "Rank", num: true, v: (s) => s.v.rank },
    { k: "change", t: "Change", num: true, v: (s) => s.v.change },
    { k: "ticker", t: "Ticker", v: (s) => s.ticker },
    { k: "name", t: "Company", v: (s) => s.name },
    { k: "sector", t: "Sector", v: (s) => s.sector },
    { k: "composite", t: "Composite", num: true, v: (s) => s.v.composite, score: true },
  ];
  for (const k of sec) cols.push({ k: "sec_" + k, t: state.meta.section_labels[k], num: true, v: (s) => s.v.sections[k], score: true });
  cols.push({ k: "coverage", t: "Data coverage", num: true, v: (s) => s.v.coverage });
  cols.push({ k: "flags", t: "Red flags", v: (s) => s.v.flags.join("; ") });
  return cols;
}

function render() {
  const about = state.market === "about";
  $("views").hidden = about; $("filters").hidden = about; $("tablewrap").hidden = about; $("hint").hidden = about;
  $("about").hidden = !about; $("detail").hidden = true;
  if (about) { renderAbout(); return; }
  const base = rows();
  document.querySelectorAll("[data-count]").forEach((c) => { c.textContent = base.filter((s) => inView(s, c.dataset.count)).length; });
  const list = base.filter((s) => inView(s, state.view));
  const cols = columns();
  const col = cols.find((c) => c.k === state.sort) || cols[0];
  list.sort((a, b) => {
    const x = col.v(a), y = col.v(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * state.dir;
  });
  const hints = {
    "Shortlist": "Top-ranked stocks in this market with no red flag. Click a row for every parameter, its score and its source.",
    "companies": "All non-bank companies. Section scores are 0 to 10, higher is better.",
    "banks": "Banks, scored on the bank parameters of the docx (CASA, NPA, capital adequacy and others).",
    "Insufficient data": "Fewer than " + Math.round(100 * (state.meta.min_coverage || 0.6)) + "% of parameters could be scored, so these are not ranked.",
  };
  $("hint").textContent = `${list.length} shown. ${hints[state.view] || ""}`;
  const thead = $("table").tHead, tbody = $("table").tBodies[0];
  thead.replaceChildren(); tbody.replaceChildren();
  const hr = document.createElement("tr");
  for (const c of cols) {
    const th = el("th", c.num ? "num" : null, c.t + (state.sort === c.k ? (state.dir > 0 ? " ▲" : " ▼") : ""));
    th.addEventListener("click", () => {
      if (state.sort === c.k) state.dir = -state.dir;
      else { state.sort = c.k; state.dir = (c.num && c.k !== "rank") ? -1 : 1; }
      render();
    });
    hr.append(th);
  }
  thead.append(hr);
  for (const s of list) {
    const tr = el("tr", s.v.tier === "Shortlist" ? "short" : null);
    for (const c of cols) {
      const v = c.v(s);
      const td = el("td", (c.num ? "num" : "") + (c.k === "flags" ? " flags" : ""));
      if (c.score) td.append(scoreCell(v));
      else if (c.k === "coverage") td.textContent = v == null ? "" : Math.round(100 * v) + "%";
      else if (c.k === "change") { td.textContent = v ? (v > 0 ? "▲" + v : "▼" + (-v)) : ""; if (v) td.classList.add(v > 0 ? "up" : "down"); }
      else td.textContent = v == null ? "" : String(v);
      tr.append(td);
    }
    tr.addEventListener("click", () => { state.open = s.id; showDetail(s); });
    tbody.append(tr);
  }
  if (state.open) { const s = state.stocks.find((x) => x.id === state.open); if (s) showDetail(s); }
}

function showDetail(s) {
  const d = $("detail"); d.replaceChildren(); d.hidden = false;
  const close = el("button", "close", "Close"); close.type = "button";
  close.addEventListener("click", () => { state.open = null; d.hidden = true; });
  d.append(close);
  const h = el("h2", null, `${s.ticker} · ${s.name}`);
  h.append(el("span", "badge " + (s.v.tier === "Shortlist" ? "ok" : ""), s.v.tier));
  d.append(h);
  d.append(el("p", "facts", [
    s.sector, s.kind === "bank" ? "bank" : s.kind === "financial" ? "financial (non-bank)" : "company",
    s.v.rank ? `rank ${s.v.rank} in market` : "not ranked", s.v.sector_rank ? `sector rank ${s.v.sector_rank}` : null,
    s.price != null ? `price ${s.price_currency || ""} ${fmt(s.price)}${s.price_date ? " (" + s.price_date + ")" : ""}` : null,
    s.price_note || null,
    s.period ? `figures: ${s.period} to ${s.period_end}` : null, s.source ? `source ${s.source}` : null,
    s.data_read ? `statements read ${s.data_read}` : null,
  ].filter(Boolean).join(" · ")));
  if (s.v.flags.length) d.append(el("p", "ev warnb", "Red flags: " + s.v.flags.join("; ")));
  if (!state.subj) d.append(el("p", "ev muted", "Judgement-based parameters are switched off: moat and the bank news check are shown but not counted."));
  const grid = el("div", "secgrid");
  grid.append(el("div", "secbox", `Composite ${s.v.composite == null ? "–" : s.v.composite.toFixed(2)}`));
  for (const [k, v] of Object.entries(s.v.sections)) grid.append(el("div", "secbox", `${state.meta.section_labels[k]}: ${v == null ? "–" : v.toFixed(1)}`));
  grid.append(el("div", "secbox", `Data coverage ${Math.round(100 * (s.v.coverage || 0))}%`));
  d.append(grid);

  const t = el("table"); const th = document.createElement("tr");
  for (const x of ["Section", "Parameter", "Value", "Score", "How scored", "Source"]) th.append(el("th", null, x));
  const thead = document.createElement("thead"); thead.append(th); t.append(thead);
  const tb = document.createElement("tbody");
  for (const p of s.params || []) {
    const tr = document.createElement("tr");
    tr.append(el("td", null, state.meta.section_labels[p.section]), el("td", null, p.label),
      el("td", "num", fmt(p.value)));
    const sc = el("td", "num"); sc.append(scoreCell(p.score)); tr.append(sc);
    const how = (!state.subj && p.subjective) ? "judgement: not counted (switched off)" : (p.how || (p.value == null ? "not available" : ""));
    tr.append(el("td", "muted", how), el("td", null, p.subjective ? "AI judgement (see below)" : p.source === "ai" ? "AI-read figure (see below)" : "filings"));
    tb.append(tr);
  }
  t.append(tb);
  const w = el("div", "tablewrap"); w.append(t); d.append(w);

  const ai = s.ai || {};
  if (Object.keys(ai).length) d.append(el("h3", null, "AI-read parameters and evidence"));
  if (ai.moat) {
    const p = el("p", "ev", `Economic moat ${ai.moat.value == null ? "(not scored)" : ai.moat.value + "/10"}${(ai.moat.types || []).length ? " · " + ai.moat.types.join(", ") : ""} · checked ${ai.moat.date}. `);
    p.append(el("span", "q", ai.moat.evidence || ""));
    for (const u of ai.moat.sources || []) { p.append(" "); p.append(link(u, "[source]")); }
    d.append(p);
  }
  if (ai.bank_news) {
    const p = el("p", "ev", `News and management check ${ai.bank_news.value == null ? "(not scored)" : ai.bank_news.value + "/10"} · checked ${ai.bank_news.date}`);
    d.append(p);
    for (const e of ai.bank_news.events || []) {
      const q = el("p", "ev q", `${e.date} ${e.summary} `); if (e.url) q.append(link(e.url, "[source]")); d.append(q);
    }
  }
  for (const task of ["promoter", "bank_metrics_india", "bank_metrics_us"]) {
    const r = ai[task]; if (!r) continue;
    d.append(el("p", "ev muted", `${task === "promoter" ? "Shareholding" : "Bank results"}${r.quarter ? " · " + r.quarter : ""} · checked ${r.date}`));
    for (const [k, v] of Object.entries(r.values || {})) {
      const p = el("p", "ev", `${k.replace(/_/g, " ")}: ${v.value == null ? "–" : fmt(v.value)} `);
      p.append(el("span", "badge " + (String(v.status).startsWith("verified") ? "ok" : "warnb"), v.status));
      if (v.quote) p.append(el("span", "q", ` "${v.quote}" `));
      if (v.url) p.append(link(v.url, "[page]"));
      d.append(p);
    }
  }
  d.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAbout() {
  const r = $("about"); r.replaceChildren(); r.className = "card about";
  const m = state.meta;
  r.append(el("h2", null, "How the screen works"));
  const ul = el("ul");
  [
    "Universe: Nifty 100 (NSE Indices list) and S&P 500 (SPDR S&P 500 ETF holdings).",
    "Each ratio from Stock_Evaluation_Ratios.docx is compared only with companies of the same market, sector and type (banks with banks): percentile 0 (worst) to 10 (best).",
    "Where the docx gives a benchmark (ROE > 18%, D/E < 1, current ratio >= 2, CFO/PAT >= 0.8, PEG < 1, promoter > 35-40%, ROA > 1%, CAR above the regulatory minimum and others), a benchmark score is averaged in.",
    "Section scores average their parameters; the composite averages the sections. Stocks with less than 60% of parameters available are not ranked.",
    "Judgement-based parameters (economic moat, bank news and management check) are AI opinions, not measured numbers. The switch above the table removes them from the composite, ranks, Shortlist and red flags; AI-read figures such as promoter holding or NPA are reported numbers and stay in.",
    "Shortlist: top " + Math.round(100 * (m.shortlist_top_fraction || 0)) + "% of each market with no red flag (loss, D/E > 2, interest cover < 1.5, profits not turning into cash, ROE far above ROCE, promoter pledge > 25%, bank capital below minimum, adverse bank news).",
    "AI parameters (moat, promoter holding and pledge, Indian bank CASA, NPA, CAR, NIM and cost of funds, US bank NPL and capital ratio, bank news) are read by Claude from filings and results; a number is used only if its quote was found on the fetched page.",
    "The full Excel workbook (with editable weights) is in the private repository under data/reports.",
  ].forEach((t) => ul.append(el("li", null, t)));
  r.append(ul);
  r.append(el("h2", null, `Run of ${m.date}`));
  const ul2 = el("ul");
  for (const n of m.notes || []) ul2.append(el("li", null, n));
  const ai = m.ai || {};
  ul2.append(el("li", null, `AI: ${ai.calls || 0} calls, ${ai.searches || 0} web searches; ${ai.due_not_run || 0} checks due but left for later weeks (per-run limits).`));
  r.append(ul2);
  const errs = m.error_samples || {};
  if (Object.keys(errs).length) {
    r.append(el("h3", null, "Data problems"));
    for (const [k, v] of Object.entries(errs)) {
      r.append(el("p", "ev", `${k}: ${(m.errors || {})[k]} problems. First ones:`));
      const u = el("ul"); for (const x of v) u.append(el("li", "muted", x)); r.append(u);
    }
  }
}

init();
