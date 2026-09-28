// Dependency-free canvas chart: candles or line, volume, SMA20, crosshair.
// No CDN at runtime, so the terminal keeps working if a CDN is down.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Chart {
  constructor(canvas, readout) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.readout = readout;
    this.bars = [];
    this.mode = 'candle';
    this.hover = null;
    this.dirty = true;
    this.fmt = (v) => v.toFixed(2);
    new ResizeObserver(() => { this.resize(); }).observe(canvas.parentElement);
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.dirty = true;
    });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.dirty = true; });
    const loop = () => {
      if (this.dirty) { this.dirty = false; this.draw(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.cv.parentElement;
    this.w = w;
    this.h = h;
    this.cv.width = Math.max(1, w * dpr);
    this.cv.height = Math.max(1, h * dpr);
    this.cv.style.width = `${w}px`;
    this.cv.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  set(bars, mode = 'candle') {
    this.bars = bars.slice(-1000);
    this.mode = mode;
    this.dirty = true;
  }

  upsert(bar) {
    const last = this.bars[this.bars.length - 1];
    if (last && last.t === bar.t) Object.assign(last, bar);
    else if (!last || bar.t > last.t) {
      this.bars.push({ ...bar });
      if (this.bars.length > 1000) this.bars.shift();
    }
    this.dirty = true;
  }

  draw() {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    const C = {
      bg: css('--bg-panel'), grid: css('--grid'), text: css('--muted'), up: css('--up'),
      down: css('--down'), amber: css('--amber'), line: css('--fg'), sma: css('--cyan'),
    };
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
    const axisW = 72;
    const timeH = 16;
    const plotW = w - axisW;
    const volH = Math.round((h - timeH) * 0.18);
    const priceH = h - timeH - volH - 6;
    const slot = 7;
    const n = Math.max(10, Math.min(this.bars.length, Math.floor(plotW / slot)));
    const bars = this.bars.slice(-n);
    ctx.font = `11px ${css('--mono')}`;
    if (!bars.length) {
      ctx.fillStyle = C.text;
      ctx.fillText('KEINE DATEN', 12, 20);
      return;
    }
    let lo = Infinity;
    let hi = -Infinity;
    let vmax = 0;
    for (const b of bars) {
      lo = Math.min(lo, this.mode === 'line' ? b.c : b.l);
      hi = Math.max(hi, this.mode === 'line' ? b.c : b.h);
      vmax = Math.max(vmax, b.v || 0);
    }
    if (hi === lo) { hi += hi * 0.001 || 1; lo -= lo * 0.001 || 1; }
    const pad = (hi - lo) * 0.06;
    hi += pad;
    lo -= pad;
    const y = (p) => 4 + (1 - (p - lo) / (hi - lo)) * (priceH - 8);
    const x = (i) => plotW - (n - i) * slot + slot / 2;

    // Grid + price axis
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = C.text;
    ctx.textBaseline = 'middle';
    const ticks = 6;
    for (let i = 0; i <= ticks; i++) {
      const p = lo + ((hi - lo) * i) / ticks;
      const yy = Math.round(y(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
      ctx.fillText(this.fmt(p), plotW + 6, yy);
    }
    // Time axis
    ctx.textBaseline = 'alphabetic';
    const span = bars[bars.length - 1].t - bars[0].t;
    const daily = span > 3 * 86400e3;
    for (let i = 0; i < bars.length; i += Math.ceil(bars.length / 6)) {
      const d = new Date(bars[i].t);
      const label = daily
        ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
        : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(label, x(i) - 14, h - 3);
    }

    // Volume
    const vTop = priceH + 6;
    bars.forEach((b, i) => {
      if (!vmax) return;
      const vh = ((b.v || 0) / vmax) * volH;
      ctx.fillStyle = b.c >= b.o ? C.up : C.down;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x(i) - 2, vTop + volH - vh, 4, vh);
    });
    ctx.globalAlpha = 1;

    // Price
    if (this.mode === 'line') {
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      bars.forEach((b, i) => (i ? ctx.lineTo(x(i), y(b.c)) : ctx.moveTo(x(i), y(b.c))));
      ctx.stroke();
    } else {
      bars.forEach((b, i) => {
        const col = b.c >= b.o ? C.up : C.down;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        const xx = Math.round(x(i)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(xx, y(b.h));
        ctx.lineTo(xx, y(b.l));
        ctx.stroke();
        const top = y(Math.max(b.o, b.c));
        ctx.fillRect(xx - 2.5, top, 5, Math.max(1, y(Math.min(b.o, b.c)) - top));
      });
      // SMA 20 over the full history, drawn for visible part.
      const all = this.bars;
      const off = all.length - bars.length;
      ctx.strokeStyle = C.sma;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      let sum = 0;
      for (let j = 0; j < all.length; j++) {
        sum += all[j].c;
        if (j >= 20) sum -= all[j - 20].c;
        if (j >= 19 && j >= off) {
          const px = x(j - off);
          const py = y(sum / 20);
          if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
        }
      }
      ctx.stroke();
    }

    // Last price marker
    const last = bars[bars.length - 1];
    const ly = Math.round(y(last.c)) + 0.5;
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = C.amber;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(plotW, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.amber;
    ctx.fillRect(plotW, ly - 8, axisW, 16);
    ctx.fillStyle = C.bg;
    ctx.textBaseline = 'middle';
    ctx.fillText(this.fmt(last.c), plotW + 6, ly);

    // Crosshair + readout
    let rb = last;
    if (this.hover && this.hover.x < plotW) {
      const i = Math.max(0, Math.min(bars.length - 1, Math.round((this.hover.x - plotW) / slot + n - 0.5)));
      rb = bars[i] || last;
      ctx.strokeStyle = C.text;
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      ctx.moveTo(x(i), 0);
      ctx.lineTo(x(i), h - timeH);
      ctx.moveTo(0, this.hover.y);
      ctx.lineTo(plotW, this.hover.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.readout) {
      const d = new Date(rb.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      this.readout.textContent = this.mode === 'line'
        ? `${d}  LAST ${this.fmt(rb.c)}`
        : `${d}  O ${this.fmt(rb.o)}  H ${this.fmt(rb.h)}  L ${this.fmt(rb.l)}  C ${this.fmt(rb.c)}`;
    }
  }
}
