// Workshop timer — plain JavaScript, no build step.
// Uses Preact + htm (vendored in ./vendor) to draw the page.
// Everything is saved in this browser's localStorage. Use "Back up" on the menu to move data between devices.
import { html, render, Component } from './vendor/htm-preact.js';

/* ------------------------------------------------------------------ */
/* Example workshop shown on first visit                              */
/* ------------------------------------------------------------------ */
const SEED = [
  { start: '10:00', min: 20, title: 'Welcome and check-in', note: 'Arrive, introductions, intentions for the day' },
  { start: '10:20', min: 30, title: 'Warm-up: move 10, pair share 20', note: 'Get into the body, then talk in pairs' },
  { start: '10:50', min: 40, title: 'Main exercise', note: 'Introduce, demonstrate, practise' },
  { start: '11:30', min: 15, title: 'Break', note: 'Water, fresh air' },
  { start: '11:45', min: 35, title: 'Small groups: discuss 20, harvest 15', note: 'Reflect together, then share with everyone' },
  { start: '12:20', min: 25, title: 'Closing circle', note: 'One thing to take home' },
];

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */
const KEY = 'workshop-timer-v3';     // localStorage key
const CHIME = true;                  // soft chime when a block or sub-timer changes
const DEFAULT_MODE = 'manual';       // 'manual' (Facilitator) or 'clock' (Follow clock)

/* Energy levels: label, colour, text colour on that colour */
const LV = [null,
  { label: 'Flat', color: '#2f5d8a', fg: '#ffffff' },
  { label: 'Low', color: '#6b93c4', fg: '#14202e' },
  { label: 'Steady', color: '#9b9686', fg: '#1c1b17' },
  { label: 'Warm', color: '#e0954a', fg: '#2a1606' },
  { label: 'Alive', color: '#b4501c', fg: '#ffffff' },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
const C = 703.7; // ring circumference
const EMPTY_RUN = { idx: 0, acc: 0, startedAt: null, extra: {}, actual: {}, began: {}, vibe: {}, notes: {}, clk: null, day: null };
const SPARK = ['', '▁', '▂', '▄', '▆', '█'];
const PLOT_Y = v => 24 + (5 - v) * 48;
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const fmtHM = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const fmtMS = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const endOf = b => toMin(b.start) + b.min;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDate = s => { try { return new Date(s + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return s; } };
const nowMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60 + n.getMilliseconds() / 60000; };
const freshClk = () => ({ day: today(), shift: 0, extra: {} });
const hasRatings = r => r && (Object.keys(r.vibe || {}).length > 0 || Object.values(r.notes || {}).some(x => x && x.trim()));
let rowKey = 1;
const newRow = (min = 15, title = '', note = '') => ({ k: rowKey++, min: String(min), title, note });

/* ------------------------------------------------------------------ */
/* Schedule text parsing (for pasting from a doc)                     */
/* ------------------------------------------------------------------ */
const T = '(\\d{1,2})[:.h](\\d{2})\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';
const RANGE = new RegExp('^\\W*' + T + '\\s*(?:[–—-]|to|until)\\s*' + T, 'i');
const SINGLE = new RegExp('^\\W*' + T + '(?!\\d)', 'i');
const to24 = (h, m, ap) => { h = +h; if (ap) { const p = /^p/i.test(ap); if (p && h < 12) h += 12; if (!p && h === 12) h = 0; } return h * 60 + +m; };
const isMinutes = l => /^\(?\d+\s*(min|mins|minutes|m|')?\)?$/i.test(l);

function phasesFor(b) {
  const tail = b.title.includes(':') ? b.title.split(':').slice(1).join(':') : b.title;
  const ps = [...tail.matchAll(/([A-Za-z][A-Za-z ]*?)\s+(\d+)\b/g)].map(m => [m[1].trim().replace(/^./, c => c.toUpperCase()), +m[2]]);
  return ps.length >= 2 && ps.reduce((a, p) => a + p[1], 0) === b.min ? ps : null;
}
function parseSchedule(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const raw = []; let name = '';
  for (const line of lines) {
    let m = line.match(RANGE), s, e, rest;
    if (m) { s = to24(m[1], m[2], m[3] || m[6]); e = to24(m[4], m[5], m[6]); rest = line.slice(m[0].length); }
    else if ((m = line.match(SINGLE)) && !isMinutes(line)) { s = to24(m[1], m[2], m[3]); rest = line.slice(m[0].length); }
    if (s != null) {
      const parts = rest.split(/\t+|\s+\|\s+|\s{2,}|\s+[–—]\s+/).map(p => p.trim()).filter(Boolean);
      const blk = { s, e, min: null, lines: [] };
      for (const p of parts) { if (isMinutes(p) && blk.min == null && !blk.lines.length) blk.min = parseInt(p.replace(/\D/g, '')); else blk.lines.push(p); }
      raw.push(blk);
    } else if (raw.length) {
      const cur = raw[raw.length - 1];
      if (isMinutes(line) && cur.min == null && !cur.lines.length) cur.min = parseInt(line.replace(/\D/g, ''));
      else cur.lines.push(line);
    } else if (!name && !/^(time|when|duration|min)/i.test(line)) name = line.replace(/^#+\s*/, '');
  }
  const blocks = raw.map((b, i) => {
    let e = b.e;
    if (e == null) e = raw[i + 1] ? raw[i + 1].s : b.s + (b.min || 15);
    if (e <= b.s) e += 1440;
    const min = b.e == null && !raw[i + 1] && b.min ? b.min : e - b.s;
    return { start: fmtHM(b.s), min, title: (b.lines[0] || 'Untitled block').replace(/^[-–—:•*]\s*/, ''), note: b.lines.slice(1).join(' · ') };
  });
  return { blocks, name };
}
const toText = blocks => blocks.map(b => b.start + '–' + fmtHM(endOf(b)) + '\n' + b.min + '\n' + b.title + (b.note ? '\n' + b.note : '')).join('\n');

/* Table rows → blocks: each block starts when the previous one ends. */
function rowsToBlocks(start, rows) {
  let t = /^\d{1,2}:\d{2}$/.test(start) ? toMin(start) : 600;
  return rows.filter(r => r.title.trim() || r.note.trim()).map(r => {
    const min = Math.max(1, parseInt(r.min, 10) || 0);
    const b = { start: fmtHM(t), min, title: r.title.trim() || 'Untitled block', note: r.note.trim() };
    t += min;
    return b;
  });
}
const blocksToRows = blocks => blocks.map(b => newRow(b.min, b.title, b.note || ''));

/* ------------------------------------------------------------------ */
/* The app                                                            */
/* ------------------------------------------------------------------ */
class App extends Component {
  constructor() {
    super();
    const base = { mode: null, workshops: [{ id: 'w1', name: 'Example workshop', blocks: SEED }], activeId: 'w1', runs: {}, history: {} };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    this.state = { ...base, ...saved, editor: null, review: null, copyText: '', copyMsg: '', screen: 'menu', notice: '' };
  }

  componentDidMount() {
    this.archiveStale();
    this.timer = setInterval(() => this.tick(), 250);
    this.onKey = e => {
      if (this.state.editor) { if (e.key === 'Escape') this.setState({ editor: null }); return; }
      if (this.state.review) { if (e.key === 'Escape') this.closeReview(); return; }
      if (this.state.screen !== 'timer') return;
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (/^[1-5]$/.test(e.key)) { this.rateCurrent(+e.key); return; }
      if (this.mode() === 'manual') {
        if (e.code === 'Space') { e.preventDefault(); this.toggle(); }
        if (e.key === 'ArrowRight') this.go(this.run().idx + 1);
        if (e.key === 'ArrowLeft') this.go(this.run().idx - 1);
      } else if (e.key === 'ArrowRight') this.clockNext();
    };
    this.onPaste = e => {
      if (this.state.editor || this.state.review || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const p = parseSchedule(text);
      if (!p.blocks.length) return;
      e.preventDefault();
      this.setState({ editor: { id: null, name: p.name, tab: 'table', text, start: p.blocks[0].start, rows: blocksToRows(p.blocks) } });
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('paste', this.onPaste);
  }
  componentWillUnmount() { clearInterval(this.timer); window.removeEventListener('keydown', this.onKey); window.removeEventListener('paste', this.onPaste); }
  componentDidUpdate() { this.persist(); }
  persist() {
    const { mode, workshops, activeId, runs, history } = this.state;
    try { localStorage.setItem(KEY, JSON.stringify({ mode, workshops, activeId, runs, history })); } catch (e) {}
  }

  ws() { return this.state.workshops.find(w => w.id === this.state.activeId) || this.state.workshops[0]; }
  blocks() { return this.ws().blocks.map(b => ({ ...b, phases: phasesFor(b) })); }
  run() { return { ...EMPTY_RUN, ...(this.state.runs[this.ws().id] || {}) }; }
  setRun(fn) { this.setState(s => { const id = this.ws().id; const cur = { ...EMPTY_RUN, ...(s.runs[id] || {}) }; return { runs: { ...s.runs, [id]: { ...cur, ...fn(cur) } } }; }); this.lastKey = null; }
  mode() { return this.state.mode || DEFAULT_MODE; }
  elapsed() { const r = this.run(); return r.acc + (r.startedAt ? Date.now() - r.startedAt : 0); }
  dur(i) { return (this.blocks()[i].min + (this.run().extra[i] || 0)) * 60000; }

  /* ---- Follow-clock adjustments (only for today) ---- */
  clk() { const c = this.run().clk; return c && c.day === today() ? c : freshClk(); }
  clockDurs(B) { const c = this.clk(); return B.map((b, i) => Math.max(0.05, b.min + (c.extra[i] || 0))); }
  clockFirst(B) { return toMin(B[0].start) + this.clk().shift; }
  setClk(fn) { this.setRun(r => { const base = r.clk && r.clk.day === today() ? r.clk : freshClk(); return { clk: fn(base) }; }); }
  clockNext() {
    const B = this.blocks(), s = this.snapshot(B);
    if (s.pre != null || s.idx >= B.length) return;
    this.setClk(c => ({ ...c, extra: { ...c.extra, [s.idx]: s.elapsed / 60000 - B[s.idx].min } }));
  }
  clockShiftBlock(delta) {
    const B = this.blocks(), s = this.snapshot(B);
    if (s.pre != null || s.idx >= B.length) return;
    const i = s.idx, D = this.clockDurs(B)[i], el = s.elapsed / 60000;
    const nd = Math.max(el, D + delta);
    this.setClk(c => ({ ...c, extra: { ...c.extra, [i]: nd - B[i].min } }));
  }
  clockStartNow() { const B = this.blocks(); this.setClk(c => ({ ...c, shift: nowMinutes() - toMin(B[0].start) })); }
  clockLate(B) {
    const D = this.clockDurs(B);
    return this.clockFirst(B) + D.reduce((a, x) => a + x, 0) - (toMin(B[0].start) + B.reduce((a, b) => a + b.min, 0));
  }
  clockCatchUp() {
    const B = this.blocks(), s = this.snapshot(B);
    if (s.idx >= B.length) return;
    const D = this.clockDurs(B), late = this.clockLate(B);
    if (late < 1) return;
    const fut = []; for (let i = s.idx + 1; i < B.length; i++) fut.push(i);
    const R = fut.reduce((a, i) => a + D[i], 0);
    if (!R) return;
    const cut = Math.min(late, R * 0.5);
    let left = Math.round(cut);
    const takes = {};
    fut.forEach((i, k) => {
      const share = k === fut.length - 1 ? left : Math.round(cut * D[i] / R);
      const take = Math.max(0, Math.min(left, share, Math.floor(D[i] * 0.5)));
      takes[i] = take; left -= take;
    });
    this.setClk(c => { const extra = { ...c.extra }; for (const i in takes) extra[i] = (extra[i] || 0) - takes[i]; return { ...c, extra }; });
  }

  /* ---- Energy ratings ---- */
  rate(i, v) { this.setRun(r => { const vibe = { ...r.vibe }; if (v) vibe[i] = v; else delete vibe[i]; return { vibe, day: r.day || today() }; }); }
  setNoteAt(i, text) { this.setRun(r => ({ notes: { ...r.notes, [i]: text }, day: r.day || today() })); }
  rateCurrent(v) { const B = this.blocks(), s = this.snapshot(B); if (s.pre != null || s.idx >= B.length) return; this.rate(s.idx, v); }

  /* ---- Sessions / history ---- */
  sessionFrom(ws, run, mode, snap) {
    const clk = run.clk || { shift: 0, extra: {} };
    let t = toMin(ws.blocks[0].start) + (clk.shift || 0);
    const items = ws.blocks.map((b, i) => {
      let actual = null, at = null, running = false;
      if (mode === 'clock') {
        const D = Math.max(0.05, b.min + ((clk.extra || {})[i] || 0));
        if (!snap || i <= snap.idx) at = t;
        t += D;
        if (!snap || i < snap.idx) actual = D;
        else if (i === snap.idx && snap.elapsed) { actual = snap.elapsed / 60000; running = true; }
      } else {
        actual = (run.actual || {})[i] ?? null;
        at = (run.began || {})[i] ?? null;
        if (snap && i === snap.idx && snap.elapsed) { actual = snap.elapsed / 60000; running = true; }
      }
      return { title: b.title, start: b.start, at, plan: b.min, actual, running, v: (run.vibe || {})[i] || null, note: (run.notes || {})[i] || '' };
    });
    return { id: 's' + Date.now(), date: run.day || today(), name: ws.name, items };
  }
  liveSession() {
    const B = this.blocks(), snap = this.snapshot(B);
    const run = { ...this.run(), clk: this.clk() };
    const s = snap.pre != null ? { idx: 0, elapsed: 0 } : snap.idx >= B.length ? null : snap;
    return this.sessionFrom(this.ws(), run, this.mode(), s);
  }
  saveAndClear() {
    const ws = this.ws(), run = this.run();
    const sess = hasRatings(run) ? this.liveSession() : null;
    this.setState(s => ({
      history: sess ? { ...s.history, [ws.id]: [sess, ...((s.history || {})[ws.id] || [])].slice(0, 30) } : s.history,
      runs: { ...s.runs, [ws.id]: { ...EMPTY_RUN } },
    }));
    this.lastKey = null;
  }
  archiveStale() {
    const t = today(), runs = { ...this.state.runs }, history = { ...(this.state.history || {}) };
    let changed = false;
    for (const ws of this.state.workshops) {
      const r = runs[ws.id];
      if (r && r.day && r.day !== t && hasRatings(r)) {
        history[ws.id] = [this.sessionFrom(ws, { ...EMPTY_RUN, ...r }, this.mode(), null), ...(history[ws.id] || [])].slice(0, 30);
        runs[ws.id] = { ...EMPTY_RUN };
        changed = true;
      }
    }
    if (changed) this.setState({ runs, history });
  }
  closeReview() { this.setState({ review: null, copyText: '', copyMsg: '' }); }

  /* ---- Backup / restore ---- */
  backup() {
    const { mode, workshops, activeId, runs, history } = this.state;
    const blob = new Blob([JSON.stringify({ app: 'workshop-timer', version: 1, exported: new Date().toISOString(), mode, workshops, activeId, runs, history }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'workshop-timer-backup-' + today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  restore(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!Array.isArray(d.workshops) || !d.workshops.length) throw new Error('no workshops');
        this.setState({ mode: d.mode || null, workshops: d.workshops, activeId: d.activeId || d.workshops[0].id, runs: d.runs || {}, history: d.history || {}, notice: 'Restored ' + d.workshops.length + ' workshop' + (d.workshops.length > 1 ? 's' : '') + ' from the backup.' });
      } catch (e) { this.setState({ notice: 'That file isn’t a workshop timer backup.' }); }
    };
    reader.readAsText(file);
  }

  /* ---- Ticking + chime ---- */
  tick() {
    if (this.state.editor) return;
    if (this.state.screen !== 'timer') { this.lastKey = null; this.forceUpdate(); return; }
    const snap = this.snapshot(this.blocks());
    if (this.lastKey && snap.key !== this.lastKey && CHIME) this.chime(snap.key.endsWith('over') ? 2 : 1);
    this.lastKey = snap.key;
    this.forceUpdate();
  }
  chime(n) {
    try {
      const ctx = this.ac || (this.ac = new (window.AudioContext || window.webkitAudioContext)());
      for (let k = 0; k < n; k++) {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + k * 0.35;
        o.frequency.value = 660; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 1.3);
      }
    } catch (e) {}
  }
  toggle() { this.setRun(r => r.startedAt ? { acc: r.acc + Date.now() - r.startedAt, startedAt: null } : { startedAt: Date.now(), began: r.began && r.began[r.idx] != null ? r.began : { ...(r.began || {}), [r.idx]: nowMinutes() } }); }
  go(i) {
    const n = this.blocks().length;
    if (i < 0 || i > n) return;
    this.setRun(r => {
      const el = r.acc + (r.startedAt ? Date.now() - r.startedAt : 0);
      const actual = { ...r.actual };
      if (el > 5000 && r.idx < n) actual[r.idx] = el / 60000;
      const began = { ...(r.began || {}) };
      if (r.startedAt && i < n) began[i] = nowMinutes();
      return { idx: i, acc: 0, startedAt: r.startedAt && i < n ? Date.now() : null, actual, began };
    });
  }

  snapshot(B) {
    const nowMin = nowMinutes();
    if (this.mode() === 'clock') {
      const D = this.clockDurs(B);
      const first = this.clockFirst(B), last = first + D.reduce((a, x) => a + x, 0);
      if (nowMin < first) return { idx: 0, elapsed: 0, total: D[0] * 60000, pre: (first - nowMin) * 60000, key: 'pre' };
      if (nowMin >= last) return { idx: B.length, key: 'done' };
      let t = first, idx = 0;
      while (idx < B.length - 1 && nowMin >= t + D[idx]) t += D[idx++];
      const elapsed = (nowMin - t) * 60000;
      return { idx, elapsed, total: D[idx] * 60000, key: idx + ':' + this.phaseIdx(B[idx], elapsed) };
    }
    const idx = Math.min(this.run().idx, B.length);
    if (idx >= B.length) return { idx, key: 'done' };
    const elapsed = this.elapsed(), total = this.dur(idx);
    return { idx, elapsed, total, key: idx + ':' + (elapsed >= total ? 'over' : this.phaseIdx(B[idx], elapsed)) };
  }
  phaseIdx(b, el) {
    if (!b.phases) return 0;
    let t = 0;
    for (let i = 0; i < b.phases.length; i++) { t += b.phases[i][1] * 60000; if (el < t) return i; }
    return b.phases.length - 1;
  }

  /* ---- Workshop editor ---- */
  openEditor(w) {
    if (w) this.setState({ editor: { id: w.id, name: w.name, tab: 'table', start: w.blocks[0].start, rows: blocksToRows(w.blocks), text: toText(w.blocks) } });
    else this.setState({ editor: { id: null, name: '', tab: 'table', start: '10:00', rows: [newRow(20), newRow(30), newRow(15)], text: '' } });
  }
  updEditor(patch) { this.setState(s => ({ editor: { ...s.editor, ...patch } })); }
  updRow(k, patch) { this.setState(s => ({ editor: { ...s.editor, rows: s.editor.rows.map(r => r.k === k ? { ...r, ...patch } : r) } })); }
  moveRow(i, d) {
    this.setState(s => { const rows = [...s.editor.rows]; const j = i + d; if (j < 0 || j >= rows.length) return null; [rows[i], rows[j]] = [rows[j], rows[i]]; return { editor: { ...s.editor, rows } }; });
  }
  editorBlocks(ed) { return ed.tab === 'table' ? rowsToBlocks(ed.start, ed.rows) : parseSchedule(ed.text).blocks; }
  switchTab(tab) {
    const ed = this.state.editor;
    if (tab === ed.tab) return;
    if (tab === 'text') this.updEditor({ tab, text: toText(rowsToBlocks(ed.start, ed.rows)) });
    else {
      const p = parseSchedule(ed.text);
      this.updEditor(p.blocks.length ? { tab, start: p.blocks[0].start, rows: blocksToRows(p.blocks), name: ed.name || p.name } : { tab });
    }
  }
  saveEditor() {
    const ed = this.state.editor, B = this.editorBlocks(ed);
    if (!B.length) return;
    const name = ed.name.trim() || (ed.tab === 'text' && parseSchedule(ed.text).name) || 'Untitled workshop';
    this.lastKey = null;
    this.setState(s => {
      if (ed.id) {
        const runs = { ...s.runs }; delete runs[ed.id];
        return { workshops: s.workshops.map(w => w.id === ed.id ? { ...w, name, blocks: B } : w), runs, editor: null };
      }
      const id = 'w' + Date.now();
      return { workshops: [...s.workshops, { id, name, blocks: B }], activeId: id, editor: null };
    });
  }
  duplicateWorkshop(w) {
    const id = 'w' + Date.now();
    this.setState(s => ({ workshops: [...s.workshops, { id, name: w.name + ' (copy)', blocks: w.blocks.map(b => ({ ...b })) }] }));
  }

  /* ================================================================ */
  /* Rendering                                                        */
  /* ================================================================ */
  render() {
    const s = this.state;
    return html`
      <div style="min-height: 100vh; display: flex; flex-direction: column;">
        ${s.screen === 'timer' ? this.renderTimer() : this.renderMenu()}
        ${s.review ? this.renderReview() : null}
        ${s.editor ? this.renderEditor() : null}
      </div>`;
  }

  renderMenu() {
    const s = this.state, hist = s.history || {};
    return html`
      <div style="flex: 1; width: 100%; max-width: 820px; margin: 0 auto; box-sizing: border-box; padding: var(--space-8) var(--space-6); display: flex; flex-direction: column; gap: var(--space-6);">
        <div style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-4);">
          <div>
            <h1 style="margin: 0 0 4px; font-size: clamp(32px, 5vw, 48px); line-height: 1.05;">Workshop timer</h1>
            <p style="margin: 0; font-size: 16px;" class="muted">Pick the workshop you’re running today.</p>
          </div>
          <button class="btn btn-primary" onClick=${() => this.openEditor(null)} style="height: 48px; font-size: 16px;">New workshop</button>
        </div>
        ${s.notice ? html`<p class="tag tag-accent-2" style="margin: 0; font-size: 14px; padding: 8px 14px; align-self: flex-start;">${s.notice}</p>` : null}
        <div style="display: flex; flex-direction: column; gap: var(--space-3);">
          ${s.workshops.map(w => {
            const wb = w.blocks, tot = wb.reduce((a, x) => a + x.min, 0);
            const r = { ...EMPTY_RUN, ...(s.runs[w.id] || {}) };
            const h = hist[w.id] || [];
            const inProgress = r.idx > 0 || r.acc > 0 || !!r.startedAt || hasRatings(r);
            let last = '';
            if (h.length) {
              const rr = h[0].items.filter(x => x.v);
              last = 'Last run ' + fmtDate(h[0].date) + (rr.length ? ' · avg energy ' + (rr.reduce((a, x) => a + x.v, 0) / rr.length).toFixed(1) : '') + ' · ' + h.length + ' saved session' + (h.length > 1 ? 's' : '');
            }
            const open = () => { this.setState({ activeId: w.id, screen: 'timer', notice: '' }); this.lastKey = null; };
            return html`
              <div class="card" key=${w.id} style="flex-direction: row; flex-wrap: wrap; align-items: center; gap: var(--space-4); padding: var(--space-4) var(--space-6);">
                <div style="flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
                  <div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2);">
                    <span style="font-family: var(--font-heading); font-size: 24px; line-height: 1.15;">${w.name}</span>
                    ${inProgress ? html`<span class="tag tag-accent-2">In progress</span>` : null}
                  </div>
                  <span class="muted" style="font-size: 15px; font-variant-numeric: tabular-nums;">${wb[0].start}–${fmtHM(toMin(wb[0].start) + tot)} · ${wb.length} blocks · ${tot} min</span>
                  ${last ? html`<span class="muted" style="font-size: 14px;">${last}</span>` : null}
                </div>
                <div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2);">
                  <button class="btn btn-ghost" style="height: 48px;" aria-label=${'Edit ' + w.name} onClick=${() => this.openEditor(w)}>Edit</button>
                  <button class="btn btn-ghost" style="height: 48px;" aria-label=${'Duplicate ' + w.name} onClick=${() => this.duplicateWorkshop(w)}>Duplicate</button>
                  ${h.length ? html`<button class="btn btn-ghost" style="height: 48px;" aria-label=${'Energy curves for ' + w.name} onClick=${() => this.setState({ activeId: w.id, review: { sel: '0' }, copyText: '', copyMsg: '' })}>Energy curves</button>` : null}
                  <button class="btn btn-primary" style="min-width: 120px; height: 48px; font-size: 16px;" aria-label=${'Open ' + w.name} onClick=${open}>${inProgress ? 'Resume' : 'Open'}</button>
                </div>
              </div>`;
          })}
        </div>
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding-top: var(--space-4); border-top: 1px solid var(--color-neutral-300);">
          <span class="muted" style="font-size: 14px; flex: 1 1 260px;">Your workshops and ratings are saved in this browser. Back up to move them to another device.</span>
          <button class="btn btn-secondary" onClick=${() => this.backup()}>Back up</button>
          <label class="btn btn-secondary" style="cursor: pointer;">Restore from file
            <input type="file" accept="application/json,.json" style="position: absolute; width: 1px; height: 1px; opacity: 0;" onChange=${e => { this.restore(e.target.files[0]); e.target.value = ''; }} />
          </label>
        </div>
        <p class="muted" style="margin: 0; font-size: 13px;">Tip: paste a schedule anywhere on this page to turn it into a new workshop.</p>
      </div>`;
  }

  renderTimer() {
    const B = this.blocks();
    const mode = this.mode(), manual = mode === 'manual';
    const snap = this.snapshot(B);
    const { idx } = snap;
    const done = idx >= B.length;
    const ci = Math.min(idx, B.length - 1);
    const b = B[ci];
    const run = this.run();
    const running = !!run.startedAt;
    const now = new Date();
    const nowMin = nowMinutes();
    const D = manual ? B.map((_, i) => this.dur(i) / 60000) : this.clockDurs(B);
    const starts = []; { let t = manual ? toMin(B[0].start) : this.clockFirst(B); for (let i = 0; i < B.length; i++) { starts.push(manual ? toMin(B[i].start) : t); t += D[i]; } }
    const clk = this.clk();
    const hasAdj = !manual && (Math.abs(clk.shift) > 0.01 || Object.values(clk.extra).some(x => Math.abs(x) > 0.01));

    let bigTime, bigCaption, ringOffset = C, ringColor = 'var(--color-accent)', timeColor = 'var(--color-text)';
    if (done) { bigTime = '✓'; bigCaption = 'Workshop complete'; ringOffset = 0; ringColor = 'var(--color-accent-2)'; }
    else if (snap.pre != null) { bigTime = fmtMS(snap.pre); bigCaption = 'until start'; }
    else {
      const rem = snap.total - snap.elapsed;
      ringOffset = C * (1 - Math.min(1, snap.elapsed / snap.total));
      if (rem < 0) { bigTime = '+' + fmtMS(-rem); bigCaption = 'over time'; timeColor = 'var(--color-accent-700)'; ringColor = 'var(--color-accent-700)'; }
      else { bigTime = fmtMS(rem); bigCaption = manual && !running ? (snap.elapsed ? 'paused' : 'ready') : 'remaining'; }
    }

    let phases = [], phaseText = '';
    if (!done && b.phases) {
      const el = snap.elapsed || 0, pi = this.phaseIdx(b, el);
      let t = 0;
      phases = b.phases.map(([label, min], i) => {
        const pct = Math.max(0, Math.min(1, (el - t) / (min * 60000)));
        t += min * 60000;
        return { label, min, pct: pct * 100 + '%', weight: i === pi ? 700 : 400 };
      });
      const left = b.phases.slice(0, pi + 1).reduce((a, p) => a + p[1], 0) * 60000 - el;
      phaseText = snap.pre != null ? '' : left > 0 ? b.phases[pi][0] + ' · ' + fmtMS(left) + ' left' : b.phases[pi][0] + ' · time’s up';
    }

    const totalMin = B.reduce((a, x) => a + x.min, 0);
    const plannedEnd = toMin(B[0].start) + totalMin;
    const diffText = projected => { const diff = Math.round(((projected - plannedEnd) % 1440 + 2160) % 1440 - 720); return 'Ends ~' + fmtHM(projected) + (diff > 0 ? ' · ' + diff + ' min late' : diff < 0 ? ' · ' + (-diff) + ' min early' : ' · on time'); };
    let driftText = '';
    if (manual && !done && (running || snap.elapsed > 0 || idx > 0)) {
      let restMs = Math.max(0, snap.total - snap.elapsed);
      for (let i = idx + 1; i < B.length; i++) restMs += this.dur(i);
      driftText = diffText(nowMin + restMs / 60000);
    }
    const late = manual ? 0 : this.clockLate(B);
    if (!manual && !done && hasAdj) driftText = diffText(this.clockFirst(B) + D.reduce((a, x) => a + x, 0));

    let elapsedTotal = 0;
    for (let i = 0; i < Math.min(idx, B.length); i++) elapsedTotal += D[i];
    if (!done) elapsedTotal += Math.min((snap.elapsed || 0) / 60000, D[idx]);
    const sumD = D.reduce((a, x) => a + x, 0);
    const overallPct = (done ? 100 : (elapsedTotal / sumD) * 100) + '%';

    const canRate = !done && snap.pre == null;
    const curV = canRate ? run.vibe[idx] : null;
    const clockPre = !manual && !done && snap.pre != null;
    const clockLive = !manual && !done && snap.pre == null;
    let clockMsg = '';
    if (!manual) {
      if (done) clockMsg = 'The schedule has run through. “Back to plan” resets today’s changes.';
      else if (clockPre) clockMsg = 'Starts at ' + fmtHM(this.clockFirst(B)) + ' — or tap Start now if you’re beginning at a different time. Everything shifts with you.';
      else if (late >= 1) clockMsg = 'Running ' + Math.round(late) + ' min behind plan. “Catch up” trims the blocks still to come (each by up to half) so you land closer to ' + fmtHM(plannedEnd) + '.';
      else clockMsg = 'Following the clock. Running long? +5 min or “Move on now” shift everything after this block.';
    }
    const setMode = m => () => { this.setState({ mode: m }); this.lastKey = null; };
    const curEnd = starts[ci] + (manual ? b.min : D[ci]);
    const totalText = (manual ? B[0].start + '–' + fmtHM(plannedEnd) + ' · ' + totalMin : fmtHM(this.clockFirst(B)) + '–' + fmtHM(this.clockFirst(B) + sumD) + ' · ' + Math.round(sumD)) + ' min';

    return html`
      <header class="nav" style="flex-wrap: wrap; gap: var(--space-3); padding: var(--space-4) var(--space-6);">
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); min-width: 0;">
          <button class="btn btn-ghost" style="height: 44px;" onClick=${() => { this.setState({ screen: 'menu' }); this.lastKey = null; }}>← Workshops</button>
          <span class="nav-brand" style="font-size: 22px;">${this.ws().name}</span>
          <button class="btn btn-ghost" style="height: 44px;" onClick=${() => this.setState({ review: { sel: 'live' }, copyText: '', copyMsg: '' })}>Energy curve</button>
        </div>
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4);">
          <span class="muted" style="font-variant-numeric: tabular-nums; font-size: 15px;">${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <div class="seg" role="radiogroup" aria-label="Timing mode">
            <label class="seg-opt" style="white-space: nowrap;"><input type="radio" name="mode" checked=${manual} onChange=${setMode('manual')} />Facilitator</label>
            <label class="seg-opt" style="white-space: nowrap;"><input type="radio" name="mode" checked=${!manual} onChange=${setMode('clock')} />Follow clock</label>
          </div>
        </div>
      </header>

      <main style="flex: 1; display: flex; flex-wrap: wrap; gap: var(--space-8); padding: var(--space-4) var(--space-6) var(--space-8); align-items: flex-start;">
        <section class="card" style="flex: 1.3 1 420px; min-width: 0; gap: var(--space-6); padding: var(--space-8);">
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2);">
            <span class="tag tag-accent">${done ? 'Finished' : snap.pre != null ? 'Not started' : 'Block ' + (idx + 1) + ' of ' + B.length}</span>
            <span class="tag tag-neutral">${fmtHM(starts[ci])}–${fmtHM(curEnd)} · ${Math.round(manual ? b.min : D[ci])} min</span>
            ${driftText ? html`<span class="tag tag-accent-2">${driftText}</span>` : null}
          </div>
          <div style="display: flex; flex-direction: column; gap: var(--space-2);">
            <h1 style="margin: 0; font-size: clamp(30px, 4vw, 48px); line-height: 1.05; text-wrap: pretty;">${done ? 'That’s a wrap' : b.title}</h1>
            <p class="muted" style="margin: 0; font-size: 18px; text-wrap: pretty;">${done ? 'Thank everyone, and take one thing home.' : b.note}</p>
          </div>

          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-8);">
            <div style="position: relative; width: 260px; height: 260px; flex: none;">
              <svg width="260" height="260" viewBox="0 0 260 260" aria-hidden="true" style="display: block; transform: rotate(-90deg);">
                <circle cx="130" cy="130" r="112" fill="none" stroke="var(--color-neutral-300)" stroke-width="22"></circle>
                <circle cx="130" cy="130" r="112" fill="none" stroke=${ringColor} stroke-width="22" stroke-linecap="round" stroke-dasharray="703.7" stroke-dashoffset=${ringOffset} style="transition: stroke-dashoffset 0.4s linear;"></circle>
              </svg>
              <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
                <span style=${'font-family: var(--font-heading); font-size: 58px; line-height: 1; font-variant-numeric: tabular-nums; color: ' + timeColor}>${bigTime}</span>
                <span class="muted" style="font-size: 14px;">${bigCaption}</span>
              </div>
            </div>
            <div style="flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: var(--space-4);">
              ${phases.length ? html`
                <div style="display: flex; flex-direction: column; gap: var(--space-2);">
                  <span class="label">Inside this block</span>
                  <div style="display: flex; gap: var(--space-2);">
                    ${phases.map(ph => html`
                      <div style=${'flex: ' + ph.min + ' 1 0; min-width: 0; display: flex; flex-direction: column; gap: 6px;'}>
                        <div style="height: 12px; border-radius: 999px; background: var(--color-neutral-300); overflow: hidden;">
                          <div style=${'height: 100%; border-radius: 999px; background: var(--color-accent-2); width: ' + ph.pct}></div>
                        </div>
                        <span style=${'font-size: 14px; font-weight: ' + ph.weight}>${ph.label} · ${ph.min} min</span>
                      </div>`)}
                  </div>
                  <span style="font-size: 15px; color: var(--color-accent-2-800);">${phaseText}</span>
                </div>` : null}
              ${!done && B[idx + 1] ? html`
                <div style="display: flex; flex-direction: column; gap: 2px;">
                  <span class="label">Up next</span>
                  <span style="font-size: 17px; font-weight: 600;">${B[idx + 1].title}</span>
                </div>` : null}
            </div>
          </div>

          ${manual ? html`
            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3);">
              <button class="btn btn-primary" style="min-width: 140px; height: 48px; font-size: 16px;" onClick=${() => done ? this.saveAndClear() : this.toggle()}>${done ? 'Start over' : running ? 'Pause' : snap.elapsed ? 'Resume' : 'Start'}</button>
              <button class="btn btn-secondary" style="height: 48px;" onClick=${() => this.go(idx + 1)}>Next block</button>
              <button class="btn btn-ghost" style="height: 48px;" onClick=${() => this.go(idx - 1)}>Back</button>
              <button class="btn btn-ghost" style="height: 48px;" onClick=${() => !done && this.setRun(r => ({ extra: { ...r.extra, [idx]: (r.extra[idx] || 0) + 1 } }))}>+1 min</button>
              <button class="btn btn-ghost" style="height: 48px; margin-left: auto;" onClick=${() => this.saveAndClear()}>Reset</button>
            </div>` : html`
            <div style="display: flex; flex-direction: column; gap: var(--space-3);">
              <div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3);">
                ${clockPre ? html`<button class="btn btn-primary" style="min-width: 140px; height: 48px; font-size: 16px;" onClick=${() => this.clockStartNow()}>Start now</button>` : null}
                ${clockLive ? html`
                  <button class="btn btn-primary" style="min-width: 140px; height: 48px; font-size: 16px;" onClick=${() => this.clockNext()}>Move on now</button>
                  <button class="btn btn-secondary" style="height: 48px;" onClick=${() => this.clockShiftBlock(5)}>+5 min</button>
                  <button class="btn btn-ghost" style="height: 48px;" onClick=${() => this.clockShiftBlock(-5)}>−5 min</button>
                  ${late >= 1 && idx < B.length - 1 ? html`<button class="btn btn-secondary" style="height: 48px;" onClick=${() => this.clockCatchUp()}>Catch up</button>` : null}
                  ${idx === 0 ? html`<button class="btn btn-ghost" style="height: 48px;" onClick=${() => this.clockStartNow()}>Begin from now</button>` : null}` : null}
                ${hasAdj ? html`<button class="btn btn-ghost" style="height: 48px; margin-left: auto;" onClick=${() => this.setClk(() => freshClk())}>Back to plan</button>` : null}
              </div>
              <p class="muted" style="margin: 0; font-size: 14px; text-wrap: pretty;">${clockMsg}</p>
            </div>`}

          ${canRate ? html`
            <div style="display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-4); border-top: 1px solid var(--color-neutral-300);">
              <div style="display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-2);">
                <span class="label">How’s the room?</span>
                <span class="muted" style="font-size: 14px;">${curV ? 'Rated ' + curV + ' · ' + LV[curV].label + ' — tap again to change' : 'Tap or press 1–5 any time'}</span>
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: var(--space-2);">
                ${[1, 2, 3, 4, 5].map(n => {
                  const on = curV === n;
                  return html`<button class="vibe-btn" aria-pressed=${on ? 'true' : 'false'} aria-label=${n + ' ' + LV[n].label} onClick=${() => this.rate(idx, n)}
                    style=${'border-color: ' + LV[n].color + '; background: ' + (on ? LV[n].color : 'transparent') + '; color: ' + (on ? LV[n].fg : 'var(--color-text)')}>
                    <span style="font-size: 18px;">${n}</span><span style="font-size: 12px;">${LV[n].label}</span>
                  </button>`;
                })}
              </div>
              <input class="input" style="height: 44px;" aria-label="Note for this block" placeholder="Quick note (optional) — what you noticed" value=${run.notes[idx] || ''} onInput=${e => this.setNoteAt(idx, e.target.value)} />
            </div>` : null}

          ${done ? html`<button class="btn btn-primary" style="align-self: flex-start; height: 48px; font-size: 16px;" onClick=${() => this.setState({ review: { sel: 'live' }, copyText: '', copyMsg: '' })}>See the energy curve</button>` : null}
        </section>

        <section style="flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: var(--space-3);">
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); padding: 0 var(--space-2);">
            <h2 style="margin: 0; font-size: 24px;">Schedule</h2>
            <span class="muted" style="font-size: 14px;">${totalText}</span>
          </div>
          <div style="height: 8px; border-radius: 999px; background: var(--color-neutral-300); overflow: hidden; margin: 0 var(--space-2);">
            <div style=${'height: 100%; background: var(--color-accent); border-radius: 999px; width: ' + overallPct}></div>
          </div>
          ${B.map((x, i) => {
            const cur = i === idx, past = i < idx, v = run.vibe[i];
            const changed = !manual && Math.abs(D[i] - x.min) > 0.01;
            const shownMin = manual ? x.min : Math.max(0, Math.round(D[i]));
            const badge = v ? v : past ? '✓' : shownMin + ((run.extra[i] && manual) || changed ? '*' : '');
            const dotBg = v ? LV[v].color : cur ? 'var(--color-accent)' : past ? 'var(--color-accent-2-100)' : 'var(--color-neutral-100)';
            const dotColor = v ? LV[v].fg : cur ? 'var(--color-bg)' : past ? 'var(--color-accent-2-800)' : 'var(--color-neutral-800)';
            return html`
              <button class="row-btn" key=${i} onClick=${() => manual && this.go(i)}
                style=${'cursor: ' + (manual ? 'pointer' : 'default') + '; background: ' + (cur ? 'var(--color-surface)' : '') + '; opacity: ' + (past ? 0.6 : 1)}>
                <span class="muted" style="font-variant-numeric: tabular-nums; font-size: 14px;">${fmtHM(starts[i])}–${fmtHM(starts[i] + (manual ? x.min : D[i]))}</span>
                <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
                  <span style="font-size: 16px; font-weight: 600; text-wrap: pretty;">${x.title}</span>
                  <span class="muted" style="font-size: 14px; text-wrap: pretty;">${(changed ? 'Planned ' + x.min + ' min' + (x.note ? ' · ' : '') : '') + (x.note || '')}</span>
                </span>
                <span title=${v ? 'Energy ' + v + ' · ' + LV[v].label : ''} style=${'display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 999px; font-size: 14px; font-weight: 600; background: ' + dotBg + '; color: ' + dotColor}>${badge}</span>
              </button>`;
          })}
          <p class="muted" style="margin: 0; padding: 0 var(--space-2); font-size: 13px;">
            ${manual ? 'Space start/pause · ← → between blocks · 1–5 rates the room' : 'Blocks follow the clock · → moves on now · 1–5 rates the room · * = changed from plan'}
          </p>
        </section>
      </main>`;
  }

  renderReview() {
    const rv = this.state.review;
    const wsId = this.ws().id;
    const hist = (this.state.history || {})[wsId] || [];
    const sel = rv.sel === 'live' || !hist[+rv.sel] ? 'live' : rv.sel;
    const editable = sel === 'live';
    const sess = editable ? this.liveSession() : hist[+sel];
    const items = sess.items, n = items.length;
    const rated = items.map((it, i) => ({ ...it, i })).filter(it => it.v);
    const avgOf = its => { const r = its.filter(x => x.v); return r.length ? r.reduce((a, x) => a + x.v, 0) / r.length : null; };
    const avg = avgOf(items);

    const X = i => (i + 0.5) * 1000 / n;
    let line = '', area = '';
    if (rated.length) {
      const pts = rated.map(it => [X(it.i), PLOT_Y(it.v)]);
      line = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1];
      for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], xm = ((x0 + x1) / 2).toFixed(1);
        line += ' C' + xm + ' ' + y0 + ' ' + xm + ' ' + y1 + ' ' + x1.toFixed(1) + ' ' + y1;
      }
      if (pts.length === 1) line += ' h0.1';
      area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' 240 L' + pts[0][0].toFixed(1) + ' 240 Z';
    }

    const timed = items.filter(it => it.actual != null && (!it.running || it.actual > it.plan));
    const over = Math.round(timed.reduce((a, it) => a + it.actual - it.plan, 0));
    const overText = timed.length ? (over > 0 ? 'ran ' + over + ' min over' : over < 0 ? 'ran ' + (-over) + ' min short' : 'on time') : '';
    const sub = [sess.name, fmtDate(sess.date), rated.length + ' of ' + n + ' blocks rated', avg != null ? 'avg energy ' + avg.toFixed(1) : '', overText].filter(Boolean).join(' · ');
    const timingOf = it => it.running ? it.plan + ' min · ' + Math.round(it.actual) + ' so far' : it.actual != null ? it.plan + ' → ' + Math.round(it.actual) + ' min' : it.plan + ' min planned';
    const timeOf = it => it.at != null ? fmtHM(it.at) : it.start;
    const timeTip = it => it.at != null && Math.abs(it.at - toMin(it.start)) >= 1 ? 'planned ' + it.start : '';
    const highlight = it => ({ text: (it.i + 1) + '. ' + it.title + ' · ' + it.v + ' ' + LV[it.v].label, note: it.note });
    const lit = rated.filter(it => it.v >= 4).sort((a, b) => b.v - a.v).map(highlight);
    const flat = rated.filter(it => it.v <= 2).sort((a, b) => a.v - b.v).map(highlight);

    const summary = () => [
      sess.name + ' — ' + fmtDate(sess.date),
      'Energy curve: ' + items.map(it => it.v ? SPARK[it.v] : '·').join('') + (avg != null ? '  (avg ' + avg.toFixed(1) + '/5, ' + rated.length + '/' + n + ' rated)' : ''),
      overText ? 'Timing: ' + overText : null,
      '',
      ...items.map((it, i) => (i + 1) + '. ' + timeOf(it) + ' ' + it.title + ' — ' + (it.v ? it.v + '/5 ' + LV[it.v].label : 'not rated') + ' · ' + timingOf(it) + (it.note ? ' — ' + it.note : '')),
    ].filter(l => l !== null).join('\n');
    const copy = () => {
      const txt = summary();
      const fallback = () => this.setState({ copyText: txt, copyMsg: 'Select the text below and copy it' });
      try { navigator.clipboard.writeText(txt).then(() => this.setState({ copyMsg: 'Copied — paste it into your notes', copyText: '' }), fallback); } catch (e) { fallback(); }
    };
    const highlights = (title, list, empty) => html`
      <div style="flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-bg);">
        <span class="label">${title}</span>
        ${list.length ? list.map(h => html`
          <span style="display: flex; flex-direction: column; gap: 1px;">
            <span style="font-size: 15px; font-weight: 600;">${h.text}</span>
            ${h.note ? html`<span class="muted" style="font-size: 14px;">${h.note}</span>` : null}
          </span>`) : html`<span class="muted" style="font-size: 14px;">${empty}</span>`}
      </div>`;

    return html`
      <div class="dialog-backdrop" style="z-index: 50; padding: var(--space-6);" onClick=${() => this.closeReview()}>
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Energy curve" onClick=${e => e.stopPropagation()} style="width: 100%; max-width: 900px; max-height: calc(100vh - 48px); overflow: auto; gap: var(--space-4); padding: var(--space-6);">
          <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3);">
            <h2 class="dialog-title" style="margin: 0;">Energy curve</h2>
            <select class="input" aria-label="Session" value=${sel} onChange=${e => this.setState({ review: { sel: e.target.value }, copyText: '', copyMsg: '' })} style="width: auto; max-width: 100%; height: 40px;">
              <option value="live">Current session</option>
              ${hist.map((h, k) => { const a = avgOf(h.items); return html`<option value=${String(k)}>${fmtDate(h.date) + (a != null ? ' · avg ' + a.toFixed(1) : '')}</option>`; })}
            </select>
          </div>
          <p class="muted" style="margin: 0; font-size: 15px;">${sub}</p>

          ${rated.length ? html`
            <div style="display: flex; flex-direction: column; gap: var(--space-2);">
              <div style="display: flex; gap: var(--space-3);">
                <div class="muted" style="position: relative; width: 56px; height: 240px; flex: none; font-size: 12px;">
                  ${[5, 4, 3, 2, 1].map(v => html`<span style=${'position: absolute; right: 0; top: ' + PLOT_Y(v) + 'px; transform: translateY(-50%); white-space: nowrap;'}>${v} ${LV[v].label}</span>`)}
                </div>
                <div style="position: relative; flex: 1 1 auto; min-width: 0; height: 240px;">
                  <svg viewBox="0 0 1000 240" preserveAspectRatio="none" aria-hidden="true" style="position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible;">
                    <path d="M0 24 H1000 M0 72 H1000 M0 120 H1000 M0 168 H1000 M0 216 H1000" fill="none" stroke="var(--color-neutral-300)" stroke-width="1" vector-effect="non-scaling-stroke"></path>
                    <path d=${area} fill="var(--color-accent)" fill-opacity="0.12" stroke="none"></path>
                    <path d=${line} fill="none" stroke="var(--color-accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
                  </svg>
                  ${rated.map(it => html`
                    <span title=${(it.i + 1) + '. ' + timeOf(it) + ' ' + it.title + ' — ' + LV[it.v].label + (it.note ? ': ' + it.note : '')}
                      style=${'position: absolute; left: ' + ((it.i + 0.5) * 100 / n) + '%; top: ' + PLOT_Y(it.v) + 'px; transform: translate(-50%, -50%); width: 26px; height: 26px; border-radius: 999px; background: ' + LV[it.v].color + '; color: ' + LV[it.v].fg + '; border: 2px solid var(--color-surface); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;'}>${it.v}</span>`)}
                </div>
              </div>
              <div style=${'display: grid; grid-template-columns: repeat(' + n + ', minmax(0, 1fr)); gap: 4px; margin-left: 69px;'}>
                ${items.map((it, i) => html`
                  <span title=${(i + 1) + '. ' + timeOf(it) + ' ' + it.title + (timeTip(it) ? ' (' + timeTip(it) + ')' : '')} class="muted" style="display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; font-size: 12px;">
                    <span style="font-weight: 700; color: var(--color-text);">${i + 1}</span>
                    <span style="font-variant-numeric: tabular-nums; color: var(--color-text);">${timeOf(it)}</span>
                    <span style="max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${it.title}</span>
                  </span>`)}
              </div>
            </div>` : html`
            <p style="margin: 0; padding: var(--space-6); border-radius: var(--radius-lg); background: var(--color-bg); font-size: 15px;">No ratings yet. During the workshop, tap 1–5 under “How’s the room?” (or press 1–5 on the keyboard) whenever you sense the vibe — the curve builds itself.</p>`}

          <div style="display: flex; flex-wrap: wrap; gap: var(--space-4);">
            ${highlights('What lit up (4–5)', lit, 'Nothing rated 4–5 yet.')}
            ${highlights('What fell flat (1–2)', flat, 'Nothing rated 1–2.')}
          </div>

          <div style="display: flex; flex-direction: column; gap: var(--space-1);">
            <span class="label">Block by block · planned → actual</span>
            ${items.map((it, i) => html`
              <div key=${i} style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid var(--color-neutral-300);">
                <span style="width: 24px; flex: none; font-weight: 700; font-size: 14px;">${i + 1}</span>
                <span style="width: 64px; flex: none; display: flex; flex-direction: column; gap: 1px; font-variant-numeric: tabular-nums;">
                  <span style="font-size: 15px; font-weight: 600;">${timeOf(it)}</span>
                  <span class="muted" style="font-size: 12px;">${timeTip(it)}</span>
                </span>
                <span style="flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
                  <span style="font-size: 15px; font-weight: 600;">${it.title}</span>
                  ${editable
                    ? html`<input class="input" style="height: 36px; font-size: 14px;" aria-label=${'Note for ' + it.title} placeholder="Note" value=${it.note} onInput=${e => this.setNoteAt(i, e.target.value)} />`
                    : it.note ? html`<span class="muted" style="font-size: 14px;">${it.note}</span>` : null}
                </span>
                <span style=${'flex: none; font-size: 14px; font-variant-numeric: tabular-nums; color: ' + (it.actual != null && !it.running && Math.abs(it.actual - it.plan) >= 3 ? 'var(--color-accent-700)' : 'var(--color-neutral-700)')}>${timingOf(it)}</span>
                ${editable ? html`
                  <select class="input" aria-label=${'Energy for ' + it.title} value=${it.v ? String(it.v) : ''} onChange=${e => this.rate(i, e.target.value ? +e.target.value : null)}
                    style=${'width: 130px; height: 36px; font-size: 14px; border: 2px solid ' + (it.v ? LV[it.v].color : 'var(--color-neutral-300)')}>
                    <option value="">Not rated</option>
                    ${[5, 4, 3, 2, 1].map(v => html`<option value=${String(v)}>${v} · ${LV[v].label}</option>`)}
                  </select>` : html`
                  <span style=${'flex: none; min-width: 90px; text-align: center; padding: 6px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; background: ' + (it.v ? LV[it.v].color : 'var(--color-neutral-300)') + '; color: ' + (it.v ? LV[it.v].fg : 'var(--color-text)')}>${it.v ? it.v + ' · ' + LV[it.v].label : 'Not rated'}</span>`}
              </div>`)}
          </div>

          ${this.state.copyText ? html`<textarea class="input" aria-label="Summary to copy" readonly value=${this.state.copyText} style="min-height: 160px; border-radius: var(--radius-lg); padding: var(--space-3); font-size: 14px; line-height: 1.4;"></textarea>` : null}

          <div class="dialog-actions" style="flex-wrap: wrap; align-items: center; gap: var(--space-3);">
            ${editable && hasRatings(this.run()) ? html`<button class="btn btn-secondary" onClick=${() => { this.saveAndClear(); this.setState({ review: { sel: '0' }, copyText: '', copyMsg: 'Saved to history' }); }}>Save to history & start fresh</button>` : null}
            ${!editable ? html`<button class="btn btn-ghost" style="color: var(--color-accent-700);" onClick=${() => this.setState(s => { const h = ((s.history || {})[wsId] || []).filter((_, k) => k !== +sel); return { history: { ...s.history, [wsId]: h }, review: { sel: 'live' }, copyText: '', copyMsg: '' }; })}>Delete this session</button>` : null}
            <span style="font-size: 14px; color: var(--color-accent-2-800); margin-left: auto;">${this.state.copyMsg}</span>
            <button class="btn btn-ghost" onClick=${copy}>Copy summary</button>
            <button class="btn btn-primary" onClick=${() => this.closeReview()}>Close</button>
          </div>
        </div>
      </div>`;
  }

  renderEditor() {
    const ed = this.state.editor;
    const B = this.editorBlocks(ed);
    let info = ed.tab === 'table' ? 'Add at least one block with a title.' : 'Paste a schedule — times like 13:00–13:20 start each block.', infoColor = 'var(--color-neutral-700)';
    if (B.length) {
      const total = B.reduce((a, b) => a + b.min, 0);
      const phased = B.filter(phasesFor).length;
      info = B.length + ' block' + (B.length > 1 ? 's' : '') + ' · ' + B[0].start + '–' + fmtHM(toMin(B[0].start) + total) + ' · ' + total + ' min' + (phased ? ' · ' + phased + ' with sub-timers' : '');
      infoColor = 'var(--color-accent-2-800)';
    }
    let t = /^\d{1,2}:\d{2}$/.test(ed.start) ? toMin(ed.start) : 600;
    const starts = ed.rows.map(r => { const s = t; t += Math.max(1, parseInt(r.min, 10) || 0); return fmtHM(s); });
    const canDelete = !!ed.id && this.state.workshops.length > 1;

    return html`
      <div class="dialog-backdrop" style="z-index: 60; padding: var(--space-6);" onClick=${() => this.setState({ editor: null })}>
        <div class="dialog" role="dialog" aria-modal="true" aria-label=${ed.id ? 'Edit workshop' : 'New workshop'} onClick=${e => e.stopPropagation()} style="width: 100%; max-width: 860px; max-height: calc(100vh - 48px); overflow: auto; gap: var(--space-4); padding: var(--space-6);">
          <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3);">
            <h2 class="dialog-title" style="margin: 0;">${ed.id ? 'Edit workshop' : 'New workshop'}</h2>
            <div class="tabs" role="tablist" aria-label="How to enter the schedule">
              <button role="tab" aria-selected=${ed.tab === 'table' ? 'true' : 'false'} onClick=${() => this.switchTab('table')}>Table</button>
              <button role="tab" aria-selected=${ed.tab === 'text' ? 'true' : 'false'} onClick=${() => this.switchTab('text')}>Paste text</button>
            </div>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: var(--space-3);">
            <div class="field" style="flex: 1 1 260px;">
              <label for="ws-name">Workshop name</label>
              <input id="ws-name" class="input" value=${ed.name} onInput=${e => this.updEditor({ name: e.target.value })} placeholder="e.g. Saturday intensive" />
            </div>
            ${ed.tab === 'table' ? html`
              <div class="field" style="flex: 0 0 140px;">
                <label for="ws-start">Starts at</label>
                <input id="ws-start" class="input" type="time" value=${ed.start} onInput=${e => this.updEditor({ start: e.target.value })} />
              </div>` : null}
          </div>

          ${ed.tab === 'table' ? html`
            <div>
              <table class="sched-table">
                <thead><tr><th>Start</th><th>Minutes</th><th>Title</th><th>Note</th><th><span style="position: absolute; left: -9999px;">Actions</span></th></tr></thead>
                <tbody>
                  ${ed.rows.map((r, i) => html`
                    <tr key=${r.k}>
                      <td class="time-cell">${starts[i]}</td>
                      <td class="min-cell"><input class="input" type="number" min="1" step="1" inputmode="numeric" aria-label=${'Minutes for block ' + (i + 1)} value=${r.min} onInput=${e => this.updRow(r.k, { min: e.target.value })} /></td>
                      <td><input class="input" aria-label=${'Title for block ' + (i + 1)} placeholder="Title" value=${r.title} onInput=${e => this.updRow(r.k, { title: e.target.value })} /></td>
                      <td class="note-cell"><input class="input" aria-label=${'Note for block ' + (i + 1)} placeholder="Note (optional)" value=${r.note} onInput=${e => this.updRow(r.k, { note: e.target.value })} /></td>
                      <td class="act-cell">
                        <button class="icon-btn" aria-label=${'Move block ' + (i + 1) + ' up'} disabled=${i === 0} onClick=${() => this.moveRow(i, -1)}>↑</button>
                        <button class="icon-btn" aria-label=${'Move block ' + (i + 1) + ' down'} disabled=${i === ed.rows.length - 1} onClick=${() => this.moveRow(i, 1)}>↓</button>
                        <button class="icon-btn" aria-label=${'Remove block ' + (i + 1)} onClick=${() => this.updEditor({ rows: ed.rows.filter(x => x.k !== r.k) })}>✕</button>
                      </td>
                    </tr>`)}
                </tbody>
              </table>
              <button class="btn btn-secondary" style="margin-top: var(--space-3);" onClick=${() => this.updEditor({ rows: [...ed.rows, newRow()] })}>+ Add block</button>
              <p class="muted" style="margin: var(--space-2) 0 0; font-size: 13px;">Each block starts when the one before ends. Put breaks in as their own blocks. A title like “Small groups: discuss 20, harvest 15” gets sub-timers.</p>
            </div>` : html`
            <div class="field">
              <label for="ws-text">Schedule</label>
              <textarea id="ws-text" class="input" value=${ed.text} onInput=${e => { const v = e.target.value; this.updEditor(ed.name ? { text: v } : { text: v, name: parseSchedule(v).name }); }}
                placeholder=${'Paste your schedule here, e.g.\n13:00–13:20\n20\nOpening circle\nArrive, agreements\n13:20–14:00\n40\nMain exercise'}
                style="min-height: 280px; border-radius: var(--radius-lg); padding: var(--space-3) var(--space-4); font-size: 15px; line-height: 1.45;"></textarea>
              <span class="muted" style="font-size: 13px;">Time range, minutes, title, note — one per line. Switch to Table to check and tweak what was found.</span>
            </div>`}

          <span style=${'font-size: 14px; font-weight: 600; color: ' + infoColor}>${info}</span>
          <div class="dialog-actions" style="flex-wrap: wrap; align-items: center; gap: var(--space-3);">
            ${canDelete ? html`<button class="btn btn-ghost" style="color: var(--color-accent-700); margin-right: auto;" onClick=${() => { if (!confirm('Delete “' + ed.name + '”? Its saved energy curves go too.')) return; this.setState(s => { const ws = s.workshops.filter(w => w.id !== ed.id); const runs = { ...s.runs }; delete runs[ed.id]; const history = { ...s.history }; delete history[ed.id]; return { workshops: ws, activeId: ws[0].id, runs, history, editor: null }; }); }}>Delete workshop</button>` : null}
            <button class="btn btn-ghost" style="margin-left: auto;" onClick=${() => this.setState({ editor: null })}>Cancel</button>
            <button class="btn btn-primary" disabled=${!B.length} onClick=${() => this.saveEditor()}>Save</button>
          </div>
        </div>
      </div>`;
  }
}

render(html`<${App} />`, document.getElementById('app'));
