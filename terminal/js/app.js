import { BinanceFeed, DemoFeed, FinnhubFeed, fetchFX, fetchFearGreed } from './feed.js';
import { Chart } from './chart.js';

// ---------------------------------------------------------------- persistence

const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(`mkt.${k}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try { localStorage.setItem(`mkt.${k}`, JSON.stringify(v)); } catch { /* private mode */ }
  },
};

const DEFAULT_WATCH = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'PAXGUSDT', 'EURUSDT'];
const DEFAULT_EQ = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'SPY', 'QQQ'];
const NAMES = { PAXGUSDT: 'Gold-Token', EURUSDT: 'EUR/USDT', SPY: 'S&P 500 ETF', QQQ: 'Nasdaq-100 ETF' };
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY'];

const params = new URLSearchParams(location.search);
const S = {
  demo: params.has('demo') || store.get('demo', false),
  watch: store.get('watch', DEFAULT_WATCH),
  eq: store.get('eq', DEFAULT_EQ),
  active: store.get('active', 'BTCUSDT'),
  kind: store.get('kind', 'crypto'),
  crypto: store.get('crypto', 'BTCUSDT'), // symbol feeding BOOK/TAPE
  interval: store.get('interval', '1h'),
  key: store.get('finnhub', ''),
  tick: {},
  eqq: {},
  eqBars: {},
  book: null,
  tape: [],
  msgs: 0,
  history: store.get('history', []),
  hIdx: -1,
};
if (S.kind === 'eq' && !S.key) { S.kind = 'crypto'; S.active = S.crypto; }

// ---------------------------------------------------------------- helpers

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const decimals = (p) => (p >= 1000 ? 2 : p >= 10 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : 8);
const fmtP = (p) => (Number.isFinite(p) ? p.toLocaleString('en-US', { minimumFractionDigits: decimals(p), maximumFractionDigits: decimals(p) }) : '—');
const fmtPct = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(2)}%` : '—');
const fmtBig = (v) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(a < 1 ? 4 : 2);
};
const fmtQty = (q) => (q >= 1000 ? fmtBig(q) : q.toFixed(q >= 1 ? 3 : 5));
const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hhmmss = (t) => new Date(t).toLocaleTimeString('de-DE', { hour12: false });
const label = (sym) => (sym.endsWith('USDT') && !NAMES[sym] ? sym.slice(0, -4) : sym);
const flash = (node, dir) => {
  if (!dir) return;
  node.classList.remove('fu', 'fd');
  void node.offsetWidth; // restart CSS animation
  node.classList.add(dir > 0 ? 'fu' : 'fd');
};

function say(text, err = false) {
  const m = $('msg');
  m.textContent = text;
  m.classList.toggle('err', err);
  clearTimeout(say.t);
  say.t = setTimeout(() => { m.textContent = ''; }, 6000);
}

function persist() {
  for (const k of ['watch', 'eq', 'active', 'kind', 'crypto', 'interval']) store.set(k, S[k]);
}

// ---------------------------------------------------------------- render scheduling

const dirty = new Set();
const mark = (...p) => { p.forEach((x) => dirty.add(x)); schedule(); };
let rafPending = false;
function schedule() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (dirty.has('mon')) renderMon();
    if (dirty.has('head')) renderHead();
    if (dirty.has('book')) renderBook();
    if (dirty.has('tape')) renderTape();
    dirty.clear();
  });
}

// ---------------------------------------------------------------- MON

const rows = new Map();
function monRow(sym, kind) {
  const key = `${kind}:${sym}`;
  if (rows.has(key)) return rows.get(key);
  const tr = el('tr', 'clickable');
  tr.dataset.sym = sym;
  tr.dataset.kind = kind;
  const name = el('td', 'sym', label(sym));
  if (NAMES[sym]) name.append(el('small', null, NAMES[sym]));
  const cells = { name, last: el('td', 'r'), pct: el('td', 'r'), high: el('td', 'r hide-s'), low: el('td', 'r hide-s'), vol: el('td', 'r dim') };
  tr.append(...Object.values(cells));
  tr.addEventListener('click', () => load(sym, kind));
  const r = { tr, cells, prev: NaN };
  rows.set(key, r);
  return r;
}

function buildMon() {
  for (const k of [...rows.keys()]) {
    const [kind, sym] = k.split(':');
    if (!(kind === 'crypto' ? S.watch : S.eq).includes(sym)) rows.delete(k);
  }
  const c = $('mon-crypto');
  const e = $('mon-eq');
  c.replaceChildren();
  e.replaceChildren();
  const g1 = el('tr', 'group');
  g1.append(Object.assign(el('td', null, 'KRYPTO · 24/7 · BINANCE SPOT'), { colSpan: 6 }));
  c.append(g1, ...S.watch.map((s) => monRow(s, 'crypto').tr));
  const g2 = el('tr', 'group');
  g2.append(Object.assign(el('td', null, S.key ? 'US-AKTIEN · FINNHUB · NUR HANDELSZEITEN' : 'US-AKTIEN · KEY <token> <GO> aktiviert Finnhub'), { colSpan: 6 }));
  e.append(g2);
  if (S.key) e.append(...S.eq.map((s) => monRow(s, 'eq').tr));
  mark('mon');
}

function renderMon() {
  for (const [key, r] of rows) {
    const [kind, sym] = key.split(':');
    const d = kind === 'crypto' ? S.tick[sym] : S.eqq[sym];
    r.tr.classList.toggle('active', sym === S.active && kind === S.kind);
    if (!d) continue;
    const pct = ((d.last - d.open) / d.open) * 100;
    r.cells.last.textContent = fmtP(d.last);
    r.cells.pct.textContent = fmtPct(pct);
    r.cells.pct.className = `r ${cls(pct)}`;
    r.cells.high.textContent = fmtP(d.high);
    r.cells.low.textContent = fmtP(d.low);
    r.cells.vol.textContent = kind === 'crypto' ? fmtBig(d.qvol) : '';
    if (Number.isFinite(r.prev) && d.last !== r.prev) flash(r.cells.last, d.last - r.prev);
    r.prev = d.last;
  }
}

// ---------------------------------------------------------------- GP

const chart = new Chart($('chart'), $('gp-read'));
chart.fmt = fmtP;
let loadToken = 0;

function buildIntervals() {
  const box = $('gp-iv');
  box.replaceChildren(...INTERVALS.map((iv) => {
    const b = el('button', iv === S.interval ? 'on' : '', iv.toUpperCase());
    b.type = 'button';
    b.addEventListener('click', () => run(`GP ${iv}`, { maximize: false }));
    return b;
  }));
  box.hidden = S.kind === 'eq';
}

function renderHead() {
  const d = S.kind === 'crypto' ? S.tick[S.active] : S.eqq[S.active];
  $('gp-title').textContent = `${S.active} ${S.kind === 'eq' ? 'US EQUITY' : 'CRYPTO'} · ${S.kind === 'eq' ? 'Intraday ab Seitenaufruf' : S.interval.toUpperCase()}`;
  if (!d) return;
  const pct = ((d.last - d.open) / d.open) * 100;
  const last = $('gp-last');
  const prev = +last.dataset.v;
  last.textContent = fmtP(d.last);
  if (Number.isFinite(prev) && prev !== d.last) flash(last, d.last - prev);
  last.dataset.v = d.last;
  const chg = $('gp-chg');
  chg.textContent = `${fmtP(d.last - d.open)}  ${fmtPct(pct)}  ${S.kind === 'eq' ? 'vs. Vortag' : '24h'}`;
  chg.className = `chg ${cls(pct)}`;
  document.title = `${label(S.active)} ${fmtP(d.last)} · MKT`;
}

async function loadChart() {
  const token = ++loadToken;
  const note = $('gp-note');
  note.hidden = true;
  if (S.kind === 'eq') {
    // Finnhub's candle endpoint is not in the free tier, so the equity chart
    // is recorded live from trades, bucketed into 1-minute bars.
    const bars = S.eqBars[S.active] || [];
    chart.set(bars, 'line');
    if (bars.length < 2) {
      note.hidden = false;
      note.textContent = 'Aktien-Chart wird ab jetzt live aus Trades aufgezeichnet (Finnhub Free hat keine historischen Kerzen). Außerhalb der US-Handelszeit kommen keine Trades.';
    }
    return;
  }
  try {
    const bars = await feed.klines(S.active, S.interval);
    if (token !== loadToken) return;
    chart.set(bars, 'candle');
  } catch (e) {
    if (token !== loadToken) return;
    chart.set([], 'candle');
    note.hidden = false;
    note.textContent = `Chartdaten nicht verfügbar (${e.message}). Neuer Versuch bei Wiederverbindung.`;
  }
}

function recordEqBar(sym, price, qty, ts) {
  const t = Math.floor(ts / 60000) * 60000;
  const bars = (S.eqBars[sym] ||= []);
  const last = bars[bars.length - 1];
  if (last && last.t === t) {
    last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); last.c = price; last.v += qty;
  } else {
    bars.push({ t, o: price, h: price, l: price, c: price, v: qty });
    if (bars.length > 1440) bars.shift();
  }
  if (S.kind === 'eq' && S.active === sym) {
    chart.upsert(bars[bars.length - 1]);
    if (bars.length >= 2) $('gp-note').hidden = true;
  }
}

// ---------------------------------------------------------------- BOOK / TAPE

function renderBook() {
  const b = S.book;
  const body = $('book');
  $('book-title').textContent = `Orderbuch ${label(S.crypto)} · Top 12`;
  if (!b) return;
  const asks = b.asks.slice(0, 12);
  const bids = b.bids.slice(0, 12);
  let ca = 0;
  let cb = 0;
  const askRows = asks.map(([p, q]) => [p, q, (ca += q)]).reverse();
  const bidRows = bids.map(([p, q]) => [p, q, (cb += q)]);
  const max = Math.max(ca, cb) || 1;
  const row = (side, [p, q, c]) => {
    const tr = el('tr', side);
    const bar = el('td', 'r bar', fmtQty(c));
    const i = el('i');
    i.style.width = `${(c / max) * 100}%`;
    bar.prepend(i);
    tr.append(el('td', `r ${side === 'ask' ? 'down' : 'up'}`, fmtP(p)), el('td', 'r', fmtQty(q)), bar);
    return tr;
  };
  const spread = el('tr', 'spread');
  const best = asks[0] && bids[0] ? asks[0][0] - bids[0][0] : NaN;
  const mid = asks[0] && bids[0] ? (asks[0][0] + bids[0][0]) / 2 : NaN;
  const spreadTxt = Number.isFinite(best) ? best.toFixed(decimals(mid)) : '—';
  spread.append(Object.assign(el('td', null, `SPREAD ${spreadTxt} · ${((best / mid) * 1e4).toFixed(2)} bp`), { colSpan: 3 }));
  body.replaceChildren(...askRows.map((r) => row('ask', r)), spread, ...bidRows.map((r) => row('bid', r)));
}

function renderTape() {
  $('tape-title').textContent = `Time & Sales ${label(S.crypto)}`;
  $('tape').replaceChildren(...S.tape.map((t) => {
    const tr = el('tr');
    tr.append(el('td', 'dim', hhmmss(t.ts)), el('td', `r ${t.sell ? 'down' : 'up'}`, fmtP(t.price)), el('td', 'r', fmtQty(t.qty)));
    return tr;
  }));
}

// ---------------------------------------------------------------- MOST

async function refreshMovers() {
  try {
    const all = await feed.movers();
    const sorted = all.filter((m) => Number.isFinite(m.pct)).sort((a, b) => b.pct - a.pct);
    const row = (m) => {
      const tr = el('tr', 'clickable');
      tr.append(el('td', 'sym', label(m.sym)), el('td', 'r', fmtP(m.last)), el('td', `r ${cls(m.pct)}`, fmtPct(m.pct)));
      tr.addEventListener('click', () => load(m.sym, 'crypto'));
      return tr;
    };
    const n = Math.min(12, Math.floor(sorted.length / 2));
    $('most-up').replaceChildren(...sorted.slice(0, n).map(row));
    $('most-down').replaceChildren(...sorted.slice(sorted.length - n).reverse().map(row));
    $('most-ts').textContent = `Stand ${hhmmss(Date.now())} · ${sorted.length} liquide Paare · Aktualisierung alle 2 min`;
  } catch (e) {
    $('most-ts').textContent = `Movers nicht verfügbar (${e.message}). Neuer Versuch in 2 min.`;
  }
}

// ---------------------------------------------------------------- MKT: sessions, F&G, FX

const SESSIONS = [
  ['NYSE', 'America/New_York', [[570, 960]]],
  ['XETRA', 'Europe/Berlin', [[540, 1050]]],
  ['LSE', 'Europe/London', [[480, 990]]],
  ['TSE', 'Asia/Tokyo', [[540, 690], [750, 930]]],
  ['HKEX', 'Asia/Hong_Kong', [[570, 720], [780, 960]]],
];
const zoneParts = (tz, d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { wd: p.weekday, min: (+p.hour % 24) * 60 + +p.minute, hm: `${p.hour % 24}`.padStart(2, '0') + `:${p.minute}` };
};

function renderSessions() {
  const rowsOut = SESSIONS.map(([name, tz, spans]) => {
    const z = zoneParts(tz);
    const weekday = !['Sat', 'Sun'].includes(z.wd);
    const open = weekday && spans.some(([a, b]) => z.min >= a && z.min < b);
    const tr = el('tr');
    tr.append(el('td', 'sym', name), el('td', 'dim', z.hm), el('td', `r ${open ? 'up' : 'dim'}`, open ? 'OFFEN' : 'GESCHL.'));
    return tr;
  });
  const c = el('tr');
  c.append(el('td', 'sym', 'KRYPTO'), el('td', 'dim', '24/7'), el('td', 'r up', 'OFFEN'));
  const note = el('tr');
  note.append(Object.assign(el('td', 'dim', 'Regulärer Handel, ohne Feiertage'), { colSpan: 3 }));
  $('sessions').replaceChildren(c, ...rowsOut, note);
}

function renderClocks() {
  const zones = [['NY', 'America/New_York'], ['FRA', 'Europe/Berlin'], ['LDN', 'Europe/London'], ['TKO', 'Asia/Tokyo'], ['UTC', 'UTC']];
  $('clocks').replaceChildren(...zones.map(([n, tz]) => {
    const s = el('span', null, `${n} `);
    s.append(el('b', null, new Date().toLocaleTimeString('de-DE', { timeZone: tz, hour12: false })));
    return s;
  }));
}

async function refreshFNG() {
  const box = $('fng');
  try {
    const d = await fetchFearGreed();
    const now = d[0];
    const series = d.slice().reverse();
    const pts = series.map((x, i) => `${(i / (series.length - 1)) * 100},${28 - (x.value / 100) * 26}`).join(' ');
    box.innerHTML = `
      <div class="row"><span class="dim">KRYPTO FEAR &amp; GREED</span></div>
      <div class="row"><span class="val ${now.value >= 55 ? 'up' : now.value <= 45 ? 'down' : ''}">${now.value}</span><span>${esc(now.label.toUpperCase())}</span><span class="dim">30T</span></div>
      <div class="meter"><i style="left:${now.value}%"></i></div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--amber)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>
      <div class="dim">Quelle: alternative.me · täglich</div>`;
  } catch (e) {
    box.innerHTML = '';
    box.append(el('div', 'dim', `Fear & Greed nicht verfügbar (${e.message})`));
  }
}

async function refreshFX() {
  try {
    const { date, rates } = await fetchFX();
    const pairs = [
      ['EURUSD', 1 / rates.EUR], ['GBPUSD', 1 / rates.GBP], ['AUDUSD', 1 / rates.AUD], ['USDJPY', rates.JPY],
      ['USDCHF', rates.CHF], ['USDCAD', rates.CAD], ['USDCNY', rates.CNY], ['USDHKD', rates.HKD], ['USDSGD', rates.SGD],
      ['USDSEK', rates.SEK], ['USDNOK', rates.NOK], ['USDPLN', rates.PLN], ['USDTRY', rates.TRY], ['USDMXN', rates.MXN], ['USDINR', rates.INR],
      ['EURCHF', rates.CHF / rates.EUR], ['EURGBP', rates.GBP / rates.EUR],
    ].filter(([, v]) => Number.isFinite(v));
    $('fx').replaceChildren(...pairs.map(([p, v]) => {
      const tr = el('tr');
      tr.append(el('td', 'sym', p), el('td', 'r', v.toFixed(v >= 20 ? 3 : 5)));
      return tr;
    }));
    $('fx-ts').textContent = `EZB-Referenzkurse vom ${date} (einmal täglich, ~16:00 MEZ). Kein Live-FX. Live-Näherung: EUR/USDT im Monitor.`;
  } catch (e) {
    $('fx-ts').textContent = `FX nicht verfügbar (${e.message}).`;
  }
}

// ---------------------------------------------------------------- NEWS + equity quotes (Finnhub)

let finnhub = null;

async function refreshNews() {
  const box = $('news');
  if (!finnhub) {
    box.replaceChildren(el('p', null, 'Nachrichten und US-Aktien brauchen einen kostenlosen Finnhub-API-Key (finnhub.io → Get free API key). Dann: KEY <token> <GO>. Der Key bleibt nur in diesem Browser.'));
    return;
  }
  try {
    const items = await finnhub.news();
    box.replaceChildren(...items.slice(0, 40).map((n) => {
      const a = el('a');
      a.href = n.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.append(el('time', null, new Date(n.datetime * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })), document.createTextNode(n.headline), el('span', 'src', n.source));
      return a;
    }));
  } catch (e) {
    box.replaceChildren(el('p', null, `Nachrichten nicht verfügbar (${e.message}). Key prüfen: KEY <token>.`));
  }
}

async function refreshQuotes() {
  if (!finnhub) return;
  // Sequential with spacing: stays far below the free tier's 60 calls/min.
  for (const sym of S.eq) {
    try {
      const q = await finnhub.quote(sym);
      if (q && q.c) {
        const cur = S.eqq[sym];
        S.eqq[sym] = { last: cur?.ts > q.t * 1000 ? cur.last : q.c, open: q.pc, high: q.h, low: q.l, ts: Math.max(cur?.ts || 0, q.t * 1000) };
        mark('mon', 'head');
      }
    } catch { /* keep last known quote */ }
    await new Promise((r) => setTimeout(r, 400));
  }
}

function startFinnhub() {
  finnhub?.stop();
  finnhub = null;
  if (!S.key) {
    setStatus('FINNHUB', 'off');
    return;
  }
  finnhub = new FinnhubFeed(S.key, {
    onStatus: setStatus,
    onError: (_, m) => say(`FINNHUB: ${m}`, true),
    onEqTrade: ({ sym, price, qty, ts }) => {
      S.msgs++;
      const q = (S.eqq[sym] ||= { last: price, open: price, high: price, low: price, ts });
      q.last = price;
      q.high = Math.max(q.high, price);
      q.low = Math.min(q.low, price);
      q.ts = ts;
      recordEqBar(sym, price, qty, ts);
      mark('mon', 'head');
    },
  });
  finnhub.start(S.eq);
  refreshQuotes();
  refreshNews();
}

// ---------------------------------------------------------------- feed wiring

const lastStatus = {};
function setStatus(src, s) {
  // After an outage the chart has a gap: resync history on reconnect.
  if (src === 'BINANCE' && s === 'live' && ['down', 'stale'].includes(lastStatus[src])) {
    if (S.kind === 'crypto') loadChart();
    refreshMovers();
  }
  lastStatus[src] = s;
  const node = $(src === 'BINANCE' ? 'st-binance' : 'st-finnhub');
  const text = { live: 'LIVE', connecting: 'VERBINDE', stale: 'STOCKT', down: 'GETRENNT · RETRY', off: 'AUS', demo: 'DEMO' }[s] || s;
  node.className = `st ${s}`;
  node.innerHTML = `${src} <b>${s === 'live' ? '●' : '○'}</b> ${text}`;
}

const handlers = {
  onStatus: setStatus,
  onTicker(t) {
    S.msgs++;
    S.tick[t.sym] = t;
    mark('mon', 'head');
  },
  onKline(k) {
    S.msgs++;
    if (S.kind === 'crypto' && k.sym === S.active && k.interval === S.interval) chart.upsert(k.bar);
  },
  onDepth(d) {
    S.msgs++;
    if (d.sym === S.crypto) { S.book = d; mark('book'); }
  },
  onTrade(t) {
    S.msgs++;
    if (t.sym !== S.crypto) return;
    S.tape.unshift(t);
    if (S.tape.length > 80) S.tape.length = 80;
    mark('tape');
  },
};

const view = () => ({ watch: S.watch, active: S.crypto, interval: S.interval });
const feed = S.demo ? new DemoFeed(handlers) : new BinanceFeed(handlers);

// ---------------------------------------------------------------- commands

function normCrypto(sym) {
  const q = QUOTES.find((x) => sym.endsWith(x) && sym.length > x.length + 1);
  return q ? sym : `${sym}USDT`;
}

function maximize(panel) {
  const grid = $('grid');
  grid.querySelectorAll('.panel').forEach((p) => p.classList.toggle('max', p.dataset.panel === panel));
  grid.classList.toggle('has-max', !!panel);
  chart.resize();
}

async function load(sym, kind) {
  const prev = { active: S.active, kind: S.kind, crypto: S.crypto };
  S.active = sym;
  S.kind = kind;
  if (kind === 'crypto') S.crypto = sym;
  if (kind === 'crypto') {
    S.book = null;
    S.tape = [];
    $('book').replaceChildren();
    $('tape').replaceChildren();
    feed.update(view());
  }
  buildIntervals();
  mark('mon', 'head', 'book', 'tape');
  await loadChart();
  if (kind === 'crypto' && !$('gp-note').hidden && !chart.bars.length) {
    say(`${sym}: UNBEKANNTES WERTPAPIER`, true);
    Object.assign(S, prev);
    feed.update(view());
    buildIntervals();
    await loadChart();
    return;
  }
  persist();
  say(`${sym} ${kind === 'eq' ? 'US EQUITY' : 'CRYPTO'} GELADEN`);
}

let wakeLock = null;
async function kiosk() {
  try { await document.documentElement.requestFullscreen?.(); } catch { /* user gesture or unsupported */ }
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    say(wakeLock ? 'KIOSK AKTIV · BILDSCHIRM BLEIBT AN' : 'KIOSK: VOLLBILD (WAKE LOCK NICHT UNTERSTÜTZT)');
  } catch {
    say('KIOSK: WAKE LOCK ABGELEHNT');
  }
  store.set('kiosk', true);
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && store.get('kiosk', false) && wakeLock?.released !== false) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  }
});

const PANELS = { WEI: 'mon', MON: 'mon', BOOK: 'book', DOM: 'book', TAPE: 'tape', QR: 'tape', MOST: 'most', MOV: 'most', MKT: 'mkt', FX: 'mkt', FNG: 'mkt', N: 'news', NEWS: 'news', TOP: 'news', GP: 'gp' };

async function run(raw, { maximize: doMax = true } = {}) {
  const line = raw.toUpperCase().replace(/<?GO>?$/, '').trim();
  if (!line) return;
  const tok = line.split(/\s+/);
  const [cmd, arg] = tok;

  if (cmd === 'HELP' || cmd === 'H') return $('help').showModal();
  if (cmd === 'LP' || cmd === 'ESC') return maximize(null);
  if (cmd === 'KIOSK') return kiosk();
  if (cmd === 'DEMO' || cmd === 'LIVE') {
    store.set('demo', cmd === 'DEMO');
    location.href = location.pathname;
    return;
  }
  if (cmd === 'KEY') {
    if (!arg) return say('KEY <finnhub-token> oder KEY CLEAR', true);
    S.key = arg === 'CLEAR' ? '' : raw.trim().split(/\s+/)[1]; // tokens are case-sensitive
    store.set('finnhub', S.key);
    if (!S.key && S.kind === 'eq') await load(S.crypto, 'crypto');
    buildMon();
    startFinnhub();
    refreshNews();
    return say(S.key ? 'FINNHUB-KEY GESPEICHERT' : 'FINNHUB-KEY ENTFERNT');
  }
  if (cmd === 'ADD' || cmd === 'DEL') {
    if (!arg) return say(`${cmd} <SYMBOL>`, true);
    const eq = ['US', 'EQUITY', 'EQ'].includes(tok[2]);
    const list = eq ? 'eq' : 'watch';
    const sym = eq ? arg : normCrypto(arg);
    if (cmd === 'ADD' && !S[list].includes(sym)) S[list].push(sym);
    if (cmd === 'DEL') S[list] = S[list].filter((s) => s !== sym);
    persist();
    buildMon();
    feed.update(view());
    if (eq) finnhub?.update(S.eq);
    if (eq && cmd === 'ADD') refreshQuotes();
    return say(`${sym} ${cmd === 'ADD' ? 'HINZUGEFÜGT' : 'ENTFERNT'}`);
  }
  const iv = (x) => x && INTERVALS.find((i) => i.toUpperCase() === x);
  if (cmd === 'GP' || iv(cmd)) {
    const next = iv(cmd) || iv(arg);
    if (next && next !== S.interval) {
      S.interval = next;
      persist();
      buildIntervals();
      if (S.kind === 'crypto') { feed.update(view()); await loadChart(); }
      mark('head');
    }
    if (doMax && cmd === 'GP') maximize('gp');
    return;
  }
  if (PANELS[cmd]) return maximize(PANELS[cmd]);

  // Security load: "BTC", "ETHBTC", "AAPL US", "AAPL US EQUITY GP", "BTC CURNCY".
  if (!/^[A-Z0-9.\-]{1,20}$/.test(cmd)) return say(`UNBEKANNTER BEFEHL: ${line}`, true);
  const rest = tok.slice(1);
  const eq = rest.some((t) => ['US', 'EQUITY', 'EQ'].includes(t)) || (!rest.includes('CURNCY') && S.eq.includes(cmd) && !!S.key);
  if (eq && !S.key) return say('US-AKTIEN BRAUCHEN FINNHUB: KEY <token> <GO>', true);
  if (eq && !S.eq.includes(cmd)) {
    S.eq.push(cmd);
    persist();
    buildMon();
    finnhub?.update(S.eq);
    refreshQuotes();
  }
  const ivTok = rest.map(iv).find(Boolean);
  if (ivTok && !eq) { S.interval = ivTok; persist(); }
  await load(eq ? cmd : normCrypto(cmd), eq ? 'eq' : 'crypto');
  const fn = rest.find((t) => PANELS[t]);
  if (fn) maximize(PANELS[fn]);
}

// ---------------------------------------------------------------- input

const input = $('cmd');
$('cmd-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = input.value;
  input.value = '';
  S.hIdx = -1;
  const line = v.trim();
  if (line && !/^KEY\s/i.test(line)) {
    S.history = [line.toUpperCase(), ...S.history.filter((h) => h !== line.toUpperCase())].slice(0, 50);
    store.set('history', S.history);
  }
  run(v);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    S.hIdx = Math.max(-1, Math.min(S.history.length - 1, S.hIdx + (e.key === 'ArrowUp' ? 1 : -1)));
    input.value = S.hIdx < 0 ? '' : S.history[S.hIdx];
  }
});
const FKEYS = { F1: 'HELP', F2: 'WEI', F3: 'GP', F4: 'BOOK', F6: 'MOST', F7: 'N', F8: 'MKT' };
document.addEventListener('keydown', (e) => {
  if (FKEYS[e.key]) { e.preventDefault(); run(FKEYS[e.key]); return; }
  if (e.key === 'Escape' && !$('help').open) { maximize(null); input.value = ''; return; }
  const typing = document.activeElement === input || e.target.closest?.('dialog');
  if (!typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) input.focus();
});
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => run(b.dataset.cmd)));

// ---------------------------------------------------------------- boot

$('demo-banner').hidden = !S.demo;
buildMon();
buildIntervals();
renderSessions();
renderClocks();
feed.start(view());
loadChart();
refreshMovers();
refreshFNG();
refreshFX();
refreshNews();
startFinnhub();

setInterval(renderClocks, 1000);
setInterval(renderSessions, 30e3);
setInterval(refreshMovers, 120e3);
setInterval(refreshFNG, 30 * 60e3);
setInterval(refreshFX, 60 * 60e3);
setInterval(refreshNews, 5 * 60e3);
setInterval(refreshQuotes, 5 * 60e3);
setInterval(() => {
  $('st-rate').textContent = `${S.msgs} msg/s`;
  S.msgs = 0;
}, 1000);
// Charts drift from the stream after long disconnects; resync every 15 min.
setInterval(() => { if (S.kind === 'crypto') loadChart(); }, 15 * 60e3);
