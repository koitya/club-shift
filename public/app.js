/* 軽音楽部 部室シフト：画面側 */
(() => {
'use strict';

const CFG = window.APP_CONFIG || {};
const $ = id => document.getElementById(id);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const PJ = { first: '前半', second: '後半' };
const MEMBER_WEEK_START = 1; // 部員のカレンダー：1=月曜始まり
const ADMIN_WEEK_START = 1;  // 管理者のカレンダー：1=月曜始まり（0=日曜, 6=土曜）
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 保存（ブラウザ） ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
};

/* ---------- アカウント（複数ログイン） ---------- */
const ACC = {
  list: (() => { try { return JSON.parse(store.get('cs_accounts') || '[]'); } catch (e) { return []; } })(),
  active: Number(store.get('cs_active') || 0),
  save() { store.set('cs_accounts', JSON.stringify(this.list)); store.set('cs_active', String(this.active)); },
  cur() { return this.list[this.active] || null; },
  keyOf(me) { return me.role === 'admin' ? 'a:' + me.admin.id : 'b:' + me.band.id; },
  add(token, me) {
    const k = this.keyOf(me), i = this.list.findIndex(a => this.keyOf(a.me) === k);
    if (i >= 0) { this.list[i] = { token, me }; this.active = i; } else { this.list.push({ token, me }); this.active = this.list.length - 1; }
    this.save();
  },
  removeCur() { this.list.splice(this.active, 1); this.active = 0; this.save(); },
  bandIds() { return this.list.filter(a => a.me.role === 'band').map(a => a.me.band.id); },
  label(me) { return me.role === 'admin' ? '管理者：' + me.admin.name : me.band.name; },
};
// 旧バージョンの保存データを引き継ぐ
if (!ACC.list.length && store.get('cs_token')) { ACC.list = [{ token: store.get('cs_token'), me: null }]; ACC.active = 0; store.set('cs_token', null); }

/* ---------- 状態 ---------- */
const S = {
  get token() { const c = ACC.cur(); return c ? c.token : null; },
  get me() { const c = ACC.cur(); return c ? c.me : null; },
  adding: false,
  tab: 'shift',
  month: { shift: ym(new Date()), request: nextMonth(ym(new Date())), admin: nextMonth(ym(new Date())) },
  onlyMine: store.get('cs_onlyMine') === '1',
  req: null,
  adminOpen: { prep: true },
  editBand: null,
};
function setToken(t) { const c = ACC.cur(); if (c) { c.token = t; ACC.save(); } }

/* ---------- 日付 ---------- */
function ym(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function nextMonth(m) { let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++; } return y + '-' + String(mo).padStart(2, '0'); }
function prevMonth(m) { let [y, mo] = m.split('-').map(Number); mo--; if (mo < 1) { mo = 12; y--; } return y + '-' + String(mo).padStart(2, '0'); }
function today() { const d = new Date(); return ym(d) + '-' + String(d.getDate()).padStart(2, '0'); }
function dayInfo(day) { const [y, m, d] = day.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return { d, w, wd: WD[w] }; }
function daysOf(m) { const [y, mo] = m.split('-').map(Number); const n = new Date(y, mo, 0).getDate(); const a = []; for (let i = 1; i <= n; i++) a.push(m + '-' + String(i).padStart(2, '0')); return a; }
function monthLabel(m) { const [y, mo] = m.split('-').map(Number); return y + '年' + mo + '月'; }
function fmtDT(s) { if (!s) return ''; const [d, t] = s.split('T'); const i = dayInfo(d); return Number(d.slice(5, 7)) + '/' + i.d + '(' + i.wd + ') ' + (t || ''); }
function dayLabel(day) { const i = dayInfo(day); const cls = i.w === 6 ? 'sat' : i.w === 0 ? 'sun' : ''; return `<div class="dlabel ${cls} ${day === today() ? 'today' : ''}"><b>${i.d}</b><span>${i.wd}</span></div>`; }
/** 締切までの残り時間（例：あと3日 / あと5時間） */
function remain(deadline) {
  if (!deadline) return null;
  const [d, t] = deadline.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
  const ms = new Date(y, m - 1, dd, h, mi) - new Date();
  if (ms <= 0) return { text: '締切を過ぎました', soon: true };
  const hours = ms / 3600000;
  return { text: hours < 24 ? 'あと' + Math.max(1, Math.floor(hours)) + '時間' : 'あと' + Math.floor(hours / 24) + '日', soon: hours < 72 };
}
function remainHtml(deadline) { const r = remain(deadline); return r ? `<span class="${r.soon ? 'due' : ''}">（${r.text}）</span>` : ''; }

/* 枠の時刻：その日に個別の時刻があればそれ、なければ月の基本時刻 */
function timesFor(d, day) { const s = (d.slots || []).find(x => x.day === day); return (s && s.t) || d.info.times; }
function timeStr(t, p) { return p === 'first' ? t.p1start + '〜' + t.p1end : t.p2start + '〜' + t.p2end; }
function slotText(slot, d) { const [day, p] = slot.split('|'); const i = dayInfo(day); return Number(day.slice(5, 7)) + '/' + i.d + '(' + i.wd + ') ' + PJ[p] + (d ? ' ' + timeStr(timesFor(d, day), p) : ''); }

/* カレンダー（startDow：週の始まりの曜日） */
function calendar(m, startDow, cellFn) {
  const days = daysOf(m), first = dayInfo(days[0]).w, lead = (first - startDow + 7) % 7;
  let h = '<div class="cal">';
  for (let i = 0; i < 7; i++) { const w = (startDow + i) % 7; h += `<div class="wh ${w === 6 ? 'sat' : w === 0 ? 'sun' : ''}">${WD[w]}</div>`; }
  for (let i = 0; i < lead; i++) h += '<div class="c blank"></div>';
  days.forEach(day => {
    const w = dayInfo(day).w, c = cellFn(day) || {};
    h += `<div class="c ${w === 6 ? 'sat' : w === 0 ? 'sun' : ''} ${day === today() ? 'today' : ''} ${c.cls || ''}" data-cal="${day}"><span class="n">${dayInfo(day).d}</span>${c.html || ''}</div>`;
  });
  return h + '</div>';
}
function jumpTo(id) {
  const el = document.getElementById(id); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* ---------- 通信 ---------- */
let busyN = 0;
function busy(on) { busyN += on ? 1 : -1; $('busy').classList.toggle('hidden', busyN <= 0); }

const READS = new Set(['ping', 'me', 'month', 'adminMonth', 'getSettings']);
async function api(action, body = {}, opt = {}) {
  if (!opt.quiet) busy(true);
  try {
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, token: opt.token !== undefined ? opt.token : S.token }, body)),
    });
    const j = await res.json();
    if (!j.ok) {
      if (j.code === 'AUTH' && opt.token === undefined && ACC.cur()) {
        const name = ACC.cur().me ? ACC.label(ACC.cur().me) : '';
        ACC.removeCur(); S.req = null; render();
        throw new Error((name ? name + ' の' : '') + 'ログインが切れました。もう一度ログインしてください');
      }
      throw new Error(j.error || 'エラーが起きました');
    }
    if (!READS.has(action) && !['login', 'adminLogin', 'register'].includes(action)) C.drop(body.month);
    return j.data;
  } catch (e) {
    if (e instanceof TypeError) e = new Error('通信できませんでした。電波を確認して、もう一度試してください');
    if (!opt.silent) toast(e.message, true);
    throw e;
  } finally { if (!opt.quiet) busy(false); }
}

/* ---------- 画面側の保存データ（前に見た内容をすぐ表示して、裏で最新に更新） ---------- */
const C = {
  mem: {},
  key(action, month) { const c = ACC.cur(); return c && c.me ? 'cs_c|' + ACC.keyOf(c.me) + '|' + action + '|' + month : null; },
  get(k) { if (!k) return null; if (this.mem[k]) return this.mem[k]; try { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v) this.mem[k] = v; return v; } catch (e) { return null; } },
  set(k, v) { if (!k) return; this.mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { this.trim(); } },
  keys() { const a = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('cs_c|') === 0) a.push(k); } } catch (e) {} return a.concat(Object.keys(this.mem)); },
  /** 書き込みのあと：その月（月がなければ全部）の保存データを捨てる */
  drop(month) { this.keys().forEach(k => { if (!month || k.endsWith('|' + month)) { delete this.mem[k]; try { localStorage.removeItem(k); } catch (e) {} } }); this.fresh = {}; },
  dropAccount(me) { const p = 'cs_c|' + ACC.keyOf(me) + '|'; this.keys().forEach(k => { if (k.indexOf(p) === 0) { delete this.mem[k]; try { localStorage.removeItem(k); } catch (e) {} } }); },
  trim() { this.keys().slice(0, 20).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); },
  fresh: {},
};
/** 保存データがあれば先に onCached で表示 → 最新を取ってきて onFresh(data, changed) */
async function load(action, month, onCached, onFresh) {
  const k = C.key(action, month), cached = C.get(k);
  if (cached && onCached) onCached(cached);
  try {
    const fresh = await api(action, { month }, { silent: !!cached, quiet: !!cached });
    C.set(k, fresh); C.fresh[k] = true;
    onFresh(fresh, !cached || JSON.stringify(cached) !== JSON.stringify(fresh));
    return true;
  } catch (e) {
    if (cached) toast('最新の情報を取れませんでした（前に見た内容を表示中）', true);
    return !!cached;
  }
}
/** 先読み：裏で取っておく */
function prefetch(action, month) {
  const k = C.key(action, month);
  if (!k || C.fresh[k]) return;
  C.fresh[k] = true;
  api(action, { month }, { silent: true, quiet: true }).then(d => C.set(k, d)).catch(() => { delete C.fresh[k]; });
}

let toastT = 0;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' error' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), isErr ? 5000 : 2600);
}

/* ---------- 起動 ---------- */
async function boot() {
  $('appTitle').textContent = (CFG.CLUB_NAME || '') + ' 部室シフト';
  document.title = $('appTitle').textContent;
  if (!CFG.API_URL || CFG.API_URL.indexOf('PASTE_') === 0) {
    $('configError').classList.remove('hidden');
    $('who').textContent = '設定が必要です';
    return;
  }
  bindAuth();
  bindAccountSheet();
  window.addEventListener('beforeunload', e => { if (S.req && (S.req.dirty || S.req.saving)) { e.preventDefault(); e.returnValue = ''; } });
  if (ACC.cur() && ACC.cur().me) {
    // 前回のログイン情報ですぐ表示して、裏で有効か確認
    const before = JSON.stringify(ACC.cur().me), n = ACC.list.length;
    render();
    await verifyCurrent();
    if (!ACC.cur() || ACC.list.length !== n || JSON.stringify(ACC.cur().me) !== before) render();
  } else {
    await verifyCurrent();
    render();
  }
}

/** 今のアカウントがまだ有効か確認（無効なら外して次へ） */
async function verifyCurrent() {
  while (ACC.cur()) {
    try { const me = await api('me', {}, { silent: true, quiet: true, token: S.token }); ACC.cur().me = me; ACC.save(); return true; }
    catch (e) { if (/通信できません/.test(e.message)) return !!ACC.cur().me; ACC.removeCur(); }
  }
  return false;
}

function render() {
  const logged = !!S.me && !S.adding;
  $('authView').classList.toggle('hidden', logged);
  $('mainView').classList.toggle('hidden', !logged);
  $('acctBtn').classList.toggle('hidden', !S.me);
  $('authBack').classList.toggle('hidden', !(S.adding && S.me));
  $('who').textContent = !S.me ? '未ログイン' : ACC.label(S.me) + (ACC.list.length > 1 ? `（${ACC.list.length}アカウント）` : '');
  if (!logged) return;
  const tabs = S.me.role === 'admin'
    ? [['shift', '📅', 'シフト'], ['admin', '🛠', '管理'], ['account', '👤', 'アカウント']]
    : [['shift', '📅', 'シフト'], ['request', '✋', '希望提出'], ['account', '👤', 'アカウント']];
  if (!tabs.some(t => t[0] === S.tab)) S.tab = 'shift';
  $('tabs').innerHTML = tabs.map(t => `<button data-tab="${t[0]}" class="${S.tab === t[0] ? 'on' : ''}"><span class="ic">${t[1]}</span>${t[2]}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => goTab(b.dataset.tab));
  ({ shift: pageShift, request: pageRequest, account: pageAccount, admin: pageAdmin })[S.tab]();
}
function goTab(tab) {
  if (S.tab === 'request' && tab !== 'request' && !confirmLeave()) return;
  S.tab = tab; render(); window.scrollTo(0, 0);
}

function confirmLeave() {
  if (S.req && S.req.dirty) {
    if (!confirm('希望がまだ保存されていません。保存せずに移動しますか？')) return false;
  }
  S.req = null;
  return true;
}

/* ---------- アカウント切り替え ---------- */
function bindAccountSheet() {
  $('acctBtn').onclick = openSheet;
  $('acctClose').onclick = closeSheet;
  $('acctSheet').onclick = e => { if (e.target === $('acctSheet')) closeSheet(); };
  $('acctAdd').onclick = () => { closeSheet(); S.adding = true; render(); document.querySelector('[data-auth=login]').click(); window.scrollTo(0, 0); };
  $('authBack').onclick = () => { S.adding = false; render(); };
  $('acctLogout').onclick = () => {
    if (!confirmLeave()) return;
    const name = ACC.label(S.me);
    C.dropAccount(S.me); ACC.removeCur(); closeSheet(); S.tab = 'shift';
    toast(name + ' からログアウトしました');
    verifyCurrent().then(render);
  };
}
function openSheet() {
  $('acctList').innerHTML = ACC.list.map((a, i) => a.me ? `<li style="border:0;padding:0"><button class="acct ${i === ACC.active ? 'on' : ''}" data-acc="${i}"><span>${a.me.role === 'admin' ? '🛠' : '🎸'}</span><span>${esc(ACC.label(a.me))}<small>${i === ACC.active ? '使用中' : 'タップで切り替え'}</small></span></button></li>` : '').join('');
  $('acctList').querySelectorAll('[data-acc]').forEach(b => b.onclick = () => switchTo(Number(b.dataset.acc)));
  $('acctSheet').classList.remove('hidden');
}
function closeSheet() { $('acctSheet').classList.add('hidden'); }
async function switchTo(i) {
  if (i === ACC.active) return closeSheet();
  if (!confirmLeave()) return;
  ACC.active = i; ACC.save(); closeSheet();
  await verifyCurrent();
  render();
  if (S.me) toast(ACC.label(S.me) + ' に切り替えました');
}

/* ---------- ログイン・登録 ---------- */
function bindAuth() {
  const forms = { login: 'loginForm', register: 'registerForm', admin: 'adminForm' };
  $('authTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    $('authTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    Object.entries(forms).forEach(([k, id]) => $(id).classList.toggle('hidden', k !== b.dataset.auth));
  });
  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    try { const r = await api('login', { name: $('loginName').value, password: $('loginPw').value }, { token: null }); loggedIn(r); } catch (_) {}
  };
  $('registerForm').onsubmit = async e => {
    e.preventDefault();
    if ($('regPw').value !== $('regPw2').value) return toast('確認用パスワードが一致しません', true);
    if ($('regPw').value.length < 4) return toast('パスワードは4文字以上にしてください', true);
    try {
      const r = await api('register', { name: $('regName').value, password: $('regPw').value, passphrase: $('regPhrase').value }, { token: null });
      loggedIn(r); toast('登録しました。パスワードはバンドの人と共有しておいてね');
    } catch (_) {}
  };
  $('adminForm').onsubmit = async e => {
    e.preventDefault();
    try { const r = await api('adminLogin', { name: $('adminName').value, password: $('adminPw').value }, { token: null }); loggedIn(r); } catch (_) {}
  };
}
function loggedIn(r) {
  if (!confirmLeave()) return;
  ACC.add(r.token, r.me); S.adding = false; S.tab = 'shift';
  ['loginName', 'loginPw', 'regName', 'regPw', 'regPw2', 'regPhrase', 'adminName', 'adminPw'].forEach(id => $(id).value = '');
  render();
  if (ACC.list.length > 1) toast(ACC.label(r.me) + ' でログインしました。右上の「👥 切替」で切り替えられます');
}

function monthBar(key, extra = '') {
  return `<div class="monthbar"><button data-mv="-1" aria-label="前の月">◀</button><h2>${monthLabel(S.month[key])}</h2><button data-mv="1" aria-label="次の月">▶</button></div>${extra}`;
}
function bindMonthBar(key, reload) {
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
    if (key === 'request' && !confirmLeave()) return;
    S.month[key] = b.dataset.mv === '1' ? nextMonth(S.month[key]) : prevMonth(S.month[key]);
    reload();
  });
}
function statusPill(info) {
  const cls = { '準備中': '', '受付中': 'blue', '締切': 'warn', '確定': 'ok' }[info.status] || '';
  return `<span class="pill ${cls}">${esc(info.status)}</span>`;
}
/** 掛け持ち用：バンドアカウントの切り替えチップ */
function bandChips() {
  const bands = ACC.list.map((a, i) => ({ a, i })).filter(x => x.a.me && x.a.me.role === 'band');
  if (bands.length < 2) return '';
  return `<div class="bandchips">${bands.map(x => `<button data-chip="${x.i}" class="${x.i === ACC.active ? 'on' : ''}">${esc(x.a.me.band.name)}</button>`).join('')}</div>`;
}
function bindChips() { document.querySelectorAll('[data-chip]').forEach(b => b.onclick = () => switchTo(Number(b.dataset.chip))); }

/* ---------- シフト ---------- */
async function pageShift() {
  const m = S.month.shift;
  const ok = () => S.tab === 'shift' && S.month.shift === m;
  let shown = false;
  const draw = d => { if (!ok()) return; const y = window.scrollY; drawShift(d, m); if (shown) window.scrollTo(0, y); shown = true; };
  if (!C.get(C.key('month', m))) { $('page').innerHTML = monthBar('shift') + '<p class="empty">読み込み中…</p>'; bindMonthBar('shift', pageShift); }
  const got = await load('month', m, draw, (d, changed) => { if (changed || !shown) draw(d); });
  if (!got && ok()) { $('page').innerHTML = monthBar('shift') + '<p class="empty">読み込めませんでした</p>'; bindMonthBar('shift', pageShift); }
  if (ok()) { prefetch('month', nextMonth(m)); prefetch('month', prevMonth(m)); }
}

function drawShift(d, m) {
  const mineIds = new Set(ACC.bandIds());
  const isMine = x => x && mineIds.has(x.bandId);
  const multi = mineIds.size > 1;
  const conf = {};
  d.confirmed.forEach(x => conf[x.day + '|' + x.period] = x);
  const slotMap = {}; d.slots.forEach(s => slotMap[s.day] = s);
  let html = monthBar('shift');
  // 締切リマインド
  (d.openMonths || []).forEach(o => {
    if (!o.submitted) html += `<div class="alert"><span><b>${monthLabel(o.month)}の希望をまだ出していません</b>締切 ${esc(fmtDT(o.deadline) || '未定')} ${remainHtml(o.deadline)}</span><button class="small" data-goreq="${o.month}">今すぐ出す</button></div>`;
    else html += `<div class="banner ok">${monthLabel(o.month)}の希望：提出済み（締切 ${esc(fmtDT(o.deadline) || '未定')}まで変更できます）</div>`;
  });
  if (!d.confirmed.length) {
    const msg = d.info.status === '受付中' ? `希望を受付中です（締切 ${fmtDT(d.info.deadline) || '未定'}）` : d.info.status === '締切' ? '締め切りました。管理者が割り当て中です' : 'この月のシフトはまだありません';
    html += `<div class="banner info">${statusPill(d.info)} ${esc(msg)}</div>`;
  }
  if (mineIds.size) {
    const mine = d.confirmed.filter(isMine);
    const up = mine.filter(x => x.day >= today());
    if (up.length) {
      const n = up[0];
      html += `<div class="card next"><small>次の練習${multi ? '（' + esc(n.band) + '）' : ''}</small><b>${esc(slotText(n.day + '|' + n.period, d))}</b><small>今月の割り当て：${mine.length}枠</small></div>`;
    } else if (mine.length) {
      html += `<div class="banner ok">今月の割り当て：${mine.length}枠</div>`;
    }
  }
  // カレンダー（月曜始まり）
  if (d.slots.length || d.confirmed.length) {
    html += calendar(m, MEMBER_WEEK_START, day => {
      const s = slotMap[day];
      const bar = p => { const x = conf[day + '|' + p]; const open = s && s[p]; return `<span class="br"><em>${PJ[p][0]}</em><span class="bar ${isMine(x) ? 'mine' : x ? 'taken' : open ? 'free' : 'x'}"></span></span>`; };
      const closed = !(s && (s.first || s.second)) && !conf[day + '|first'] && !conf[day + '|second'];
      return { cls: closed ? 'closed' : '', html: closed ? '' : `<span class="bars">${bar('first')}${bar('second')}</span>${s && s.t ? '<span class="badge">⏰</span>' : ''}` };
    });
    html += `<div class="legend"><span><i class="lg-mine"></i>自分</span><span><i class="lg-taken"></i>埋まってる</span><span><i class="lg-free"></i>空き</span><span>⏰ 時間が違う日</span></div>`;
  }
  if (mineIds.size && d.confirmed.length) html += `<label class="toggle"><input type="checkbox" id="onlyMine" ${S.onlyMine ? 'checked' : ''}> 自分のバンドだけ表示</label>`;
  const rows = [];
  daysOf(m).forEach(day => {
    const s = slotMap[day];
    const a = conf[day + '|first'], b = conf[day + '|second'];
    if (!s && !a && !b) return;
    if (S.onlyMine && mineIds.size && !(isMine(a) || isMine(b))) return;
    if (s && !s.first && !s.second && !a && !b) {
      if (!S.onlyMine) rows.push(`<div class="dayrow" id="row-${day}">${dayLabel(day)}<div class="cell closed" style="grid-column:span 2"><div class="bn">利用不可</div></div></div>`);
      return;
    }
    const t = timesFor(d, day);
    const cell = (p, x, open) => {
      if (x) return `<div class="cell ${isMine(x) ? 'mine' : ''}"><div class="pt">${PJ[p]} ${timeStr(t, p)}</div><div class="bn">${esc(x.band)}</div></div>`;
      if (!open) return `<div class="cell closed"><div class="pt">${PJ[p]}</div><div class="bn">利用不可</div></div>`;
      return `<div class="cell empty"><div class="pt">${PJ[p]} ${timeStr(t, p)}</div><div class="bn">${d.confirmed.length ? '空き' : '—'}</div></div>`;
    };
    rows.push(`<div class="dayrow" id="row-${day}">${dayLabel(day)}${cell('first', a, s && s.first)}${cell('second', b, s && s.second)}</div>`);
  });
  html += rows.length ? `<div class="days">${rows.join('')}</div>` : `<p class="empty">${S.onlyMine ? 'この月の割り当てはありません' : '利用枠がまだ設定されていません'}</p>`;
  $('page').innerHTML = html;
  bindMonthBar('shift', pageShift);
  document.querySelectorAll('[data-cal]').forEach(c => c.onclick = () => jumpTo('row-' + c.dataset.cal));
  document.querySelectorAll('[data-goreq]').forEach(b => b.onclick = () => { S.month.request = b.dataset.goreq; S.req = null; goTab('request'); });
  const om = $('onlyMine');
  if (om) om.onchange = () => { S.onlyMine = om.checked; store.set('cs_onlyMine', om.checked ? '1' : null); pageShift(); };
}

/* ---------- 希望提出 ---------- */
async function pageRequest() {
  const m = S.month.request, acc = ACC.active;
  if (S.req && S.req.month === m && S.req.acc === acc && S.req.fresh) return drawRequest();
  const ok = () => S.tab === 'request' && S.month.request === m && ACC.active === acc;
  const setData = (d, fresh) => {
    if (!ok()) return;
    const R = S.req;
    if (!R || R.month !== m || R.acc !== acc) {
      S.req = { month: m, acc, data: d, list: d.myRequests.slice(), saved: d.myRequests.slice(), dirty: false, updated: d.myUpdated, fresh };
    } else {
      R.data = d; R.fresh = fresh;
      if (!R.dirty && !R.saving) { R.list = d.myRequests.slice(); R.saved = d.myRequests.slice(); R.updated = d.myUpdated; }
    }
    drawRequest();
  };
  if (!C.get(C.key('month', m))) { $('page').innerHTML = bandChips() + monthBar('request') + '<p class="empty">読み込み中…</p>'; bindMonthBar('request', pageRequest); bindChips(); }
  const got = await load('month', m, d => setData(d, false), (d, changed) => { if (changed || !S.req || !S.req.fresh) setData(d, true); });
  if (!got && ok()) { $('page').innerHTML = monthBar('request') + '<p class="empty">読み込めませんでした</p>'; bindMonthBar('request', pageRequest); }
  if (ok()) prefetch('month', nextMonth(m));
}

function drawRequest(scrollTo) {
  const R = S.req, d = R.data, info = d.info;
  const open = new Set(); d.slots.forEach(s => { if (s.first) open.add(s.day + '|first'); if (s.second) open.add(s.day + '|second'); });
  let html = bandChips();
  if (html) html += `<p class="hint" style="margin:-6px 0 10px">今は <b>${esc(S.me.band.name)}</b> として提出します</p>`;
  html += monthBar('request');
  if (info.accepting) {
    html += `<div class="banner info">${statusPill(info)} 締切：<b>${esc(fmtDT(info.deadline) || '未定')}</b> ${remainHtml(info.deadline)}</div>`;
  } else {
    const why = { '準備中': 'まだ受付が始まっていません', '締切': '受付は締め切られました', '確定': 'シフトは確定済みです' }[info.status] || '';
    html += `<div class="banner warn">${statusPill(info)} ${esc(why)}</div>`;
  }
  html += `<div class="card"><h2>${esc(S.me.band.name)} の希望（${R.list.length}件）</h2>`;
  if (R.list.length) {
    html += '<ol class="ranklist">' + R.list.map((s, i) => {
      const bad = !open.has(s);
      return `<li><span class="no">${i + 1}</span><span class="tx">${esc(slotText(s, d))}${bad ? '<small style="color:var(--ng)">この枠は利用不可になりました</small>' : ''}</span>` +
        (info.accepting ? `<button class="small" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button><button class="small" data-down="${i}" ${i === R.list.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button><button class="small danger" data-del="${i}" aria-label="削除">✕</button>` : '') + '</li>';
    }).join('') + '</ol>';
  } else {
    html += `<p class="hint">${info.accepting ? 'カレンダーか下の一覧で枠をタップすると、希望順に追加されます。候補が多いほど割り当てられやすくなります。' : '希望は出ていません。'}</p>`;
  }
  if (R.saving) html += `<p class="hint">保存中…（このまま他の画面に移っても大丈夫）</p>`;
  else if (R.updated && !R.dirty) html += `<p class="hint">最終保存：${esc(fmtDT(R.updated))}</p>`;
  html += '</div>';
  if (info.accepting) {
    const slotMap = {}; d.slots.forEach(s => slotMap[s.day] = s);
    html += `<div class="card"><h2>枠を選ぶ</h2>`;
    html += calendar(R.month, MEMBER_WEEK_START, day => {
      const s = slotMap[day];
      if (!s || !(s.first || s.second)) return { cls: 'closed' };
      const bar = p => `<span class="br"><em>${PJ[p][0]}</em><span class="bar ${R.list.includes(day + '|' + p) ? 'pick' : s[p] ? 'free' : 'x'}"></span></span>`;
      const ranks = ['first', 'second'].map(p => R.list.indexOf(day + '|' + p)).filter(i => i >= 0).map(i => i + 1);
      return { html: `<span class="bars">${bar('first')}${bar('second')}</span>${ranks.length ? `<span class="rk">${ranks.join(',')}</span>` : ''}${s.t ? '<span class="badge">⏰</span>' : ''}` };
    });
    html += `<div class="legend"><span><i class="lg-pick"></i>選んだ枠（数字＝希望順位）</span><span><i class="lg-free"></i>選べる枠</span><span>⏰ 時間が違う日</span></div>`;
    html += `<p class="hint" style="margin:0 0 10px">日付をタップするとその日に移動します。下の一覧で前半・後半をタップ（もう一度タップで外す）。</p>`;
    const rows = daysOf(R.month).filter(day => slotMap[day] && (slotMap[day].first || slotMap[day].second)).map(day => {
      const t = timesFor(d, day);
      const btn = p => {
        const id = day + '|' + p, idx = R.list.indexOf(id);
        if (!open.has(id)) return `<button disabled>${PJ[p]}<small>利用不可</small></button>`;
        return `<button data-pick="${id}" class="${idx >= 0 ? 'sel' : ''}">${idx >= 0 ? '第' + (idx + 1) + '希望' : PJ[p]}<small>${timeStr(t, p)}</small></button>`;
      };
      return `<div class="pick" id="pick-${day}">${dayLabel(day)}${btn('first')}${btn('second')}</div>`;
    });
    html += rows.length ? rows.join('') : '<p class="empty">利用できる枠がありません</p>';
    html += '</div>';
    html += `<div class="savebar"><button id="saveReq" class="${R.dirty ? 'accent' : 'primary'}" ${R.dirty ? '' : 'disabled'}>${R.dirty ? '⚠ 未保存：タップして保存（' + R.list.length + '件）' : R.saving ? '保存中…' : '保存済み'}</button></div>`;
  }
  const y = window.scrollY;
  $('page').innerHTML = html;
  window.scrollTo(0, y);
  bindMonthBar('request', pageRequest); bindChips();
  document.querySelectorAll('[data-cal]').forEach(c => c.onclick = () => jumpTo('pick-' + c.dataset.cal));
  const change = fn => { fn(); R.dirty = JSON.stringify(R.list) !== JSON.stringify(R.saved); drawRequest(); };
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => change(() => {
    const id = b.dataset.pick, i = R.list.indexOf(id);
    if (i >= 0) R.list.splice(i, 1);
    else if (R.list.length >= 31) toast('希望は最大31件までです', true);
    else R.list.push(id);
  }));
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => change(() => { const i = +b.dataset.up; [R.list[i - 1], R.list[i]] = [R.list[i], R.list[i - 1]]; }));
  document.querySelectorAll('[data-down]').forEach(b => b.onclick = () => change(() => { const i = +b.dataset.down; [R.list[i + 1], R.list[i]] = [R.list[i], R.list[i + 1]]; }));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => change(() => R.list.splice(+b.dataset.del, 1)));
  const sv = $('saveReq');
  if (sv) sv.onclick = () => {
    // 押した瞬間に「保存済み」にして、通信は裏で。失敗したら元に戻す
    const list = R.list.slice(), prevSaved = R.saved, name = S.me.band.name;
    R.saved = list.slice(); R.dirty = false; R.saving = true;
    drawRequest();
    api('saveRequests', { month: R.month, slots: list }, { quiet: true }).then(r => {
      R.saving = false; R.updated = r.updated;
      toast(r.saved ? name + ' の希望を保存しました（' + r.saved + '件）' : '希望を取り下げました');
    }).catch(() => {
      R.saving = false; R.saved = prevSaved; R.dirty = JSON.stringify(R.list) !== JSON.stringify(R.saved);
    }).finally(() => { if (S.req === R && S.tab === 'request') drawRequest(); });
  };
}

/* ---------- アカウント ---------- */
function pageAccount() {
  const isAdmin = S.me.role === 'admin', min = isAdmin ? 8 : 4;
  $('page').innerHTML = `<div class="card"><h2>${esc(isAdmin ? S.me.admin.name : S.me.band.name)}</h2><p class="hint">${isAdmin ? '管理者アカウントです。' : 'バンド名の変更は管理者に頼んでください。'}掛け持ちしている人は、右上の「👥 切替」から別のバンドでもログインしておくと、ログアウトせずに切り替えられます。</p></div>
  <form class="card" id="pwForm"><h2>パスワード変更</h2>
  <label for="oldPw">今のパスワード</label><input id="oldPw" type="password" autocomplete="current-password" required>
  <label for="newPw">新しいパスワード（${min}文字以上${isAdmin ? '' : '・数字4桁でもOK'}）</label><input id="newPw" type="password" autocomplete="new-password" minlength="${min}" required>
  <label for="newPw2">新しいパスワード（確認）</label><input id="newPw2" type="password" autocomplete="new-password" minlength="${min}" required>
  <button class="primary wide" type="submit">変更する</button>
  <p class="hint">変更すると、他のスマホではログインし直しになります。</p></form>`;
  $('pwForm').onsubmit = async e => {
    e.preventDefault();
    if ($('newPw').value !== $('newPw2').value) return toast('確認用パスワードが一致しません', true);
    try { const r = await api('changePassword', { oldPassword: $('oldPw').value, newPassword: $('newPw').value }); setToken(r.token); toast('パスワードを変更しました'); pageAccount(); } catch (_) {}
  };
}

/* ---------- 管理 ---------- */
let AD = null;
async function pageAdmin(keepScroll) {
  const m = S.month.admin, y = window.scrollY;
  const ok = () => S.tab === 'admin' && S.month.admin === m;
  const set = (d, fresh) => { if (!ok()) return; const yy = window.scrollY; setAdmin(d, fresh); if (keepScroll || AD.wasShown) window.scrollTo(0, keepScroll ? y : yy); AD.wasShown = true; };
  if (keepScroll) {
    // 操作の直後は最新だけを使う
    try { const d = await api('adminMonth', { month: m }); C.set(C.key('adminMonth', m), d); set(d, true); } catch (e) {}
    return;
  }
  if (!C.get(C.key('adminMonth', m))) { $('page').innerHTML = monthBar('admin') + '<p class="empty">読み込み中…</p>'; bindMonthBar('admin', () => pageAdmin()); }
  const got = await load('adminMonth', m, d => set(d, false), d => set(d, true));
  if (!got && ok()) { $('page').innerHTML = monthBar('admin') + '<p class="empty">読み込めませんでした</p>'; bindMonthBar('admin', () => pageAdmin()); }
}

function setAdmin(d, fresh) {
  const m = d.info.month, wasShown = AD && AD.info && AD.info.month === m && AD.wasShown, mode = (AD && AD.calMode) || 'toggle';
  AD = JSON.parse(JSON.stringify(d)); // 保存データを書き換えないようにコピー
  AD.fresh = fresh; AD.wasShown = wasShown;
  AD.form = null;
  AD.calMode = mode;
  AD.selDay = null;
  AD.edit = d.slots.length ? Object.fromEntries(d.slots.map(s => [s.day, { first: s.first, second: s.second, t: s.t || null }]))
                          : Object.fromEntries(daysOf(m).map(day => [day, { first: true, second: true, t: null }]));
  drawAdmin();
}

function sec(key, title, body, badge = '') {
  return `<details class="card" data-sec="${key}" ${S.adminOpen[key] ? 'open' : ''}><summary><span>${title} ${badge}</span></summary>${body}</details>`;
}

function captureForm() {
  if (!$('saveMonth')) return;
  AD.form = { status: $('mStatus') ? $('mStatus').value : AD.info.rawStatus, deadline: $('mDeadline').value,
    t1s: $('t1s').value, t1e: $('t1e').value, t2s: $('t2s').value, t2e: $('t2e').value };
}
function baseTimes() {
  const F = AD.form || {}, t = AD.info.times;
  return { p1start: F.t1s || t.p1start, p1end: F.t1e || t.p1end, p2start: F.t2s || t.p2start, p2end: F.t2e || t.p2end };
}

function drawAdmin() {
  const d = AD, info = d.info, m = info.month;
  const F = AD.form || { status: info.rawStatus, deadline: info.deadline, t1s: info.times.p1start, t1e: info.times.p1end, t2s: info.times.p2start, t2e: info.times.p2end };
  const active = d.bands.filter(b => b.status === '有効');
  const submitted = active.filter(b => b.requests.length);
  const confirmed = d.allocs.some(a => a.status === '確定');
  const drafts = d.allocs.filter(a => a.status === '仮');
  let html = monthBar('admin', `<div class="row" style="margin:-4px 0 12px"><button class="small" id="adminRefresh">🔄 最新に更新</button></div>`);
  html += `<div class="stat"><div><b>${esc(info.status)}</b><span>状態</span></div><div><b>${submitted.length}/${active.length}</b><span>提出バンド</span></div><div><b>${d.allocs.length}</b><span>割り当て枠</span></div></div>`;

  // ① 月の準備
  const opts = ['準備中', '受付中', '締切'].map(s => `<option ${F.status === s ? 'selected' : ''}>${s}</option>`).join('');
  let prep = `<label>状態</label>` + (info.rawStatus === '確定'
    ? `<p><span class="pill ok">確定</span> 変更するには「割り当て」で確定を取り消します</p>`
    : `<select id="mStatus">${opts}</select><p class="hint">「受付中」にすると、バンドが希望を出せるようになります。締切日時を過ぎると自動で締め切ります。</p>`);
  prep += `<label for="mDeadline">締切日時</label><input id="mDeadline" type="datetime-local" value="${esc(F.deadline)}">`;
  prep += `<h3>基本の時刻</h3><div class="grid2"><div><label>前半 開始</label><input type="time" id="t1s" value="${esc(F.t1s)}"></div><div><label>前半 終了</label><input type="time" id="t1e" value="${esc(F.t1e)}"></div>
    <div><label>後半 開始</label><input type="time" id="t2s" value="${esc(F.t2s)}"></div><div><label>後半 終了</label><input type="time" id="t2e" value="${esc(F.t2e)}"></div></div>`;
  prep += `<h3>音楽室が使える日 ${d.slots.length ? '' : '<span class="pill warn">未保存</span>'}</h3>
    <div class="segment" style="margin-bottom:8px"><button data-mode="toggle" class="${AD.calMode === 'toggle' ? 'on' : ''}">タップで ○×切替</button><button data-mode="edit" class="${AD.calMode === 'edit' ? 'on' : ''}">タップで 詳細・時間</button></div>`;
  prep += calendar(m, ADMIN_WEEK_START, day => {
    const e = AD.edit[day];
    const cls = e.first && e.second ? 'full' : e.first || e.second ? 'half' : 'closed';
    const label = e.first && e.second ? '' : e.first ? '<span class="rk" style="color:var(--warn)">前のみ</span>' : e.second ? '<span class="rk" style="color:var(--warn)">後のみ</span>' : '<span class="rk" style="color:#a2a8b5">×</span>';
    return { cls: cls + (AD.selDay === day ? ' sel' : ''), html: label + (e.t ? '<span class="badge">⏰</span>' : '') };
  });
  prep += `<div class="legend"><span><i style="background:var(--okbg);border:1px solid #bfe3cf"></i>両方使える</span><span><i style="background:#fff8e6;border:1px solid #f0dca8"></i>片方だけ</span><span><i style="background:#eceef3"></i>使えない</span><span>⏰ 時間が違う</span></div>`;
  if (AD.calMode === 'edit' && AD.selDay) prep += dayEditor(AD.selDay);
  else if (AD.calMode === 'edit') prep += `<p class="hint">時間や前半・後半を変えたい日をタップしてください。</p>`;
  const wdOpts = [1, 2, 3, 4, 5, 6, 0].map(w => `<option value="${w}">毎週${WD[w]}曜</option>`).join('');
  prep += `<div class="row" style="margin:8px 0"><button class="small" data-bulk="all">全部○</button><button class="small" data-bulk="weekend">土日を×</button><button class="small" data-bulk="none">全部×</button></div>
    <div class="row"><select id="bulkWd" style="min-height:38px">${wdOpts}</select><button class="small" data-bulk="wdoff">を×にする</button><button class="small" data-bulk="wdon">を○にする</button></div>`;
  prep += `<button class="primary wide" id="saveMonth">月の設定を保存</button><p class="hint">カレンダーの変更は「保存」を押すまで反映されません。</p>`;
  html += sec('prep', '① 月の準備', prep, statusPill(info));

  // ② 提出状況
  const sorted = active.slice().sort((a, b) => (a.requests.length ? 1 : 0) - (b.requests.length ? 1 : 0) || a.name.localeCompare(b.name, 'ja'));
  const notYet = active.filter(b => !b.requests.length);
  let sub = (notYet.length ? `<button class="small" id="copyNotYet" style="margin-bottom:8px">📋 未提出バンドをコピー（LINE用）</button>` : '') +
    `<p class="hint" style="margin:0 0 6px">「直近${d.historyMonths}か月」＝公平性の計算に使う過去の確定回数</p><ul class="list">` + sorted.map(b => `<li><div class="line"><span class="nm">${esc(b.name)}</span>${b.requests.length ? `<span class="pill ok">${b.requests.length}件</span>` : '<span class="pill ng">未提出</span>'}</div>
    <div class="hint" style="margin:2px 0 0">直近${d.historyMonths}か月：${b.history}回${b.updated ? '・提出 ' + esc(fmtDT(b.updated)) : ''}</div>
    ${b.requests.length ? `<details><summary class="hint">希望を見る</summary><ol class="hint">${b.requests.map(s => `<li>${esc(slotText(s, d))}</li>`).join('')}</ol></details>` : ''}</li>`).join('') + '</ul>';
  if (!active.length) sub = '<p class="empty">まだバンドが登録されていません</p>';
  html += sec('sub', '② 提出状況', sub, `<span class="pill">${submitted.length}/${active.length}</span>`);

  // ③ 割り当て
  const amap = {}; d.allocs.forEach(a => amap[a.day + '|' + a.period] = a);
  const open = new Set(); d.slots.forEach(s => { if (s.first) open.add(s.day + '|first'); if (s.second) open.add(s.day + '|second'); });
  let al = '';
  if (confirmed) al += `<div class="banner ok">確定済み・全員に公開中です。下で1枠ずつ変更すると、すぐ公開内容に反映されます。</div>`;
  else if (drafts.length) al += `<div class="banner warn">仮の割り当て（まだ非公開）です。確認・修正してから「一括確定」を押してください。</div>`;
  al += `<div class="row">` +
    (confirmed ? `<button class="danger" id="unconfirm">確定を取り消す</button>`
               : `<button class="primary" id="runAlloc" ${d.slots.length ? '' : 'disabled'}>自動割り当て${drafts.length ? 'をやり直す' : 'を実行'}</button><button class="accent" id="confirmAlloc" ${drafts.length ? '' : 'disabled'}>一括確定して公開</button>`) + `</div>`;
  if (d.allocs.length) {
    const cnt = {}; d.allocs.forEach(a => cnt[a.bandId] = (cnt[a.bandId] || 0) + 1);
    const none = submitted.filter(b => !cnt[b.id]);
    al += `<h3>バンド別の枠数</h3><div class="chips">` + active.filter(b => cnt[b.id]).sort((a, b) => cnt[a.id] - cnt[b.id]).map(b => `<span class="pill">${esc(b.name)} ${cnt[b.id]}</span>`).join('') + `</div>`;
    if (none.length) al += `<p class="hint">希望を出したのに0枠：${none.map(b => esc(b.name)).join('、')}</p>`;
  }
  const optsFor = cur => '<option value="">（なし）</option>' + active.map(b => `<option value="${esc(b.id)}" ${b.id === cur ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  const slotDays = daysOf(m).filter(day => ['first', 'second'].some(p => open.has(day + '|' + p) || amap[day + '|' + p]));
  if (slotDays.length) {
    al += `<h3>枠ごとの割り当て</h3><p class="hint" style="margin:0 0 8px">選び直すと、その枠だけ手動で変更されます。</p>`;
    al += slotDays.map(day => {
      const t = timesFor(d, day);
      const one = p => {
        const id = day + '|' + p, a = amap[id];
        if (!open.has(id) && !a) return `<div><div class="meta">${PJ[p]}</div><select disabled><option>利用不可</option></select></div>`;
        const meta = a ? (a.method === '手動' ? '手動' : '第' + a.rank + '希望') : '空き';
        return `<div><div class="meta">${PJ[p]} ${timeStr(t, p)}・${meta}${!open.has(id) ? ' <b style="color:var(--ng)">利用不可の枠です</b>' : ''}</div><select data-slot="${id}">${optsFor(a && a.bandId)}</select></div>`;
      };
      return `<div class="alloc">${dayLabel(day)}<div class="two">${one('first')}${one('second')}</div></div>`;
    }).join('');
  }
  html += sec('alloc', '③ 割り当て', al, drafts.length ? '<span class="pill warn">仮</span>' : confirmed ? '<span class="pill ok">確定</span>' : '');

  // ④ バンド管理
  let bm = '<ul class="list">' + d.bands.slice().sort((a, b) => a.name.localeCompare(b.name, 'ja')).map(b => `<li><div class="line"><span class="nm">${esc(b.name)}</span><span>${b.status === '有効' ? '' : '<span class="pill ng">停止中</span> '}<button class="small" data-edit="${esc(b.id)}">編集</button></span></div>` +
    (S.editBand === b.id ? `<div class="editbox"><label>バンド名</label><input id="ebName" value="${esc(b.name)}" maxlength="40"><label>新しいパスワード（リセットするときだけ入力）</label><input id="ebPw" type="text" autocomplete="off" placeholder="4文字以上（数字4桁でもOK）"><div class="row" style="margin-top:10px"><button class="primary" data-save="${esc(b.id)}">保存</button><button class="${b.status === '有効' ? 'danger' : ''}" data-stop="${esc(b.id)}">${b.status === '有効' ? '停止する' : '再開する'}</button></div><p class="hint">停止するとログインできなくなり、割り当て対象から外れます（過去の記録は残ります）。</p></div>` : '') + '</li>').join('') + '</ul>';
  if (!d.bands.length) bm = '<p class="empty">まだバンドが登録されていません</p>';
  html += sec('bands', '④ バンド管理', bm, `<span class="pill">${d.bands.length}</span>`);

  // ⑤ 設定
  html += sec('settings', '⑤ 設定', `<div id="settingsBody"><p class="empty">開くと読み込みます</p></div>`);
  if (!AD.fresh) html = `<div class="banner info">最新の状態を確認中…（少しだけ待ってね）</div><div class="stale">${html}</div>`;
  $('page').innerHTML = html;
  bindAdmin();
}

/** 1日分の詳細編集（前半・後半の○×、その日だけの時刻） */
function dayEditor(day) {
  const e = AD.edit[day], t = e.t || baseTimes(), i = dayInfo(day);
  return `<div class="dayedit" id="dayEditor"><h3>${Number(day.slice(5, 7))}/${i.d}(${i.wd}) の設定 ${e.t ? '<span class="pill warn">時間を変更中</span>' : ''}</h3>
    <div class="two"><button data-dp="first" class="${e.first ? 'on' : 'off'}">前半 ${e.first ? '○' : '×'}</button><button data-dp="second" class="${e.second ? 'on' : 'off'}">後半 ${e.second ? '○' : '×'}</button></div>
    <div class="grid2"><div><label>前半 開始</label><input type="time" id="d1s" value="${esc(t.p1start)}"></div><div><label>前半 終了</label><input type="time" id="d1e" value="${esc(t.p1end)}"></div>
    <div><label>後半 開始</label><input type="time" id="d2s" value="${esc(t.p2start)}"></div><div><label>後半 終了</label><input type="time" id="d2e" value="${esc(t.p2end)}"></div></div>
    <div class="row" style="margin-top:10px"><button class="primary small" id="dApply">この日の時間にする</button><button class="small" id="dApplyWd">毎週${i.wd}曜に反映</button><button class="small" id="dReset">基本の時刻に戻す</button></div></div>`;
}

function bindAdmin() {
  const m = AD.info.month;
  bindMonthBar('admin', () => pageAdmin());
  $('adminRefresh').onclick = async () => { await pageAdmin(true); toast('最新の状態にしました'); };
  document.querySelectorAll('details[data-sec]').forEach(el => el.addEventListener('toggle', () => {
    S.adminOpen[el.dataset.sec] = el.open;
    if (el.dataset.sec === 'settings' && el.open) loadSettings();
  }));
  if (S.adminOpen.settings) loadSettings();
  // 利用枠カレンダー
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { AD.calMode = b.dataset.mode; AD.selDay = null; keepDraw(); });
  document.querySelectorAll('[data-cal]').forEach(c => c.onclick = () => {
    const day = c.dataset.cal, e = AD.edit[day];
    if (AD.calMode === 'toggle') { const on = !(e.first || e.second); e.first = e.second = on; }
    else AD.selDay = AD.selDay === day ? null : day;
    keepDraw();
    if (AD.calMode === 'edit' && AD.selDay) setTimeout(() => jumpTo('dayEditor'), 50);
  });
  document.querySelectorAll('[data-dp]').forEach(b => b.onclick = () => { const e = AD.edit[AD.selDay]; e[b.dataset.dp] = !e[b.dataset.dp]; keepDraw(); });
  const readDay = () => ({ p1start: $('d1s').value, p1end: $('d1e').value, p2start: $('d2s').value, p2end: $('d2e').value });
  const okTimes = t => {
    if (!t.p1start || !t.p1end || !t.p2start || !t.p2end) { toast('時刻をすべて入力してください', true); return false; }
    if (t.p1start >= t.p1end || t.p2start >= t.p2end) { toast('終了は開始より後にしてください', true); return false; }
    if (t.p1end > t.p2start) { toast('前半の終了が後半の開始より後になっています', true); return false; }
    return true;
  };
  const same = t => { const b = baseTimes(); return ['p1start', 'p1end', 'p2start', 'p2end'].every(k => t[k] === b[k]); };
  if ($('dApply')) {
    $('dApply').onclick = () => { const t = readDay(); if (!okTimes(t)) return; AD.edit[AD.selDay].t = same(t) ? null : t; keepDraw(); toast('この日の時間を変えました（保存を押すと反映）'); };
    $('dApplyWd').onclick = () => {
      const t = readDay(); if (!okTimes(t)) return;
      const w = dayInfo(AD.selDay).w, src = AD.edit[AD.selDay];
      Object.entries(AD.edit).forEach(([day, e]) => { if (dayInfo(day).w === w) { e.t = same(t) ? null : Object.assign({}, t); e.first = src.first; e.second = src.second; } });
      keepDraw(); toast('毎週' + WD[w] + '曜に反映しました（保存を押すと反映）');
    };
    $('dReset').onclick = () => { AD.edit[AD.selDay].t = null; keepDraw(); };
  }
  document.querySelectorAll('[data-bulk]').forEach(b => b.onclick = () => {
    const wd = Number($('bulkWd').value);
    Object.entries(AD.edit).forEach(([day, e]) => {
      const w = dayInfo(day).w;
      if (b.dataset.bulk === 'all') { e.first = e.second = true; }
      if (b.dataset.bulk === 'none') { e.first = e.second = false; }
      if (b.dataset.bulk === 'weekend' && (w === 0 || w === 6)) { e.first = e.second = false; }
      if (b.dataset.bulk === 'wdoff' && w === wd) { e.first = e.second = false; }
      if (b.dataset.bulk === 'wdon' && w === wd) { e.first = e.second = true; }
    });
    keepDraw();
  });
  $('saveMonth').onclick = async () => {
    const times = { p1start: $('t1s').value, p1end: $('t1e').value, p2start: $('t2s').value, p2end: $('t2e').value };
    const status = $('mStatus') ? $('mStatus').value : AD.info.rawStatus;
    if (status === '受付中' && !$('mDeadline').value && !confirm('締切日時が空です。締切なしで受付を始めますか？')) return;
    try {
      const r = await api('saveMonth', { month: m, status, deadline: $('mDeadline').value, times, slots: Object.entries(AD.edit).map(([day, e]) => ({ day, first: e.first, second: e.second, t: e.t || undefined })) });
      toast('保存しました（状態：' + r.info.status + '）');
      if (r.closedButAllocated) toast('注意：利用不可にした枠に割り当てが' + r.closedButAllocated + '件あります。③で直してください', true);
      pageAdmin(true);
    } catch (e) {}
  };
  // 提出状況
  const cp = $('copyNotYet');
  if (cp) cp.onclick = () => {
    const names = AD.bands.filter(b => b.status === '有効' && !b.requests.length).map(b => b.name);
    const text = `【${monthLabel(m)}の部室の希望】\nまだ出していないバンド：\n${names.map(n => '・' + n).join('\n')}\n締切：${fmtDT(AD.info.deadline) || '未定'}\n${location.href.split('#')[0]}`;
    copyText(text).then(() => toast('コピーしました。LINEに貼り付けてね')).catch(() => toast('コピーできませんでした', true));
  };
  // 割り当て
  const run = $('runAlloc');
  if (run) run.onclick = async () => {
    if (AD.allocs.length && !confirm('今の仮割り当て（手動の変更も含む）を消して、やり直しますか？')) return;
    if (AD.info.rawStatus === '受付中' && !confirm('まだ受付中です。実行すると受付を締め切ります。よろしいですか？')) return;
    try { const r = await api('runAllocation', { month: m }); toast(r.count + '枠を仮割り当てしました（まだ非公開）'); S.adminOpen.alloc = true; pageAdmin(true); } catch (e) {}
  };
  const cf = $('confirmAlloc');
  if (cf) cf.onclick = async () => {
    if (!confirm(monthLabel(m) + 'のシフトを確定して、全員に公開しますか？')) return;
    try { const r = await api('confirm', { month: m }); toast(r.count + '枠を確定・公開しました'); pageAdmin(true); } catch (e) {}
  };
  const uc = $('unconfirm');
  if (uc) uc.onclick = async () => {
    if (!confirm('確定を取り消して非公開に戻しますか？（割り当て内容は仮として残ります）')) return;
    try { await api('unconfirm', { month: m }); toast('確定を取り消しました'); pageAdmin(true); } catch (e) {}
  };
  document.querySelectorAll('[data-slot]').forEach(sel => sel.onchange = async () => {
    const [day, period] = sel.dataset.slot.split('|');
    try { const r = await api('setSlot', { month: m, day, period, bandId: sel.value }); toast(r.state === '確定' ? '変更して公開しました' : '変更しました'); } catch (e) {}
    pageAdmin(true);
  });
  // バンド管理
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { S.editBand = S.editBand === b.dataset.edit ? null : b.dataset.edit; keepDraw(); });
  document.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const pw = $('ebPw').value.trim();
    if (pw && pw.length < 4) return toast('パスワードは4文字以上にしてください', true);
    try {
      const r = await api('updateBand', { bandId: b.dataset.save, name: $('ebName').value, password: pw || undefined });
      toast(r.done.length ? r.done.join('、') + 'しました' + (pw ? '。新しいパスワードをバンドに伝えてください' : '') : '変更はありません');
      S.editBand = null; pageAdmin(true);
    } catch (e) {}
  });
  document.querySelectorAll('[data-stop]').forEach(b => b.onclick = async () => {
    const band = AD.bands.find(x => x.id === b.dataset.stop);
    const to = band.status === '有効' ? '停止' : '有効';
    if (!confirm(band.name + ' を' + (to === '停止' ? '停止' : '再開') + 'しますか？')) return;
    try { await api('updateBand', { bandId: band.id, status: to }); toast(to === '停止' ? '停止しました' : '再開しました'); pageAdmin(true); } catch (e) {}
  });
}
function keepDraw() { const y = window.scrollY; captureForm(); drawAdmin(); window.scrollTo(0, y); }

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return new Promise((res, rej) => {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); } finally { ta.remove(); }
  });
}

let ST = null, editAdmin = null;
async function loadSettings() {
  const box = $('settingsBody'); if (!box) return;
  try { ST = await api('getSettings'); } catch (e) { return; }
  drawSettings();
}
function drawSettings() {
  const box = $('settingsBody'); if (!box || !ST) return;
  const s = ST;
  box.innerHTML = `<label for="sPhrase">部の合言葉（バンド登録に必要）</label><input id="sPhrase" value="${esc(s.passphrase)}">
    <label for="sHist">公平性で数える過去の月数</label><input id="sHist" type="number" min="1" max="24" value="${esc(s.historyMonths)}">
    <button class="primary wide" id="saveSet">保存</button>
    <h3>管理者（幹部）一覧</h3>
    <ul class="list">${s.admins.map(a => `<li><div class="line"><span class="nm">${esc(a.name)}${a.id === s.myId ? '（自分）' : ''}</span><span>${a.status === '有効' ? '' : '<span class="pill ng">停止中</span> '}<button class="small" data-aedit="${esc(a.id)}">編集</button></span></div>` +
      (editAdmin === a.id ? `<div class="editbox"><label>新しいパスワード（リセットするときだけ）</label><input id="eaPw" type="text" autocomplete="off" placeholder="8文字以上">
        <div class="row" style="margin-top:10px"><button class="primary" data-asave="${esc(a.id)}">パスワードを保存</button>${a.id === s.myId ? '' : `<button class="${a.status === '有効' ? 'danger' : ''}" data-astop="${esc(a.id)}">${a.status === '有効' ? '停止する' : '再開する'}</button>`}</div>
        <p class="hint">自分のパスワードは「👤 アカウント」からも変えられます。引退した幹部は停止してください。</p></div>` : '') + '</li>').join('')}</ul>
    <h3>管理者を追加</h3>
    <label for="naName">名前（ログインに使う）</label><input id="naName" maxlength="40">
    <label for="naPw">仮パスワード（8文字以上・本人に伝える）</label><input id="naPw" type="text" autocomplete="off">
    <button class="wide" id="addAdmin">追加する</button>`;
  $('saveSet').onclick = async () => {
    try { await api('saveSettings', { passphrase: $('sPhrase').value, historyMonths: Number($('sHist').value) }); toast('設定を保存しました'); } catch (e) {}
  };
  $('addAdmin').onclick = async () => {
    if ($('naPw').value.length < 8) return toast('仮パスワードは8文字以上にしてください', true);
    try { const r = await api('addAdmin', { name: $('naName').value, password: $('naPw').value }); toast(r.name + ' を管理者に追加しました。名前と仮パスワードを本人に伝えてください'); loadSettings(); } catch (e) {}
  };
  box.querySelectorAll('[data-aedit]').forEach(b => b.onclick = () => { editAdmin = editAdmin === b.dataset.aedit ? null : b.dataset.aedit; drawSettings(); });
  box.querySelectorAll('[data-asave]').forEach(b => b.onclick = async () => {
    const pw = $('eaPw').value.trim();
    if (pw.length < 8) return toast('パスワードは8文字以上にしてください', true);
    try {
      await api('updateAdmin', { adminId: b.dataset.asave, password: pw });
      if (b.dataset.asave === ST.myId) { toast('自分のパスワードを変えたので、もう一度ログインしてください'); ACC.removeCur(); verifyCurrent().then(render); return; }
      toast('パスワードをリセットしました。本人に伝えてください'); editAdmin = null; loadSettings();
    } catch (e) {}
  });
  box.querySelectorAll('[data-astop]').forEach(b => b.onclick = async () => {
    const a = ST.admins.find(x => x.id === b.dataset.astop), to = a.status === '有効' ? '停止' : '有効';
    if (!confirm(a.name + ' を' + (to === '停止' ? '停止' : '再開') + 'しますか？')) return;
    try { await api('updateAdmin', { adminId: a.id, status: to }); toast(to === '停止' ? '停止しました' : '再開しました'); editAdmin = null; loadSettings(); } catch (e) {}
  });
}

boot();
})();
