// Custom beat: every beat setting in one calm column. Choosing a frequency by
// hand makes the beat "Yours". While a glide runs, a live line says where it
// is now; it updates once a second, only while it can be seen.

import { fromSlider, toSlider } from '../../audio/params';
import { tunedCarrier } from '../../audio/shape';
import { bandName } from '../../audio/tuning';
import type { Snapshot } from '../../session/session';
import { BAND_USES, fmtHz } from '../beats';
import { h } from '../controls';
import { curveSvg, drawCurve } from './curve';
import type { Sheet, SheetEnv } from './host';
import { learnLink, paintRange, paramField, paramSwitch, range, segmented, sheetHead } from './parts';

const BANDS = ['Delta', 'Theta', 'Alpha', 'Beta', 'Gamma'];
/** A beat that was off eases in over a few seconds when a frequency is chosen. */
const EASE_IN = 1.5;

export function customBeatSheet(env: SheetEnv): Sheet {
  const { session } = env;
  const done = h('button', { class: 'btn', type: 'button' }, 'Done');
  done.addEventListener('click', () => env.back());

  const type = segmented<number>('Beat type', [
    { value: 0, label: 'Binaural' },
    { value: 1, label: 'Monaural' },
    { value: 2, label: 'Isochronic' },
  ], (m) => session.setParam('beatMode', m));
  env.hints.add(type.inputs[0], () => [{ b: 'Binaural.' }, { t: 'A different tone in each ear; your brain makes the beat. Needs headphones.' }]);
  env.hints.add(type.inputs[1], () => [{ b: 'Monaural.' }, { t: 'The beat is in the sound itself. Works on speakers.' }]);
  env.hints.add(type.inputs[2], () => [{ b: 'Isochronic.' }, { t: 'One tone, gently pulsed. Works on speakers.' }]);

  // The big number, and the glide's live line.
  const num = h('span', { class: 'beat-value__num' });
  const live = h('span', { class: 'beat-value__live', 'aria-live': 'off' });
  const value = h('div', { class: 'beat-value' }, h('span', {}, num, h('span', { class: 'beat-value__unit' }, ' Hz')), live);

  // Frequency: one slider, the five bands of equal width under it.
  const freq = range('Beat frequency');
  freq.classList.add('range--wide');
  freq.addEventListener('input', () => {
    paintRange(freq);
    // Choosing a frequency by hand turns the beat on (easing in), and makes it yours.
    session.setParams({ beatHz: fromSlider('beatHz', Number(freq.value) / 1000), beatOn: 1 }, session.params.beatOn ? undefined : EASE_IN);
  });
  env.hints.add(freq, () => [{ b: 'Frequency.' }, { t: 'The five bands get equal room on the slider. Arrow keys step it.' }]);
  const ruler = h('div', { class: 'band-ruler', 'aria-hidden': 'true' }, ...BANDS.map((b) => h('span', { 'data-band': b.toLowerCase() }, b)));
  const use = h('p', { class: 'sheet__help' });

  // Glide
  const glide = paramSwitch(env, 'rampOn', { label: 'Glide', help: 'Start at one beat and ease to another.' });
  const from = paramField(env, 'rampFrom', { label: 'Start at', format: (v) => `${fmtHz(v)} Hz`, onSet: (v) => session.setParams({ rampFrom: v, beatOn: 1 }, session.params.beatOn ? undefined : EASE_IN) });
  const over = paramField(env, 'rampMin', { label: 'Over' });
  const curve = curveSvg();
  const back = paramSwitch(env, 'rampReturn', { label: 'Come back up at the end' });
  const backOver = paramField(env, 'returnMin', { label: 'Over' });
  const glideParts = h('div', { class: 'panel__parts' }, from.el, over.el, curve);
  const glidePanel = h('div', { class: 'panel' }, glide.el, glideParts, back.el, backOver.el);

  // Level and carrier
  const level = paramField(env, 'beatLevel');
  const tuned = paramSwitch(env, 'carrierTuned');
  const carrier = paramField(env, 'carrier');
  const tonePanel = h('div', { class: 'panel' }, level.el, tuned.el, carrier.el);

  const links = h('div', { class: 'links' }, learnLink(env, 'How they work', 'binaural-beats'), learnLink(env, 'What the bands are', 'brainwave-bands'), learnLink(env, 'The evidence', 'evidence'));

  const el = h('div', {}, sheetHead('Custom beat', done), type.el, h('p', { class: 'sheet__help' }, 'Binaural needs headphones. The other two work on speakers.'), value, freq, ruler, use, glidePanel, tonePanel, links);

  const updateLive = () => {
    const now = session.phase === 'playing' ? session.beatHzNow() : null;
    const p = session.params;
    const gliding = now !== null && !!p.beatOn && Math.abs(now - p.beatHz) > 0.05;
    const text = gliding && now !== null ? `Now ${fmtHz(now)} Hz, gliding to ${fmtHz(p.beatHz)}` : '';
    if (live.textContent !== text) live.textContent = text;
  };
  const timer = setInterval(() => {
    if (!document.hidden && el.isConnected) updateLive();
  }, 1000);

  return {
    el,
    label: 'Custom beat',
    parent: 'beat',
    rest: () => [{ b: 'Glide' }, { t: 'starts the beat higher and eases it down at the start of a sit.' }],
    initialFocus: () => type.inputs.find((i) => i.checked) ?? type.inputs[0],
    dispose: () => clearInterval(timer),
    render(s: Snapshot) {
      const p = s.params;
      type.set(p.beatMode);
      num.textContent = p.beatHz < 10 ? p.beatHz.toFixed(1) : String(Math.round(p.beatHz));
      if (!freq.matches(':active')) freq.value = String(Math.round(toSlider('beatHz', p.beatHz) * 1000));
      paintRange(freq);
      const band = bandName(p.beatHz);
      freq.setAttribute('aria-valuetext', `${fmtHz(p.beatHz)} hertz, ${band}`);
      for (const sp of ruler.querySelectorAll<HTMLElement>('span')) sp.toggleAttribute('data-active', sp.dataset.band === band);
      use.textContent = `${BAND_USES[band]} These are common uses, not proven effects.`;
      updateLive();
      glide.refresh(s);
      glideParts.hidden = !p.rampOn;
      back.el.hidden = !p.rampOn;
      backOver.el.hidden = !p.rampOn || !p.rampReturn;
      from.refresh(s);
      over.refresh(s);
      back.refresh(s);
      backOver.refresh(s);
      if (p.rampOn) drawCurve(curve, p, s.prefs.minutes);
      level.refresh(s);
      tuned.refresh(s);
      const help = tuned.el.querySelector('.row__help');
      if (help) help.textContent = `The carrier sits on a harmonic of the drone (now ${Math.round(tunedCarrier(p))} Hz). Turn off to set it yourself, 100–400 Hz.`;
      carrier.el.hidden = !!p.carrierTuned;
      carrier.refresh(s);
    },
  };
}
