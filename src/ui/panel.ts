// The expanded panel: the box's lid opened. Three sections under the mini
// player: Sound (every layer), Beat (binaural and friends) and Session.

import { BAND_EDGES, PARAMS, formatParam, toSlider, type ParamId } from '../audio/params';
import { bandName, noteName } from '../audio/tuning';
import { tunedCarrier } from '../audio/shape';
import type { Session, Snapshot } from '../session/session';
import { ICONS, h, icon, paramScale, radios, scale, switchControl } from './controls';

interface Layer {
  key: string;
  label: string;
  on?: ParamId;
  level: ParamId;
  detail: ParamId[];
}

const LAYERS: Layer[] = [
  { key: 'drone', label: 'Drone', on: 'droneOn', level: 'droneLevel', detail: ['voicing', 'root', 'justTuning', 'a432', 'cutoff', 'resonance', 'sweepPeriod', 'sweepDepth', 'edge', 'detune', 'droneWidth', 'sub', 'walkOn', 'walkPattern', 'walkEvery', 'glide'] },
  { key: 'breath', label: 'Breath', on: 'breathOn', level: 'breathLevel', detail: ['breathCenter', 'breathPeriod', 'breathDepth', 'breathQ'] },
  { key: 'bells', label: 'Bells', on: 'bellsOn', level: 'bellsLevel', detail: ['bellsDensity', 'bellsScale', 'bellsRegister', 'bellsDecay', 'bellsSpread', 'echoTime', 'echoFeedback'] },
  { key: 'shimmer', label: 'Shimmer', on: 'shimmerOn', level: 'shimmerLevel', detail: [] },
  { key: 'noise', label: 'Noise bed', on: 'noiseOn', level: 'noiseLevel', detail: ['noiseColor', 'noiseTone'] },
  { key: 'rain', label: 'Rain', on: 'rainOn', level: 'rainLevel', detail: ['rainDensity'] },
  { key: 'ocean', label: 'Ocean', on: 'oceanOn', level: 'oceanLevel', detail: [] },
  { key: 'wind', label: 'Wind', on: 'windOn', level: 'windLevel', detail: [] },
  { key: 'shepard', label: 'Endless rise', on: 'shepardOn', level: 'shepardLevel', detail: ['shepardMinutes'] },
  { key: 'space', label: 'Space', level: 'reverbMix', detail: ['reverbSize', 'reverbTone', 'width', 'autopan'] },
  { key: 'drift', label: 'Drift', level: 'driftAmount', detail: ['driftSpeed'] },
];

type Refresher = (s: Snapshot) => void;

export class Panel {
  readonly el: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly views: HTMLElement[] = [];
  private refreshers: Refresher[] = [];
  private readonly editedBar: HTMLElement;
  private readonly editedSave: HTMLButtonElement;
  private soundView!: HTMLElement;
  private openLayer: string | null = null;
  private layerOrderKey = '';

  constructor(private readonly session: Session, private readonly openLearn: (card: string) => void, ask: (q: string, def: string) => Promise<string | null>) {
    const names = ['Sound', 'Beat', 'Session'];
    const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Controls' });
    names.forEach((n, i) => {
      const t = h('button', { role: 'tab', id: `tab-${n.toLowerCase()}`, 'aria-controls': `view-${n.toLowerCase()}`, 'aria-selected': String(i === 0), tabindex: i === 0 ? 0 : -1 }, n);
      t.addEventListener('click', () => this.select(i));
      this.tabs.push(t);
      tablist.append(t);
    });
    tablist.addEventListener('keydown', (e) => {
      const i = this.tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length;
        this.select(j);
        this.tabs[j].focus();
      }
    });

    this.editedSave = h('button', { class: 'btn' }, 'Save');
    this.editedSave.addEventListener('click', () => session.savePreset());
    const saveAs = h('button', { class: 'btn' }, 'Save as new');
    saveAs.addEventListener('click', async () => {
      const name = await ask('Name your preset', `${session.preset.name} (mine)`);
      if (name) session.saveAsPreset(name);
    });
    const revert = h('button', { class: 'btn quiet' }, 'Revert');
    revert.addEventListener('click', () => session.revert());
    this.editedBar = h('div', { class: 'edited-bar' }, h('span', { class: 'edited-label' }, 'Edited'), this.editedSave, saveAs, revert);

    const views = [this.buildSound(), this.buildBeat(), this.buildSession()];
    views.forEach((v, i) => {
      v.id = `view-${names[i].toLowerCase()}`;
      v.setAttribute('role', 'tabpanel');
      v.setAttribute('aria-labelledby', `tab-${names[i].toLowerCase()}`);
      v.hidden = i !== 0;
      this.views.push(v);
    });
    const scroller = h('div', { class: 'panel-scroll' }, this.editedBar, ...views);
    this.el = h('section', { class: 'panel', 'aria-label': 'All controls' }, tablist, scroller);
    document.addEventListener('tonewell:panel-tab', (e) => {
      const name = (e as CustomEvent<string>).detail;
      const i = names.findIndex((n) => n.toLowerCase() === name);
      if (i >= 0) this.select(i);
    });
  }

  select(i: number): void {
    this.tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(i === j));
      t.tabIndex = i === j ? 0 : -1;
      this.views[j].hidden = i !== j;
    });
  }

  private set = (id: ParamId, v: number) => this.session.setParam(id, v);
  private get = (id: ParamId) => () => this.session.params[id];

  // ---------- Sound ----------

  private buildSound(): HTMLElement {
    this.soundView = h('div', { class: 'view' });
    return this.soundView;
  }

  private renderLayers(s: Snapshot): void {
    // Playing layers first, then the quiet ones; only re-ordered when the preset changes.
    const key = `${s.preset.id}:${s.mode}`;
    if (key === this.layerOrderKey) return;
    this.layerOrderKey = key;
    this.refreshers = this.refreshers.filter((r) => !(r as Refresher & { sound?: boolean }).sound);
    const isOn = (l: Layer) => !l.on || !!s.params[l.on];
    const sources = LAYERS.filter((l) => l.on);
    const on = sources.filter(isOn);
    const off = sources.filter((l) => !isOn(l));
    const shaping = LAYERS.filter((l) => !l.on);
    const list = h('div', { class: 'layers' });
    for (const l of on) list.append(this.layerRow(l));
    list.append(h('h3', { class: 'group-head' }, 'Space and drift'));
    for (const l of shaping) list.append(this.layerRow(l));
    if (off.length) {
      list.append(h('h3', { class: 'group-head' }, 'Off'));
      for (const l of off) list.append(this.layerRow(l));
    }
    this.soundView.replaceChildren(list);
  }

  private soundRefresher(fn: Refresher): void {
    const r = fn as Refresher & { sound?: boolean };
    r.sound = true;
    this.refreshers.push(r);
  }

  private layerRow(l: Layer): HTMLElement {
    const row = h('div', { class: 'layer' });
    const head = h('div', { class: 'layer-head' });
    if (l.on) {
      const onId = l.on;
      const sw = switchControl(`${l.label} on`, !!this.session.params[onId], (v) => this.set(onId, v ? 1 : 0), true);
      this.soundRefresher((s) => sw.set(!!s.params[onId]));
      head.append(sw.el);
    } else {
      head.append(h('span', { class: 'switch-spacer' }));
    }
    head.append(h('span', { class: 'layer-name' }, l.label));
    const level = paramScale(l.level, this.get(l.level), this.set, `${l.label} ${PARAMS[l.level].label.toLowerCase()}`);
    level.el.classList.add('layer-level');
    level.el.querySelector('label')?.classList.add('sr-only');
    this.soundRefresher(() => level.refresh());
    head.append(level.el);
    const detailId = `layer-detail-${l.key}`;
    if (l.detail.length) {
      const dis = h('button', { class: 'icon-btn disclosure', 'aria-expanded': String(this.openLayer === l.key), 'aria-controls': detailId, 'aria-label': `${l.label} settings` });
      dis.append(icon(ICONS.disclosure));
      head.append(dis);
      const detail = h('div', { class: 'layer-detail', id: detailId });
      detail.hidden = this.openLayer !== l.key;
      for (const id of l.detail) detail.append(this.control(id));
      dis.addEventListener('click', () => {
        const open = detail.hidden;
        // Only one layer open at a time.
        this.soundView.querySelectorAll<HTMLElement>('.layer-detail').forEach((d) => (d.hidden = true));
        this.soundView.querySelectorAll<HTMLElement>('.disclosure').forEach((d) => d.setAttribute('aria-expanded', 'false'));
        detail.hidden = !open;
        dis.setAttribute('aria-expanded', String(open));
        this.openLayer = open ? l.key : null;
      });
      row.append(head, detail);
    } else {
      head.append(h('span', { class: 'disclosure-spacer' }));
      row.append(head);
    }
    return row;
  }

  /** A control for any parameter, chosen by its kind. */
  private control(id: ParamId): HTMLElement {
    const def = PARAMS[id];
    if (id === 'root') return this.rootStepper();
    if (def.kind === 'toggle') {
      const sw = switchControl(def.label, !!this.session.params[id], (v) => this.set(id, v ? 1 : 0), true);
      this.soundRefresher((s) => sw.set(!!s.params[id]));
      const field = h('div', { class: 'field field-switch' }, h('span', { class: 'field-label' }, def.label), sw.el);
      if (def.help) field.append(h('p', { class: 'field-help' }, def.help));
      return field;
    }
    if (def.kind === 'choice') {
      const r = radios<number>(def.label, (def.choices ?? []).map((c, i) => ({ value: i, label: c })), this.session.params[id], (v) => this.set(id, v));
      this.soundRefresher((s) => r.set(s.params[id]));
      return h('div', { class: 'field field-wide' }, h('span', { class: 'field-label' }, def.label), r.el);
    }
    const sc = paramScale(id, this.get(id), this.set);
    this.soundRefresher(() => sc.refresh());
    return h('div', { class: 'field' }, sc.el);
  }

  private rootStepper(): HTMLElement {
    const value = h('span', { class: 'stepper-value voice', 'aria-live': 'polite' });
    const down = h('button', { class: 'icon-btn', 'aria-label': 'Root down a semitone' }, '−');
    const up = h('button', { class: 'icon-btn', 'aria-label': 'Root up a semitone' }, '+');
    const update = () => (value.textContent = noteName(this.session.params.root));
    down.addEventListener('click', () => this.set('root', this.session.params.root - 1));
    up.addEventListener('click', () => this.set('root', this.session.params.root + 1));
    this.soundRefresher(update);
    update();
    return h('div', { class: 'field field-switch' }, h('span', { class: 'field-label' }, 'Root'), h('span', { class: 'stepper' }, down, value, up));
  }

  // ---------- Beat ----------

  private buildBeat(): HTMLElement {
    const v = h('div', { class: 'view' });
    const p = () => this.session.params;

    const onSw = switchControl('Beat', !!p().beatOn, (on) => this.set('beatOn', on ? 1 : 0), true);
    const type = radios<number>('Beat type', [
      { value: 0, label: 'Binaural' },
      { value: 1, label: 'Monaural' },
      { value: 2, label: 'Isochronic' },
    ], p().beatMode, (m) => this.set('beatMode', m));
    const device = h('p', { class: 'device-line' });
    const deviceGlyph = h('span', { class: 'device-glyph', 'aria-hidden': 'true' });
    const learnHow = h('button', { class: 'link' }, 'How they work');
    learnHow.addEventListener('click', () => this.openLearn('binaural-beats'));
    const deviceRow = h('div', { class: 'device-row' }, deviceGlyph, device, learnHow);

    const readout = h('p', { class: 'beat-readout' });
    const readNum = h('span', { class: 'beat-num voice' });
    const readUnit = h('span', { class: 'beat-unit' });
    readout.append(readNum, readUnit);
    const beat = paramScale('beatHz', this.get('beatHz'), this.set, 'Beat frequency');
    beat.el.querySelector('label')?.classList.add('sr-only');
    const ruler = h('div', { class: 'band-ruler', 'aria-hidden': 'true' }, ...['Delta', 'Theta', 'Alpha', 'Beta', 'Gamma'].map((b) => h('span', { 'data-band': b.toLowerCase() }, b)));
    const bandsLink = h('button', { class: 'link' }, 'What the bands are, and aren’t');
    bandsLink.addEventListener('click', () => this.openLearn('brainwave-bands'));

    const tuned = switchControl('Tuned to the drone', !!p().carrierTuned, (on) => this.set('carrierTuned', on ? 1 : 0), true);
    const carrier = paramScale('carrier', this.get('carrier'), this.set);
    const level = paramScale('beatLevel', this.get('beatLevel'), this.set);

    const glideSw = switchControl('Glide', !!p().rampOn, (on) => this.set('rampOn', on ? 1 : 0), true);
    const sentence = h('p', { class: 'glide-sentence' });
    const curve = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    curve.setAttribute('viewBox', '0 0 360 56');
    curve.setAttribute('class', 'glide-curve');
    curve.setAttribute('role', 'img');
    const from = paramScale('rampFrom', this.get('rampFrom'), this.set);
    const over = paramScale('rampMin', this.get('rampMin'), this.set);
    const back = switchControl('Come back up', !!p().rampReturn, (on) => this.set('rampReturn', on ? 1 : 0), true);
    const backOver = paramScale('returnMin', this.get('returnMin'), this.set);
    const evidence = h('button', { class: 'link' }, 'The evidence, honestly');
    evidence.addEventListener('click', () => this.openLearn('evidence'));

    v.append(
      h('div', { class: 'field field-switch' }, h('span', { class: 'field-label strong' }, 'Beat'), onSw.el),
      h('div', { class: 'field field-wide' }, type.el),
      deviceRow,
      h('div', { class: 'beat-block' }, readout, beat.el, ruler, bandsLink),
      h('div', { class: 'field field-switch' }, h('span', { class: 'field-label' }, 'Tuned to the drone'), tuned.el),
      h('div', { class: 'field' }, carrier.el),
      h('div', { class: 'field' }, level.el),
      h('h3', { class: 'group-head' }, 'Glide'),
      h('div', { class: 'field field-switch' }, sentence, glideSw.el),
      curve,
      h('div', { class: 'field-grid' }, from.el, over.el),
      h('div', { class: 'field field-switch' }, h('span', { class: 'field-label' }, 'Come back up at the end'), back.el),
      h('div', { class: 'field' }, backOver.el),
      h('p', { class: 'field-help' }, 'The glide back up only happens in timed sessions.'),
      evidence,
    );

    this.refreshers.push((s) => {
      onSw.set(!!s.params.beatOn);
      type.set(s.params.beatMode);
      const speakers = s.output?.kind === 'speakers';
      deviceGlyph.replaceChildren(icon(speakers ? ICONS.speaker : ICONS.headphones));
      if (speakers && s.params.beatMode === 0) device.textContent = `Through ${s.output?.name ?? 'speakers'}: binaural needs headphones, so it plays as a monaural beat.`;
      else if (s.params.beatMode === 0) device.textContent = 'Binaural beats need headphones: each ear gets its own tone.';
      else if (s.params.beatMode === 1) device.textContent = 'Monaural beats work on speakers: the pulse is in the sound itself.';
      else device.textContent = 'Isochronic tones work on speakers: one tone, gently pulsed.';
      const hz = s.phase === 'playing' ? this.session.beatHzNow() : s.params.beatHz;
      readNum.textContent = hz < 10 ? hz.toFixed(1) : String(Math.round(hz));
      readUnit.textContent = ` Hz, ${bandName(hz)}`;
      beat.refresh();
      const band = bandName(s.params.beatHz);
      ruler.querySelectorAll<HTMLElement>('span').forEach((sp) => sp.toggleAttribute('data-active', sp.dataset.band === band));
      tuned.set(!!s.params.carrierTuned);
      carrier.input.disabled = !!s.params.carrierTuned;
      if (s.params.carrierTuned) carrier.el.querySelector('.scale-value')!.textContent = `${Math.round(tunedCarrier(s.params))} Hz, on the drone`;
      else carrier.refresh();
      level.refresh();
      glideSw.set(!!s.params.rampOn);
      const f = s.params.rampFrom;
      const t = s.params.beatHz;
      sentence.textContent = s.params.rampOn
        ? `Start at ${fmtHz(f)} and glide to ${fmtHz(t)} over ${s.params.rampMin} min.${s.params.rampReturn ? ` Rise back to ${fmtHz(f)} in the last ${s.params.returnMin} min.` : ''}`
        : 'Hold one beat for the whole session.';
      drawCurve(curve, s);
      from.refresh();
      over.refresh();
      back.set(!!s.params.rampReturn);
      backOver.refresh();
      for (const el of [from.input, over.input, backOver.input]) el.disabled = !s.params.rampOn;
    });
    return v;
  }

  // ---------- Session ----------

  private buildSession(): HTMLElement {
    const v = h('div', { class: 'view' });
    const pr = () => this.session.prefs;
    const lengths: Array<{ value: number; label: string }> = [10, 15, 20, 30, 45, 60, 90, 0].map((m) => ({ value: m, label: m ? `${m}` : 'Open' }));
    const length = radios<number>('Length in minutes', lengths, pr().minutes ?? 0, (m) => this.session.setLength(m || null));
    const fadeIn = scale({
      label: 'Fade in', value: (pr().fadeIn - 5) / 25,
      valueText: (x) => `${Math.round(5 + x * 25)} s`, onInput: (x) => this.session.setPrefs({ fadeIn: Math.round(5 + x * 25) }),
    });
    const landTo = radios<'hum' | 'silence'>('Wind down to', [
      { value: 'hum', label: 'A low hum' },
      { value: 'silence', label: 'Silence' },
    ], pr().landTo, (x) => this.session.setPrefs({ landTo: x }));
    const rest = radios<number>('Rest after the timer', [0, 1, 2, 3, 5].map((m) => ({ value: m, label: m ? `${m} min` : 'None' })), pr().restMinutes, (m) => this.session.setPrefs({ restMinutes: m }));
    const endBell = switchControl('End bell', pr().endBell, (on) => this.session.setPrefs({ endBell: on }), true);
    const startBell = switchControl('Start bell', pr().startBell, (on) => this.session.setPrefs({ startBell: on }), true);
    const keepPlaying = switchControl('Keep playing after', pr().keepPlaying, (on) => this.session.setPrefs({ keepPlaying: on }), true);
    const awake = switchControl('Keep the screen awake', pr().keepScreenAwake, (on) => this.session.setPrefs({ keepScreenAwake: on }), true);
    const cycles = radios<string>('Focus cycles', [
      { value: 'off', label: 'Off' },
      { value: '25', label: '25 + 5' },
      { value: '50', label: '50 + 10' },
      { value: '90', label: '90 + 15' },
    ], 'off', (c) => {
      if (c === 'off') this.session.setPrefs({ breakMinutes: 0 });
      else this.session.setPrefs({ minutes: Number(c), breakMinutes: c === '25' ? 5 : c === '50' ? 10 : 15 });
    });
    const cyclesField = h('div', { class: 'field field-wide' }, h('span', { class: 'field-label' }, 'Cycles'), cycles.el, h('p', { class: 'field-help' }, 'Blocks with a short break between them. During a break the sound settles to a hum, and a soft bell marks each change.'));
    const restField = h('div', { class: 'field field-wide' }, h('span', { class: 'field-label' }, 'Rest after the timer'), rest.el, h('p', { class: 'field-help' }, 'Sit in the low hum for a little while before the session ends, rather than opening your eyes straight away.'));

    v.append(
      h('div', { class: 'field field-wide' }, h('span', { class: 'field-label' }, 'Length (minutes)'), length.el),
      h('div', { class: 'field' }, fadeIn.el),
      h('div', { class: 'field field-wide' }, h('span', { class: 'field-label' }, 'Wind down to'), landTo.el),
      restField,
      h('div', { class: 'field field-switch' }, h('span', { class: 'field-label' }, 'End bell'), endBell.el),
      h('div', { class: 'field field-switch' }, h('span', { class: 'field-label' }, 'Start bell'), startBell.el),
      h('div', { class: 'field field-switch' }, h('span', { class: 'field-label' }, 'Keep playing after the timer'), keepPlaying.el),
      h('div', { class: 'field field-switch' }, h('span', { class: 'field-label' }, 'Keep the screen awake'), awake.el),
      cyclesField,
    );
    this.refreshers.push((s) => {
      length.set(s.prefs.minutes ?? 0);
      fadeIn.set((s.prefs.fadeIn - 5) / 25);
      landTo.set(s.prefs.landTo);
      rest.set(s.prefs.restMinutes);
      endBell.set(s.prefs.endBell);
      startBell.set(s.prefs.startBell);
      keepPlaying.set(s.prefs.keepPlaying);
      awake.set(s.prefs.keepScreenAwake);
      cyclesField.hidden = s.mode !== 'focus';
      const b = s.prefs.breakMinutes;
      cycles.set(b === 0 ? 'off' : String(s.prefs.minutes ?? 25));
    });
    return v;
  }

  render(s: Snapshot): void {
    this.renderLayers(s);
    this.editedBar.hidden = !s.edited;
    this.editedSave.hidden = !!s.preset.builtin;
    for (const r of this.refreshers) {
      try {
        r(s);
      } catch (err) {
        console.warn(err);
      }
    }
  }
}

function fmtHz(v: number): string {
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)} Hz`;
}

function drawCurve(svg: SVGSVGElement, s: Snapshot): void {
  const p = s.params;
  const y = (hz: number) => 50 - toSlider('beatHz', hz) * 44;
  const total = Math.max(p.rampMin + (p.rampReturn ? p.returnMin : 0) + 4, (s.prefs.minutes ?? 0) || 20);
  const x = (m: number) => (m / total) * 356 + 2;
  let d: string;
  if (!p.rampOn) d = `M2 ${y(p.beatHz)} H358`;
  else {
    d = `M2 ${y(p.rampFrom)} C${x(p.rampMin * 0.5)} ${y(p.rampFrom)} ${x(p.rampMin * 0.5)} ${y(p.beatHz)} ${x(p.rampMin)} ${y(p.beatHz)}`;
    if (p.rampReturn) {
      const r0 = x(total - p.returnMin);
      d += ` H${r0} C${(r0 + 358) / 2} ${y(p.beatHz)} ${(r0 + 358) / 2} ${y(p.rampFrom)} 358 ${y(p.rampFrom)}`;
    } else d += ' H358';
  }
  const bands = BAND_EDGES.slice(1, -1).map((e) => `<path d="M0 ${y(e)} H360" class="glide-grid"/>`).join('');
  svg.innerHTML = `${bands}<path d="${d}" class="glide-path"/>`;
  svg.setAttribute('aria-label', p.rampOn ? `Beat glides from ${fmtHz(p.rampFrom)} to ${fmtHz(p.beatHz)}` : `Beat holds at ${fmtHz(p.beatHz)}`);
  void formatParam;
}
