/**
 * Workshop timer for Google Sheets.
 * One tab per workshop. Starts chain automatically from durations; type a time in
 * "Fixed start" to pin a block. Overlaps, gaps and over-runs are highlighted.
 */
const FIRST = 5, LAST = 84;
const COL = { num: 1, fixed: 2, start: 3, min: 4, end: 5, title: 6, note: 7, phases: 8, status: 9, aStart: 10, aEnd: 11, drift: 12 };
const HEAD = ['#', 'Fixed start', 'Start', 'Min', 'End', 'Title', 'Note', 'Sub-timers', 'Status', 'Actual start', 'Actual end', 'Drift (min)'];
const PAL = {
  bg: '#f5ead8', surface: '#ebddc5', text: '#201e1d', accent: '#c67139',
  a100: '#fff2eb', a200: '#ffe1d0', a300: '#ffc6a5', a700: '#8c491a', a800: '#643312',
  s100: '#f0fae1', s800: '#3d472b', n300: '#dcd3c4', n700: '#645c50',
};
const SEED = [
  ['10:00', 20, 'Welcome and check-in', 'Arrive, introductions, intentions for the day'],
  ['10:20', 30, 'Warm-up: move 10, pair share 20', 'Get into the body, then talk in pairs'],
  ['10:50', 40, 'Main exercise', 'Introduce, demonstrate, practise'],
  ['11:30', 15, 'Break', 'Water, fresh air'],
  ['11:45', 35, 'Small groups: discuss 20, harvest 15', 'Reflect together, then share with everyone'],
  ['12:20', 25, 'Closing circle', 'One thing to take home'],
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Workshop timer')
    .addItem('Open timer', 'showSidebar')
    .addSeparator()
    .addItem('New workshop from pasted schedule…', 'showPasteDialog')
    .addItem('Add example workshop', 'addExample')
    .addSeparator()
    .addItem('Delay from selected block…', 'delayFromSelected')
    .addItem('Fix overlaps (push blocks later)', 'fixOverlaps')
    .addItem('Close gaps', 'closeGaps')
    .addItem('Pin all current start times', 'pinAll')
    .addItem('Unpin all (chain everything)', 'unpinAll')
    .addSeparator()
    .addItem('Repair formulas on this tab', 'repairActive')
    .addItem('Clear actual times on this tab', 'clearActuals')
    .addToUi();
}

/* ---------- parsing ---------- */
const fmtHM = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
const T = '(\\d{1,2})[:.h](\\d{2})\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';
const RANGE = new RegExp('^\\W*' + T + '\\s*(?:[–—-]|to|until)\\s*' + T, 'i');
const SINGLE = new RegExp('^\\W*' + T + '(?!\\d)', 'i');
const to24 = (h, m, ap) => { h = +h; if (ap) { const p = /^p/i.test(ap); if (p && h < 12) h += 12; if (!p && h === 12) h = 0; } return h * 60 + +m; };
const isMinutes = l => /^\(?\d+\s*(min|mins|minutes|m|')?\)?$/i.test(l);

function phasesFor(title, min) {
  const tail = title.indexOf(':') >= 0 ? title.split(':').slice(1).join(':') : title;
  const ps = [], re = /([A-Za-z][A-Za-z ]*?)\s+(\d+)\b/g; let m;
  while ((m = re.exec(tail))) ps.push([m[1].trim().replace(/^./, c => c.toUpperCase()), +m[2]]);
  return ps.length >= 2 && ps.reduce((a, p) => a + p[1], 0) === min ? ps.map(p => p[0] + ' ' + p[1]).join(', ') : '';
}

function parseSchedule(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const raw = []; let name = '';
  lines.forEach(line => {
    let m = line.match(RANGE), s = null, e = null, rest;
    if (m) { s = to24(m[1], m[2], m[3] || m[6]); e = to24(m[4], m[5], m[6]); rest = line.slice(m[0].length); }
    else if ((m = line.match(SINGLE)) && !isMinutes(line)) { s = to24(m[1], m[2], m[3]); rest = line.slice(m[0].length); }
    if (s != null) {
      const blk = { s: s, e: e, min: null, lines: [] };
      rest.split(/\t+|\s+\|\s+|\s{2,}|\s+[–—]\s+/).map(p => p.trim()).filter(Boolean).forEach(p => {
        if (isMinutes(p) && blk.min == null && !blk.lines.length) blk.min = parseInt(p.replace(/\D/g, ''), 10); else blk.lines.push(p);
      });
      raw.push(blk);
    } else if (raw.length) {
      const cur = raw[raw.length - 1];
      if (isMinutes(line) && cur.min == null && !cur.lines.length) cur.min = parseInt(line.replace(/\D/g, ''), 10);
      else cur.lines.push(line);
    } else if (!name && !/^(time|when|duration|min)/i.test(line)) name = line.replace(/^#+\s*/, '');
  });
  const blocks = raw.map((b, i) => {
    let e = b.e;
    if (e == null) e = raw[i + 1] ? raw[i + 1].s : b.s + (b.min || 15);
    if (e <= b.s) e += 1440;
    const min = b.e == null && !raw[i + 1] && b.min ? b.min : e - b.s;
    const title = (b.lines[0] || 'Untitled block').replace(/^[-–—:•*]\s*/, '');
    return { start: b.s, min: min, title: title, note: b.lines.slice(1).join(' · '), phases: phasesFor(title, min) };
  });
  return { blocks: blocks, name: name };
}

function previewText(text) {
  const p = parseSchedule(text), B = p.blocks;
  if (!B.length) return { ok: false, name: p.name, info: 'No blocks found yet — each block needs a start time like 13:00–13:20.' };
  let conflicts = 0;
  for (let i = 1; i < B.length; i++) if (B[i].start !== B[i - 1].start + B[i - 1].min) conflicts++;
  const total = B.reduce((a, b) => a + b.min, 0);
  return { ok: true, name: p.name, info: 'Found ' + B.length + ' blocks · ' + fmtHM(B[0].start) + '–' + fmtHM(B[B.length - 1].start + B[B.length - 1].min) + ' · ' + total + ' min' + (conflicts ? ' · ' + conflicts + ' gap/overlap (will be highlighted)' : ''), rows: B.map(b => fmtHM(b.start) + '  ' + b.min + 'm  ' + b.title) };
}

/* ---------- building tabs ---------- */
function createFromText(name, text) {
  const p = parseSchedule(text);
  if (!p.blocks.length) throw new Error('No blocks found.');
  const sh = newTab_(name || p.name || 'Workshop');
  buildSheet_(sh, sh.getName(), p.blocks);
  return sh.getName();
}

function addExample() {
  const blocks = SEED.map(r => { const [h, m] = r[0].split(':').map(Number); return { start: h * 60 + m, min: r[1], title: r[2], note: r[3], phases: phasesFor(r[2], r[1]) }; });
  buildSheet_(newTab_('Example workshop'), 'Example workshop', blocks);
}

function newTab_(name) {
  const ss = SpreadsheetApp.getActive();
  let n = String(name).slice(0, 90).replace(/[\[\]\*\?\/\\:]/g, ' ').trim() || 'Workshop', k = 2, base = n;
  while (ss.getSheetByName(n)) n = base + ' ' + k++;
  const sh = ss.insertSheet(n);
  sh.activate();
  return sh;
}

function buildSheet_(sh, name, blocks) {
  sh.clear(); sh.clearConditionalFormatRules();
  if (sh.getMaxRows() < LAST) sh.insertRowsAfter(sh.getMaxRows(), LAST - sh.getMaxRows());
  if (sh.getMaxColumns() < 12) sh.insertColumnsAfter(sh.getMaxColumns(), 12 - sh.getMaxColumns());
  const all = sh.getRange(1, 1, LAST, 12);
  all.setFontFamily('Figtree').setFontColor(PAL.text).setBackground(PAL.bg).setVerticalAlignment('middle');

  sh.getRange('A1').setValue(name).setFontFamily('Caprasimo').setFontSize(20);
  sh.getRange('A2:J2').setValues([['Day start', '', 'Planned end', '', 'Target end', '', 'Conflicts', '', 'Live block', '']]);
  ['A2', 'C2', 'E2', 'G2', 'I2'].forEach(a => sh.getRange(a).setFontColor(PAL.n700).setHorizontalAlignment('right'));
  ['B2', 'D2', 'F2', 'H2', 'J2'].forEach(a => sh.getRange(a).setFontWeight('bold'));
  sh.getRange('B2').setBackground(PAL.surface).setNote('First block starts here unless it has a Fixed start.');
  sh.getRange('F2').setBackground(PAL.surface).setNote('Optional. Blocks ending after this are flagged.');
  sh.getRange('D2').setFormula('=IF(COUNT(E' + FIRST + ':E' + LAST + ')=0,"",MAX(E' + FIRST + ':E' + LAST + '))');
  sh.getRange('H2').setFormula('=COUNTIFS(I' + FIRST + ':I' + LAST + ',"<>OK",I' + FIRST + ':I' + LAST + ',"<>")');
  sh.getRange('A3').setValue('Edit Min and the starts after it move. Type a time in Fixed start to pin a block — conflicts light up.').setFontColor(PAL.n700).setFontSize(9);

  sh.getRange(4, 1, 1, 12).setValues([HEAD]).setFontWeight('bold').setBackground(PAL.surface).setFontColor(PAL.text);
  sh.setFrozenRows(4);
  ['B2', 'D2', 'F2'].forEach(a => sh.getRange(a).setNumberFormat('HH:mm'));
  [COL.fixed, COL.start, COL.end, COL.aStart, COL.aEnd].forEach(c => sh.getRange(FIRST, c, LAST - FIRST + 1, 1).setNumberFormat('HH:mm'));
  sh.getRange(FIRST, COL.min, LAST - FIRST + 1, 1).setNumberFormat('0');
  [36, 84, 64, 48, 64, 260, 300, 150, 190, 90, 90, 80].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(FIRST, COL.title, LAST - FIRST + 1, 2).setWrap(true);
  sh.getRange(FIRST, COL.start, LAST - FIRST + 1, 3).setFontColor(PAL.n700);
  sh.getRange(FIRST, COL.fixed, LAST - FIRST + 1, 1).setBackground(PAL.a100);
  sh.getRange(FIRST, COL.min, LAST - FIRST + 1, 1).setBackground(PAL.a100);

  if (blocks && blocks.length) {
    sh.getRange('B2').setValue(blocks[0].start / 1440);
    const last = blocks[blocks.length - 1];
    sh.getRange('F2').setValue((last.start + last.min) / 1440);
    const vals = blocks.map((b, i) => {
      const prev = blocks[i - 1];
      const pin = i > 0 && b.start !== prev.start + prev.min ? b.start / 1440 : '';
      return [pin, b.min];
    });
    sh.getRange(FIRST, COL.fixed, vals.length, 1).setValues(vals.map(v => [v[0]]));
    sh.getRange(FIRST, COL.min, vals.length, 1).setValues(vals.map(v => [v[1]]));
    sh.getRange(FIRST, COL.title, blocks.length, 3).setValues(blocks.map(b => [b.title, b.note, b.phases]));
  }
  writeFormulas_(sh, FIRST, LAST);
  applyRules_(sh);
}

function writeFormulas_(sh, from, to) {
  const rows = [];
  for (let r = from; r <= to; r++) {
    const p = r - 1, tol = '1/2880';
    const start = r === FIRST
      ? '=IF($F' + r + '="","",IF($B' + r + '<>"",$B' + r + ',$B$2))'
      : '=IF($F' + r + '="","",IF($B' + r + '<>"",$B' + r + ',IF($E' + p + '="",$B$2,$E' + p + ')))';
    const end = '=IF($F' + r + '="","",$C' + r + '+N($D' + r + ')/1440)';
    const status = r === FIRST
      ? '=IF($F' + r + '="","",IF($D' + r + '="","Missing minutes",IF(AND($F$2<>"",$E' + r + '>$F$2+' + tol + '),"Runs "&ROUND(($E' + r + '-$F$2)*1440)&" min past target","OK")))'
      : '=IF($F' + r + '="","",IF($D' + r + '="","Missing minutes",IF($E' + p + '="","OK",IF($C' + r + '<$E' + p + '-' + tol + ',"Overlaps previous by "&ROUND(($E' + p + '-$C' + r + ')*1440)&" min",IF($C' + r + '>$E' + p + '+' + tol + ',"Gap of "&ROUND(($C' + r + '-$E' + p + ')*1440)&" min",IF(AND($F$2<>"",$E' + r + '>$F$2+' + tol + '),"Runs "&ROUND(($E' + r + '-$F$2)*1440)&" min past target","OK"))))))';
    const drift = '=IF(OR($F' + r + '="",$J' + r + '=""),"",ROUND(($J' + r + '-$C' + r + ')*1440))';
    rows.push({ r: r, num: '=IF($F' + r + '="","",ROW()-' + (FIRST - 1) + ')', start: start, end: end, status: status, drift: drift });
  }
  const n = rows.length;
  sh.getRange(from, COL.num, n, 1).setFormulas(rows.map(x => [x.num]));
  sh.getRange(from, COL.start, n, 1).setFormulas(rows.map(x => [x.start]));
  sh.getRange(from, COL.end, n, 1).setFormulas(rows.map(x => [x.end]));
  sh.getRange(from, COL.status, n, 1).setFormulas(rows.map(x => [x.status]));
  sh.getRange(from, COL.drift, n, 1).setFormulas(rows.map(x => [x.drift]));
}

function applyRules_(sh) {
  const rowR = sh.getRange('A' + FIRST + ':L' + LAST);
  const statR = sh.getRange('I' + FIRST + ':I' + LAST);
  const startR = sh.getRange('B' + FIRST + ':C' + LAST);
  const B = () => SpreadsheetApp.newConditionalFormatRule();
  const rules = [
    B().whenFormulaSatisfied('=AND($A' + FIRST + '<>"",$A' + FIRST + '=$J$2)').setBackground(PAL.surface).setBold(true).setRanges([rowR]).build(),
    B().whenFormulaSatisfied('=LEFT($I' + FIRST + ',8)="Overlaps"').setBackground(PAL.a300).setFontColor(PAL.a800).setBold(true).setRanges([startR, statR]).build(),
    B().whenFormulaSatisfied('=OR(LEFT($I' + FIRST + ',4)="Runs",$I' + FIRST + '="Missing minutes")').setBackground(PAL.a200).setFontColor(PAL.a800).setRanges([startR, statR]).build(),
    B().whenFormulaSatisfied('=LEFT($I' + FIRST + ',3)="Gap"').setBackground(PAL.a100).setFontColor(PAL.a700).setItalic(true).setRanges([startR, statR]).build(),
    B().whenTextEqualTo('OK').setBackground(PAL.s100).setFontColor(PAL.s800).setRanges([statR]).build(),
    B().whenNumberGreaterThan(2).setFontColor(PAL.a700).setBold(true).setRanges([sh.getRange('L' + FIRST + ':L' + LAST)]).build(),
    B().whenNumberGreaterThan(0).setBackground(PAL.a300).setFontColor(PAL.a800).setBold(true).setRanges([sh.getRange('H2')]).build(),
  ];
  sh.setConditionalFormatRules(rules);
}

/* ---------- semi-automatic adjustments ---------- */
function isTimerTab_(sh) { return sh && sh.getRange(4, COL.title).getValue() === 'Title'; }
function activeTab_() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (!isTimerTab_(sh)) throw new Error('This tab is not a workshop. Use “New workshop from pasted schedule…” first.');
  return sh;
}
function rowsOf_(sh) {
  const n = LAST - FIRST + 1;
  return sh.getRange(FIRST, 1, n, 12).getValues().map((v, i) => ({ r: FIRST + i, v: v })).filter(x => x.v[COL.title - 1] !== '');
}

function onEdit(e) {
  const sh = e.range.getSheet();
  if (!isTimerTab_(sh) || e.range.getRow() < FIRST) return;
  const r0 = e.range.getRow(), r1 = r0 + e.range.getNumRows() - 1;
  // re-seed formulas if a row was inserted or pasted over
  const f = sh.getRange(r0, COL.start, r1 - r0 + 1, 1).getFormulas();
  if (f.some(x => !x[0])) writeFormulas_(sh, r0, Math.min(r1 + 1, LAST));
  // typing a time like "1420" or "14.20" in Fixed start
  if (e.range.getColumn() === COL.fixed && e.range.getNumRows() === 1 && typeof e.value === 'string') {
    const m = e.value.trim().match(/^(\d{1,2})[.:h]?(\d{2})$/);
    if (m) e.range.setValue((+m[1] * 60 + +m[2]) / 1440);
  }
}

function delayFromSelected() {
  const sh = activeTab_(), ui = SpreadsheetApp.getUi();
  const r = sh.getActiveRange().getRow();
  if (r < FIRST || sh.getRange(r, COL.title).getValue() === '') return ui.alert('Select a block row first.');
  const res = ui.prompt('Delay from “' + sh.getRange(r, COL.title).getValue() + '”', 'Minutes to push this and later chained blocks (negative pulls earlier):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const n = parseFloat(res.getResponseText());
  if (isNaN(n)) return;
  const cur = sh.getRange(r, COL.start).getValue();
  const v = (cur instanceof Date ? (cur.getHours() * 60 + cur.getMinutes()) / 1440 : +cur) + n / 1440;
  sh.getRange(r, COL.fixed).setValue(v);
  SpreadsheetApp.getActive().toast('Pushed by ' + n + ' min. Pinned blocks further down may now show conflicts.');
}

function fixOverlaps() {
  const sh = activeTab_(); let k = 0;
  rowsOf_(sh).forEach(x => { if (String(x.v[COL.status - 1]).indexOf('Overlaps') === 0) { sh.getRange(x.r, COL.fixed).clearContent(); k++; } });
  SpreadsheetApp.flush();
  // unpinning can reveal new overlaps further down; repeat until clean
  if (k) return fixOverlaps();
  SpreadsheetApp.getActive().toast('Overlaps resolved — blocks now follow on from the one before.');
}
function closeGaps() {
  const sh = activeTab_(); let k = 0;
  rowsOf_(sh).forEach(x => { if (String(x.v[COL.status - 1]).indexOf('Gap') === 0) { sh.getRange(x.r, COL.fixed).clearContent(); k++; } });
  SpreadsheetApp.getActive().toast(k ? 'Closed ' + k + ' gap(s).' : 'No gaps.');
}
function pinAll() {
  const sh = activeTab_();
  rowsOf_(sh).forEach(x => { if (x.r > FIRST) sh.getRange(x.r, COL.fixed).setValue(sh.getRange(x.r, COL.start).getValue()); });
}
function unpinAll() { activeTab_().getRange(FIRST, COL.fixed, LAST - FIRST + 1, 1).clearContent(); }
function repairActive() { const sh = activeTab_(); writeFormulas_(sh, FIRST, LAST); applyRules_(sh); }
function clearActuals() { const sh = activeTab_(); sh.getRange(FIRST, COL.aStart, LAST - FIRST + 1, 2).clearContent(); sh.getRange('J2').clearContent(); }

/* ---------- dialogs ---------- */
function showSidebar() {
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Workshop timer'));
}
function showPasteDialog() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('Paste').setWidth(560).setHeight(560), 'New workshop from schedule');
}

/* ---------- sidebar API ---------- */
function getSchedule() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getActiveSheet();
  const tabs = ss.getSheets().filter(isTimerTab_).map(s => s.getName());
  if (!isTimerTab_(sh)) return { ok: false, tabs: tabs };
  const n = LAST - FIRST + 1;
  const vals = sh.getRange(FIRST, 1, n, 12).getValues();
  const disp = sh.getRange(FIRST, 1, n, 12).getDisplayValues();
  const blocks = [];
  vals.forEach((v, i) => {
    if (v[COL.title - 1] === '') return;
    const d = disp[i];
    blocks.push({ row: FIRST + i, start: d[COL.start - 1], end: d[COL.end - 1], min: +v[COL.min - 1] || 0, title: v[COL.title - 1], note: v[COL.note - 1],
      phases: String(v[COL.phases - 1] || ''), status: d[COL.status - 1], actualStart: d[COL.aStart - 1], pinned: v[COL.fixed - 1] !== '' });
  });
  return { ok: true, name: sh.getName(), tabs: tabs, blocks: blocks, target: sh.getRange('F2').getDisplayValue(), conflicts: +sh.getRange('H2').getValue() || 0, tz: ss.getSpreadsheetTimeZone() };
}
function openTab(name) { const sh = SpreadsheetApp.getActive().getSheetByName(name); if (sh) sh.activate(); return getSchedule(); }
function nowFrac_() {
  const ss = SpreadsheetApp.getActive();
  const [h, m, s] = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'HH:mm:ss').split(':').map(Number);
  return (h * 3600 + m * 60 + s) / 86400;
}
function sheetNamed_(name) { const sh = SpreadsheetApp.getActive().getSheetByName(name); if (!isTimerTab_(sh)) throw new Error('Workshop tab not found'); return sh; }
function markLive(name, row, closeRow) {
  const sh = sheetNamed_(name), now = nowFrac_();
  if (closeRow) sh.getRange(closeRow, COL.aEnd).setValue(now);
  if (row) {
    if (sh.getRange(row, COL.aStart).getValue() === '') sh.getRange(row, COL.aStart).setValue(now);
    sh.getRange('J2').setValue(row - FIRST + 1);
  } else sh.getRange('J2').clearContent();
}
function addMinute(name, row) {
  const sh = sheetNamed_(name), c = sh.getRange(row, COL.min);
  c.setValue((+c.getValue() || 0) + 1);
  SpreadsheetApp.flush();
  return getSchedule();
}
