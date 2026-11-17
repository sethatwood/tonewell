// The well: a music box's mainspring as the play control and the timer.
// An engraved ring of minute ticks with a brass arc for the time wound.
// Drag around it to wind in 5-minute detents; click to start; it runs down
// once a minute while playing and cools to ember when resting.

import type { Snapshot } from '../session/session';
import { h } from './controls';

const NS = 'http://www.w3.org/2000/svg';
const R_ARC = 43;
const C = 2 * Math.PI * R_ARC;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export interface WellHandlers {
  go(): void;
  /** Wind by a number of minutes (a multiple of 5). */
  wind(delta: number): void;
}

export class Well {
  readonly el: HTMLButtonElement;
  private readonly arc: SVGCircleElement;
  private readonly lap: SVGCircleElement;
  private readonly pin: SVGCircleElement;
  private readonly numeral: HTMLSpanElement;
  private readonly caption: HTMLSpanElement;
  private readonly glyph: HTMLSpanElement;
  private winding = false;
  private windMinutes: number | null = null;
  private lastSnap: Snapshot | null = null;

  constructor(private readonly handlers: WellHandlers) {
    const svg = svgEl('svg', { viewBox: '0 0 96 96', class: 'well-ring', 'aria-hidden': 'true' });
    const ticks = svgEl('g', { class: 'well-ticks' });
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const long = i % 5 === 0;
      const r1 = long ? 39.5 : 41.5;
      const r2 = 46;
      ticks.append(svgEl('line', {
        x1: 48 + r1 * Math.cos(a), y1: 48 + r1 * Math.sin(a),
        x2: 48 + r2 * Math.cos(a), y2: 48 + r2 * Math.sin(a),
      }));
    }
    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', { id: 'brass', x1: '0', y1: '0', x2: '1', y2: '1' });
    grad.append(svgEl('stop', { offset: '0', 'stop-color': 'var(--accent-hi)' }), svgEl('stop', { offset: '1', 'stop-color': 'var(--accent-lo)' }));
    defs.append(grad);
    this.lap = svgEl('circle', { class: 'well-lap', cx: 48, cy: 48, r: 36.5 });
    this.arc = svgEl('circle', {
      class: 'well-arc', cx: 48, cy: 48, r: R_ARC, transform: 'rotate(-90 48 48)',
      'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': C.toFixed(2),
    });
    this.pin = svgEl('circle', { class: 'well-pin', cx: 48, cy: 48 - R_ARC, r: 3.2 });
    svg.append(defs, ticks, this.lap, this.arc, this.pin);

    this.numeral = h('span', { class: 'well-numeral voice' });
    this.caption = h('span', { class: 'well-caption' });
    this.glyph = h('span', { class: 'well-glyph', 'aria-hidden': 'true' });
    const mouth = h('span', { class: 'well-mouth' }, h('span', { class: 'well-glow', 'aria-hidden': 'true' }), this.glyph, this.numeral, this.caption);
    this.el = h('button', { class: 'well', type: 'button' });
    this.el.append(svg, mouth);
    this.bindPointer();
  }

  private bindPointer(): void {
    let start: { x: number; y: number; angle: number; acc: number } | null = null;
    const center = () => {
      const r = this.el.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.suppressClick = false;
      const { cx, cy } = center();
      start = { x: e.clientX, y: e.clientY, angle: Math.atan2(e.clientY - cy, e.clientX - cx), acc: 0 };
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!this.winding && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      this.winding = true;
      this.el.classList.add('is-winding');
      const { cx, cy } = center();
      const a = Math.atan2(e.clientY - cy, e.clientX - cx);
      let d = a - start.angle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      start.angle = a;
      start.acc += (d / (Math.PI * 2)) * 60;
      // One detent per 5 minutes of arc.
      while (start.acc >= 5) {
        start.acc -= 5;
        this.handlers.wind(5);
      }
      while (start.acc <= -5) {
        start.acc += 5;
        this.handlers.wind(-5);
      }
    });
    const finish = (e: PointerEvent) => {
      if (!start) return;
      const wasWinding = this.winding;
      start = null;
      this.winding = false;
      this.el.classList.remove('is-winding');
      if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
      if (wasWinding) {
        e.preventDefault();
        this.suppressClick = true;
        if (this.lastSnap) this.render(this.lastSnap);
      }
    };
    this.el.addEventListener('pointerup', finish);
    this.el.addEventListener('pointercancel', finish);
    this.el.addEventListener('click', (e) => {
      if (this.suppressClick) {
        this.suppressClick = false;
        e.preventDefault();
        return;
      }
      this.handlers.go();
    });
    let wheelAcc = 0;
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) >= 40) {
        this.handlers.wind(wheelAcc < 0 ? 5 : -5);
        wheelAcc = 0;
      }
    }, { passive: false });
  }

  private suppressClick = false;

  render(s: Snapshot): void {
    this.lastSnap = s;
    const running = s.phase === 'playing' || s.phase === 'winding' || s.phase === 'resting' || s.phase === 'ending';
    let minutes: number | null;
    if (s.phase === 'ready') minutes = s.prefs.minutes;
    else if (s.remaining !== null) minutes = s.remaining / 60;
    else minutes = null;
    this.windMinutes = minutes;

    // The arc: wound length when ready, time left when running; a full still ring when open.
    const shown = minutes === null ? (running ? 60 : 0) : Math.min(60, minutes);
    const frac = shown / 60;
    this.arc.setAttribute('stroke-dashoffset', (C * (1 - frac)).toFixed(2));
    const a = frac * Math.PI * 2 - Math.PI / 2;
    this.pin.setAttribute('cx', (48 + R_ARC * Math.cos(a)).toFixed(2));
    this.pin.setAttribute('cy', (48 + R_ARC * Math.sin(a)).toFixed(2));
    this.pin.style.opacity = minutes === null || shown <= 0 ? '0' : '1';
    this.lap.style.opacity = minutes !== null && minutes > 60 ? '1' : '0';

    const whole = minutes === null ? null : Math.max(0, Math.ceil(minutes - 1e-6));
    let label: string;
    this.el.dataset.state = s.phase;
    this.el.dataset.open = String(minutes === null);
    if (this.winding || (s.phase === 'ready' && this.el.classList.contains('is-winding'))) {
      this.numeral.textContent = whole === null ? 'Open' : String(whole);
      this.caption.textContent = whole === null ? '' : 'min';
    }
    switch (s.phase) {
      case 'ready':
        this.numeral.textContent = this.winding ? (whole === null ? 'Open' : String(whole)) : '';
        this.caption.textContent = this.winding && whole !== null ? 'min' : '';
        this.glyph.dataset.glyph = this.winding ? '' : 'play';
        label = `Start ${s.preset.name}${whole === null ? ', open-ended' : `, ${whole} minutes`}. Drag around the ring to wind the timer.`;
        break;
      case 'playing':
        this.numeral.textContent = whole === null ? '' : String(whole);
        this.caption.textContent = whole === null ? '' : 'min';
        this.glyph.dataset.glyph = whole === null ? 'horizon' : '';
        label = `Wind down. ${whole === null ? 'Open-ended session' : `${whole} minutes left`}.`;
        break;
      case 'winding':
      case 'resting':
      case 'ending':
        this.numeral.textContent = '';
        this.caption.textContent = '';
        this.glyph.dataset.glyph = 'play';
        label = s.phase === 'ending' ? 'Ending' : 'Resume';
        break;
    }
    this.el.setAttribute('aria-label', label);

    // The glow breathes with the drone's filter sweep, in Meditate only.
    this.el.style.setProperty('--sweep', `${s.params.sweepPeriod}s`);
    this.el.style.setProperty('--sweep-delay', `${-s.sweepPhase}s`);
  }

  get minutes(): number | null {
    return this.windMinutes;
  }
}
