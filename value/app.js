"use strict";
// All page text is built with textContent / createElement; data never goes into innerHTML.

const state = { stocks: [], meta: {}, market: "india", open: null };
const $ = (id) => document.getElementById(id);
const MARK = { "pass": "✓", "fail": "✗", "no data": "?", "not applied": "–" };
const CLS = { "pass": "hi", "fail": "lo", "no data": "md", "not applied": "" };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
function fmt(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (typeof v !== "number") return String(v);
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " bn";
  if (a >= 1e6) return (v / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " mn";
  return v.toLocaleString(undefined, { maximumFractionDigits: d });
}

async function init() {
  try {
    const r = await fetch("../data/value.json?v=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    state.stocks = d.stocks || []; state.meta = d.meta || {};
  } catch (e) {
    $("meta").textContent = "No data yet: the first run with the Value Buying tests has not been published.";
    return;
  }
  $("meta").textContent = `Screen of ${state.meta.date} · ${state.stocks.length} stocks · sorted by number of tests passed`;
  document.querySelectorAll("[data-market]").forEach((b) => b.addEventListener("click", () => {
    state.market = b.dataset.market; state.open = null;
    document.querySelectorAll("[data-market]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    fillSectors(); render();
  }));
  ["q", "sector", "minpass", "complete"].forEach((id) => $(id).addEventListener("input", render));
  fillSectors(); render();
}

function fillSectors() {
  const sel = $("sector"); const keep = sel.value;
  sel.replaceChildren(new Option("All sectors", ""));
  const secs = [...new Set(state.stocks.filter((s) => s.market === state.market).map((s) => s.sector))].sort();
  for (const s of secs) sel.append(new Option(s, s));
  sel.value = secs.includes(keep) ? keep : "";
}

function render() {
  const about = state.market === "about";
  $("filters").hidden = about; $("tablewrap").hidden = about; $("hint").hidden = about;
  $("about").hidden = !about; $("detail").hidden = true;
  if (about) { renderAbout(); return; }
  const q = $("q").value.trim().toLowerCase(), sector = $("sector").value;
  const minp = Number($("minpass").value || 0), complete = $("complete").checked;
  const rows = state.stocks.filter((s) => s.market === state.market
    && (!q || (s.ticker + " " + s.name).toLowerCase().includes(q))
    && (!sector || s.sector === sector)
    && (!minp || s.passes >= minp)
    && (!complete || s.missing === 0));
  const all6 = rows.filter((s) => s.passes === s.applicable && s.missing === 0).length;
  $("hint").textContent = `${rows.length} shown · ${all6} pass every test that applies to them. ✓ pass · ✗ fail · ? no data · – not applied (debt test for banks). Click a row for the numbers.`;
  const thead = $("table").tHead, tbody = $("table").tBodies[0];
  thead.replaceChildren(); tbody.replaceChildren();
  const hr = document.createElement("tr");
  for (const t of ["Ticker", "Company", "Sector", "Passed"].concat(state.meta.tests.map((x) => x[1]))) hr.append(el("th", null, t));
  thead.append(hr);
  for (const s of rows) {
    const tr = el("tr", s.passes === s.applicable && s.missing === 0 ? "short" : null);
    tr.append(el("td", null, s.ticker), el("td", null, s.name), el("td", null, s.sector));
    const p = el("td", "num"); p.append(el("span", "sc " + (s.passes >= 5 ? "hi" : s.passes >= 3 ? "md" : "lo"), `${s.passes}/${s.applicable}`));
    tr.append(p);
    for (const [k] of state.meta.tests) {
      const v = s.tests[k]; const td = el("td", "num");
      td.append(el("span", "sc " + CLS[v], MARK[v] || "?")); td.title = v; tr.append(td);
    }
    tr.addEventListener("click", () => { state.open = s.id; showDetail(s); });
    tbody.append(tr);
  }
}

function line(label, text, status) {
  const p = el("p", "ev");
  p.append(el("span", "sc " + (CLS[status] || ""), MARK[status] || "?"), " ");
  p.append(el("strong", null, label + ": "), text);
  return p;
}

function showDetail(s) {
  const d = $("detail"); d.replaceChildren(); d.hidden = false;
  const close = el("button", "close", "Close"); close.type = "button";
  close.addEventListener("click", () => { d.hidden = true; });
  d.append(close, el("h2", null, `${s.ticker} · ${s.name}`));
  d.append(el("p", "facts", [s.sector, s.kind === "bank" ? "bank" : s.kind === "financial" ? "financial (non-bank)" : "company",
    `passes ${s.passes} of ${s.applicable}`, s.price != null ? `price ${s.currency} ${fmt(s.price)}` : null,
    s.screener_rank ? `rank ${s.screener_rank} in the Weekly Stock Screener (${s.screener_tier})` : "not ranked in the Weekly Stock Screener",
  ].filter(Boolean).join(" · ")));
  const D = s.detail, T = s.tests, yrs = (state.meta.pe_history_years || {})[s.market];
  const h = D.pe_history;
  d.append(line("PE below own history", `current PE ${fmt(h.current_pe)} vs median ${fmt(h.median_pe)} of ${h.years_used} annual PE values` +
    (h.annual_pe.length ? ` (${h.annual_pe.map((x) => fmt(x, 1)).join(", ")}, newest first)` : "") +
    (h.loss_years_excluded ? `; ${h.loss_years_excluded} loss year(s) left out of the median` : "") +
    `; target window ${yrs} years. ${s.pe_history_source || ""}`, T.pe_history));
  d.append(line("PE below sector median", `current PE ${fmt(D.pe_sector.current_pe)} vs ${s.sector} median ${fmt(D.pe_sector.sector_median_pe)}`, T.pe_sector));
  const g = (o) => `${fmt(o.latest)} (year to ${o.latest_end || "?"}) vs ${fmt(o.previous)} (year to ${o.previous_end || "?"})`;
  d.append(line("Net profit up YoY", g(D.profit_growth), T.profit_growth));
  d.append(line("Revenue up YoY", g(D.revenue_growth), T.revenue_growth));
  d.append(line("Debt/Equity below " + D.low_debt.limit, T.low_debt === "not applied" ? "not applied to banks" : `debt/equity ${fmt(D.low_debt.debt_to_equity)}`, T.low_debt));
  d.append(line("Free cash flow up YoY", `${fmt(D.fcf_growth.latest)} vs ${fmt(D.fcf_growth.previous)} (latest two fiscal years, operating cash flow minus capital spending)`, T.fcf_growth));
  d.append(el("p", "ev muted", `Amounts in the company's reporting currency (${s.currency === "USD" ? "US dollars" : s.currency === "INR" ? "rupees" : s.currency}).`));
  d.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAbout() {
  const r = $("about"); r.replaceChildren();
  const y = state.meta.pe_history_years || {};
  r.append(el("h2", null, "The six tests"));
  const ol = el("ol");
  [
    `PE below its own history: current PE (latest twelve months) is lower than the median of the stock's annual PE over the last ${y.us || 5} fiscal years (US) or ${y.india || 2} fiscal years (India; the free Indian data holds only 2 years). Loss years are left out of the median; at least 3 years (US) or 2 (India) are needed.`,
    "PE below sector median: current PE is lower than the median PE of all profitable stocks in the same sector and market. Median is used because a single very high PE distorts an average.",
    "Net profit up year on year: latest fiscal year's net profit is higher than the year before.",
    "Revenue up year on year: latest fiscal year's revenue is higher than the year before.",
    `Debt to equity below ${state.meta.max_debt_to_equity || 0.3}: not applied to banks, whose deposits are borrowings by nature. Other lenders and insurers are tested as written and usually fail.`,
    "Free cash flow up year on year: operating cash flow minus capital spending, latest fiscal year vs the year before.",
  ].forEach((t) => ol.append(el("li", null, t)));
  r.append(ol);
  r.append(el("p", null, "A loss-making stock (negative PE) fails both PE tests. '?' means the data needed for a test is missing, so the stock may pass more tests than shown. Stocks are sorted by tests passed, then by fewest missing."));
}

init();
