// The glide drawn as a line: where the beat starts, where it settles, and
// (in a timed sit) where it comes back up. Band edges are faint guides.

import { BAND_EDGES, toSlider, type SoundParams } from '../../audio/params';
import { fmtHz } from '../beats';

const NS = 'http://www.w3.org/2000/svg';

export function curveSvg(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 48');
  svg.setAttribute('class', 'glide-curve');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  return svg;
}

/** Draw `p`'s beat over a sit of `minutes` (open-ended: drawn as 20). */
export function drawCurve(svg: SVGSVGElement, p: Pick<SoundParams, 'beatHz' | 'rampOn' | 'rampFrom' | 'rampMin' | 'rampReturn' | 'returnMin'>, minutes: number | null): void {
  const W = 300;
  const H = 48;
  const y = (hz: number) => H - 4 - toSlider('beatHz', hz) * (H - 8);
  const total = Math.max(p.rampMin + (p.rampReturn && minutes ? p.returnMin : 0) + 4, minutes || 20);
  const x = (m: number) => (m / total) * (W - 4) + 2;
  let d: string;
  if (!p.rampOn) d = `M2 ${y(p.beatHz)} H${W - 2}`;
  else {
    d = `M2 ${y(p.rampFrom)} C${x(p.rampMin * 0.5)} ${y(p.rampFrom)} ${x(p.rampMin * 0.5)} ${y(p.beatHz)} ${x(p.rampMin)} ${y(p.beatHz)}`;
    if (p.rampReturn && minutes) {
      const r0 = x(total - p.returnMin);
      d += ` H${r0} C${(r0 + W - 2) / 2} ${y(p.beatHz)} ${(r0 + W - 2) / 2} ${y(p.rampFrom)} ${W - 2} ${y(p.rampFrom)}`;
    } else d += ` H${W - 2}`;
  }
  const grid = BAND_EDGES.slice(1, -1).map((e) => `<path d="M0 ${y(e)} H${W}" class="glide-grid"/>`).join('');
  svg.innerHTML = `${grid}<path d="${d}" class="glide-path" vector-effect="non-scaling-stroke"/>`;
  svg.setAttribute('aria-label', p.rampOn ? `The beat glides from ${fmtHz(p.rampFrom)} to ${fmtHz(p.beatHz)} hertz over ${p.rampMin} minutes` : `The beat holds at ${fmtHz(p.beatHz)} hertz`);
}
