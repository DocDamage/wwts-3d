/**
 * Data in and out: import the roster from CSV, export results and history as
 * CSV or JSON, and search / filter the battle history (producer, judge, date,
 * margin). CSV handling follows RFC 4180 (quotes, commas and newlines in fields).
 */

/** Parse CSV text into rows of strings */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ',' || ch === ';' && !s.slice(0, 200).includes(',')) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(header, rows) {
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

/** Roster rows from CSV: needs a "name" column; bio, social, photo, avatar, color optional */
function rosterFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { people: [], errors: ['The file is empty'] };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iName = col('name', 'producer', 'producer name');
  if (iName < 0) return { people: [], errors: ['No "name" column found (first row should be the column names)'] };
  const iBio = col('bio', 'about');
  const iSocial = col('social', 'socials', 'instagram', 'handle', 'sociallinks');
  const iPhoto = col('photo', 'photo url', 'image', 'avatar url');
  const iAvatar = col('avatar', 'stage avatar');
  const iColor = col('color', 'colour');
  const errors = [];
  const people = rows.slice(1).map((r, n) => {
    const name = (r[iName] || '').trim();
    if (!name) { errors.push(`Row ${n + 2}: no name`); return null; }
    const color = iColor >= 0 ? (r[iColor] || '').trim() : '';
    return {
      name: name.slice(0, 40),
      bio: iBio >= 0 ? (r[iBio] || '').trim() : '',
      socialLinks: iSocial >= 0 ? (r[iSocial] || '').trim() : '',
      photo: iPhoto >= 0 && /^https?:\/\//.test((r[iPhoto] || '').trim()) ? r[iPhoto].trim() : '',
      avatar: iAvatar >= 0 ? (r[iAvatar] || '').trim() : '',
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : ''
    };
  }).filter(Boolean);
  return { people, errors };
}

function rosterToCsv(contestants) {
  return toCsv(['name', 'bio', 'social', 'photo', 'avatar', 'color', 'wins', 'losses', 'draws', 'rating', 'avg'],
    contestants.map(c => [c.name, c.bio, c.socialLinks, c.photo?.startsWith('data:') ? '' : c.photo, c.avatar, c.color, c.stats?.wins || 0, c.stats?.losses || 0, c.stats?.draws || 0, c.stats?.rating ?? 1500, c.stats?.avgScore || 0]));
}

/** One row per battle (3/4-way battles list the placings) */
function historyToCsv(battles, leagueName = '') {
  return toCsv(['date', 'league', 'format', 'producer_1', 'score_1', 'producer_2', 'score_2', 'winner', 'decision', 'margin', 'judges', 'rounds', 'placings'],
    battles.map(b => {
      const judges = [...new Set((b.roundResults || []).flatMap(r => (r.panel?.judges || []).map(j => j.name)))].join(' / ');
      return [
        new Date(b.timestamp).toISOString(), leagueName, b.kind === 'cypher' ? `${b.placings?.length}-way` : (b.seriesSummary?.hasSeries ? 'series' : 'single'),
        b.contestant1Name, Number(b.total1 || 0).toFixed(2), b.contestant2Name, Number(b.total2 || 0).toFixed(2),
        b.winnerName || 'DRAW', b.decisionMethod, Math.abs((b.total1 || 0) - (b.total2 || 0)).toFixed(2), judges,
        (b.roundResults || []).length, b.placings ? b.placings.map((p, i) => `${i + 1}. ${p.name} ${Number(p.total).toFixed(2)}`).join('; ') : ''
      ];
    }));
}

/** History filter: { text, judge, from, to, minMargin, maxMargin } */
function filterHistory(battles, f = {}) {
  const text = (f.text || '').trim().toLowerCase();
  const judge = (f.judge || '').trim().toLowerCase();
  const from = f.from ? new Date(f.from).getTime() : null;
  const to = f.to ? new Date(f.to).getTime() + 86400000 : null;
  const minM = f.minMargin !== '' && f.minMargin !== undefined && f.minMargin !== null ? Number(f.minMargin) : null;
  const maxM = f.maxMargin !== '' && f.maxMargin !== undefined && f.maxMargin !== null ? Number(f.maxMargin) : null;
  return battles.filter(b => {
    const names = [b.contestant1Name, b.contestant2Name, ...(b.placings || []).map(p => p.name)].join(' ').toLowerCase();
    if (text && !names.includes(text)) return false;
    if (judge) {
      const js = (b.roundResults || []).flatMap(r => (r.panel?.judges || []).map(j => String(j.name).toLowerCase()));
      const cy = (b.judgeCards || []).map(j => String(j.judge).toLowerCase());
      if (![...js, ...cy].some(n => n.includes(judge))) return false;
    }
    const t = new Date(b.timestamp).getTime();
    if (from !== null && t < from) return false;
    if (to !== null && t >= to) return false;
    const margin = Math.abs((b.total1 || 0) - (b.total2 || 0));
    if (minM !== null && margin < minM) return false;
    if (maxM !== null && margin > maxM) return false;
    return true;
  });
}

export { parseCsv, toCsv, rosterFromCsv, rosterToCsv, historyToCsv, filterHistory };
