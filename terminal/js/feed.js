// Data layer. Every source is keyless except Finnhub (optional, free key).
// Endpoints follow the official Binance spot docs: market-data-only hosts,
// 24h connection limit, serverShutdown event, max 1024 streams/connection.

const BINANCE_WS = 'wss://data-stream.binance.vision/stream?streams=';
const BINANCE_REST = 'https://data-api.binance.vision/api/v3';
const FINNHUB_WS = 'wss://ws.finnhub.io?token=';
const FINNHUB_REST = 'https://finnhub.io/api/v1';
const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,JPY,GBP,CHF,CNY,CAD,AUD,HKD,SGD,SEK,NOK,PLN,TRY,MXN,INR';
const FNG_URL = 'https://api.alternative.me/fng/?limit=30';

const num = (v) => (v == null ? NaN : +v);

async function getJSON(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// WebSocket that survives anything a 24/7 screen runs into: drops, sleep,
// network changes, silent stalls and the exchange's forced 24h disconnect.
export class ResilientSocket {
  constructor({ url, onMessage, onStatus, onOpen, staleMs = 20000, maxLifeMs = 23.5 * 3600e3 }) {
    Object.assign(this, { url, onMessage, onStatus, onOpen, staleMs, maxLifeMs });
    this.ws = null;
    this.attempt = 0;
    this.lastMsg = 0;
    this.retryTimer = null;
    this.stopped = true;
    this.status = 'off';
    this.watchdog = null;
    this._online = () => this.reconnect(true);
    this._visible = () => {
      if (document.visibilityState === 'visible' && Date.now() - this.lastMsg > this.staleMs) this.reconnect(true);
    };
  }

  setStatus(s) {
    if (s !== this.status) {
      this.status = s;
      this.onStatus?.(s);
    }
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    window.addEventListener('online', this._online);
    document.addEventListener('visibilitychange', this._visible);
    this.watchdog = setInterval(() => this.check(), 5000);
    this.open();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watchdog);
    clearTimeout(this.retryTimer);
    window.removeEventListener('online', this._online);
    document.removeEventListener('visibilitychange', this._visible);
    this.teardown();
    this.setStatus('off');
  }

  setUrl(url) {
    if (url === this.url) return;
    this.url = url;
    if (!this.stopped) this.reconnect(true);
  }

  open() {
    clearTimeout(this.retryTimer);
    this.teardown();
    this.setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(typeof this.url === 'function' ? this.url() : this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.openedAt = Date.now();
    ws.onopen = () => {
      this.attempt = 0;
      this.lastMsg = Date.now();
      this.setStatus('live');
      this.onOpen?.(this);
    };
    ws.onmessage = (ev) => {
      this.lastMsg = Date.now();
      if (this.status !== 'live') this.setStatus('live');
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.onMessage?.(msg, this);
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.scheduleRetry();
      }
    };
    ws.onerror = () => {};
  }

  teardown() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch { /* already closed */ }
    }
  }

  scheduleRetry() {
    if (this.stopped) return;
    this.setStatus('down');
    // Exponential backoff with jitter, capped at 30 s.
    const base = Math.min(30000, 1000 * 2 ** this.attempt++);
    this.retryTimer = setTimeout(() => this.open(), base * (0.5 + Math.random() / 2));
  }

  reconnect(immediate = false) {
    if (this.stopped) return;
    this.attempt = immediate ? 0 : this.attempt;
    this.open();
  }

  check() {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - this.lastMsg > this.staleMs) {
      this.setStatus('stale');
      this.reconnect(true);
    } else if (now - this.openedAt > this.maxLifeMs) {
      this.reconnect(true); // rotate before the server's hard 24h cut
    }
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
}

// ---------------------------------------------------------------- Binance

export class BinanceFeed {
  constructor(handlers) {
    this.h = handlers;
    this.sock = null;
    this.name = 'BINANCE';
  }

  streamsFor({ watch, active, interval }) {
    const s = new Set(watch.map((w) => `${w.toLowerCase()}@miniTicker`));
    const a = active.toLowerCase();
    s.add(`${a}@miniTicker`);
    s.add(`${a}@kline_${interval}`);
    s.add(`${a}@depth20@1000ms`);
    s.add(`${a}@aggTrade`);
    return BINANCE_WS + [...s].slice(0, 1000).join('/');
  }

  start(view) {
    this.sock = new ResilientSocket({
      url: this.streamsFor(view),
      onStatus: (s) => this.h.onStatus?.('BINANCE', s),
      onMessage: (m) => this.route(m),
    });
    this.sock.start();
  }

  update(view) {
    this.sock?.setUrl(this.streamsFor(view));
  }

  stop() {
    this.sock?.stop();
  }

  route(msg) {
    const d = msg.data;
    if (!d) return;
    if (d.e === 'serverShutdown') return this.sock.reconnect(true);
    if (d.e === '24hrMiniTicker') {
      this.h.onTicker?.({
        sym: d.s, last: num(d.c), open: num(d.o), high: num(d.h), low: num(d.l),
        vol: num(d.v), qvol: num(d.q), ts: d.E,
      });
    } else if (d.e === 'kline') {
      const k = d.k;
      this.h.onKline?.({
        sym: k.s, interval: k.i,
        bar: { t: k.t, o: num(k.o), h: num(k.h), l: num(k.l), c: num(k.c), v: num(k.v) },
        closed: k.x, ts: d.E,
      });
    } else if (d.e === 'aggTrade') {
      this.h.onTrade?.({ sym: d.s, price: num(d.p), qty: num(d.q), ts: d.T, sell: d.m });
    } else if (d.bids && d.asks) {
      const sym = msg.stream.split('@')[0].toUpperCase();
      this.h.onDepth?.({
        sym,
        bids: d.bids.map(([p, q]) => [num(p), num(q)]),
        asks: d.asks.map(([p, q]) => [num(p), num(q)]),
      });
    }
  }

  async klines(sym, interval, limit = 300) {
    const rows = await getJSON(`${BINANCE_REST}/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
    return rows.map((r) => ({ t: r[0], o: num(r[1]), h: num(r[2]), l: num(r[3]), c: num(r[4]), v: num(r[5]) }));
  }

  // MINI payload has no priceChangePercent, so it is derived from open/last.
  async movers() {
    const rows = await getJSON(`${BINANCE_REST}/ticker/24hr?type=MINI&symbolStatus=TRADING`, 15000);
    return rows
      .filter((r) => r.symbol.endsWith('USDT') && num(r.quoteVolume) > 5e6 && num(r.openPrice) > 0)
      .map((r) => ({
        sym: r.symbol,
        last: num(r.lastPrice),
        pct: ((num(r.lastPrice) - num(r.openPrice)) / num(r.openPrice)) * 100,
        qvol: num(r.quoteVolume),
      }));
  }
}

// ---------------------------------------------------------------- Finnhub (optional)

export class FinnhubFeed {
  constructor(key, handlers) {
    this.key = key;
    this.h = handlers;
    this.subs = new Set();
    this.sock = null;
  }

  start(symbols) {
    this.want = new Set(symbols);
    this.sock = new ResilientSocket({
      url: FINNHUB_WS + encodeURIComponent(this.key),
      // US equities are silent outside market hours; a short stale timer
      // would reconnect-loop all weekend. Finnhub sends pings to keep alive.
      staleMs: 5 * 60e3,
      onStatus: (s) => this.h.onStatus?.('FINNHUB', s),
      onOpen: (sock) => {
        this.subs.clear();
        for (const s of this.want) this.sub(s, sock);
      },
      onMessage: (m) => {
        if (m.type === 'trade') {
          for (const t of m.data) this.h.onEqTrade?.({ sym: t.s, price: t.p, qty: t.v, ts: t.t });
        } else if (m.type === 'error') {
          this.h.onError?.('FINNHUB', m.msg);
        }
      },
    });
    this.sock.start();
  }

  sub(sym, sock = this.sock) {
    sock.send({ type: 'subscribe', symbol: sym });
    this.subs.add(sym);
  }

  update(symbols) {
    this.want = new Set(symbols);
    for (const s of this.subs) if (!this.want.has(s)) { this.sock.send({ type: 'unsubscribe', symbol: s }); this.subs.delete(s); }
    for (const s of this.want) if (!this.subs.has(s)) this.sub(s);
  }

  stop() {
    this.sock?.stop();
  }

  quote(sym) {
    return getJSON(`${FINNHUB_REST}/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(this.key)}`);
  }

  news() {
    return getJSON(`${FINNHUB_REST}/news?category=general&token=${encodeURIComponent(this.key)}`);
  }
}

// ---------------------------------------------------------------- Slow reference data

export async function fetchFX() {
  const j = await getJSON(FX_URL);
  return { date: j.date, rates: j.rates };
}

export async function fetchFearGreed() {
  const j = await getJSON(FNG_URL);
  return j.data.map((d) => ({ value: +d.value, label: d.value_classification, ts: +d.timestamp * 1000 }));
}

// ---------------------------------------------------------------- Demo (offline, clearly labelled)

const SEED = { BTCUSDT: 64000, ETHUSDT: 3200, SOLUSDT: 150, BNBUSDT: 580, XRPUSDT: 0.6, DOGEUSDT: 0.13,
  ADAUSDT: 0.45, AVAXUSDT: 28, LINKUSDT: 14, PAXGUSDT: 2600, EURUSDT: 1.09, DOTUSDT: 6 };
const IV_MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };

export class DemoFeed {
  constructor(handlers) {
    this.h = handlers;
    this.px = {};
    this.open24 = {};
    this.name = 'DEMO';
  }

  price(sym) {
    if (!(sym in this.px)) {
      this.px[sym] = SEED[sym] ?? 1 + Math.random() * 50;
      this.open24[sym] = this.px[sym] * (1 + (Math.random() - 0.5) * 0.06);
    }
    return this.px[sym];
  }

  step(sym) {
    const p = this.price(sym) * (1 + (Math.random() - 0.5) * 0.0016);
    this.px[sym] = p;
    return p;
  }

  start(view) {
    this.view = view;
    this.h.onStatus?.('BINANCE', 'demo');
    this.timer = setInterval(() => this.tick(), 1000);
    this.fast = setInterval(() => this.trades(), 250);
  }

  update(view) {
    this.view = view;
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.fast);
  }

  tick() {
    const { watch, active, interval } = this.view;
    const now = Date.now();
    for (const s of new Set([...watch, active])) {
      const c = this.step(s);
      const o = this.open24[s];
      this.h.onTicker?.({ sym: s, last: c, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, vol: 1e4, qvol: 1e4 * c, ts: now });
    }
    const p = this.px[active];
    const step = IV_MS[interval];
    const t = Math.floor(now / step) * step;
    if (!this.bar || this.bar.t !== t) this.bar = { t, o: p, h: p, l: p, c: p, v: 0 };
    Object.assign(this.bar, { h: Math.max(this.bar.h, p), l: Math.min(this.bar.l, p), c: p, v: this.bar.v + Math.random() * 20 });
    this.h.onKline?.({ sym: active, interval, bar: { ...this.bar }, closed: false, ts: now });
    const tick = p * 0.0001;
    const lvl = (side) => Array.from({ length: 20 }, (_, i) => [p + side * tick * (i + 1), Math.random() * 3]);
    this.h.onDepth?.({ sym: active, bids: lvl(-1), asks: lvl(1) });
  }

  trades() {
    const s = this.view.active;
    const p = this.price(s);
    this.h.onTrade?.({ sym: s, price: p * (1 + (Math.random() - 0.5) * 0.0002), qty: Math.random() * 2, ts: Date.now(), sell: Math.random() < 0.5 });
  }

  async klines(sym, interval, limit = 300) {
    const step = IV_MS[interval];
    const end = Math.floor(Date.now() / step) * step;
    const out = [];
    let p = 1;
    for (let i = limit - 1; i >= 0; i--) {
      const o = p;
      const c = o * (1 + (Math.random() - 0.5) * 0.01);
      out.push({ t: end - i * step, o, c, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, v: Math.random() * 100 });
      p = c;
    }
    // Scale the walk so it ends exactly at the live demo price.
    const k = this.price(sym) / p;
    return out.map((b) => ({ ...b, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k }));
  }

  async movers() {
    return Object.keys(SEED).map((sym) => {
      const last = this.price(sym);
      return { sym, last, pct: ((last - this.open24[sym]) / this.open24[sym]) * 100, qvol: 1e8 * Math.random() };
    });
  }
}
