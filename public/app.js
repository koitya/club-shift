/* 軽音楽部 部室シフト：画面側 */
(() => {
'use strict';

const CFG = window.APP_CONFIG || {};
const $ = id => document.getElementById(id);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const PJ = { first: '前半', second: '後半' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 保存（ブラウザ） ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
};

/* ---------- 状態 ---------- */
const S = {
  token: store.get('cs_token'),
  me: null,
  tab: 'shift',
  month: { shift: ym(new Date()), request: nextMonth(ym(new Date())), admin: nextMonth(ym(new Date())) },
  onlyMine: store.get('cs_onlyMine') === '1',
  req: null,       // 希望提出の編集中データ {month, list:[], saved:[], dirty}
  adminOpen: { prep: true },
  editBand: null,
};

/* ---------- 日付 ---------- */
function ym(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function nextMonth(m) { let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++; } return y + '-' + String(mo).padStart(2, '0'); }
function prevMonth(m) { let [y, mo] = m.split('-').map(Number); mo--; if (mo < 1) { mo = 12; y--; } return y + '-' + String(mo).padStart(2, '0'); }
function today() { const d = new Date(); return ym(d) + '-' + String(d.getDate()).padStart(2, '0'); }
function dayInfo(day) { const [y, m, d] = day.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return { d, w, wd: WD[w] }; }
function daysOf(m) { const [y, mo] = m.split('-').map(Number); const n = new Date(y, mo, 0).getDate(); const a = []; for (let i = 1; i <= n; i++) a.push(m + '-' + String(i).padStart(2, '0')); return a; }
function monthLabel(m) { const [y, mo] = m.split('-').map(Number); return y + '年' + mo + '月'; }
function fmtDT(s) { if (!s) return ''; const [d, t] = s.split('T'); const i = dayInfo(d); return Number(d.slice(5, 7)) + '/' + i.d + '(' + i.wd + ') ' + (t || ''); }
function timeOf(info, p) { const t = info.times; return p === 'first' ? t.p1start + '〜' + t.p1end : t.p2start + '〜' + t.p2end; }
function slotText(slot, info) { const [d, p] = slot.split('|'); const i = dayInfo(d); return Number(d.slice(5, 7)) + '/' + i.d + '(' + i.wd + ') ' + PJ[p] + (info ? ' ' + timeOf(info, p) : ''); }
function dayLabel(day) { const i = dayInfo(day); const cls = i.w === 6 ? 'sat' : i.w === 0 ? 'sun' : ''; return `<div class="dlabel ${cls} ${day === today() ? 'today' : ''}"><b>${i.d}</b><span>${i.wd}</span></div>`; }

/* ---------- 通信 ---------- */
let busyN = 0;
function busy(on) { busyN += on ? 1 : -1; $('busy').classList.toggle('hidden', busyN <= 0); }

async function api(action, body = {}, opt = {}) {
  busy(true);
  try {
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, token: S.token }, body)),
    });
    const j = await res.json();
    if (!j.ok) {
      if (j.code === 'AUTH') { setToken(null); S.me = null; render(); }
      throw new Error(j.error || 'エラーが起きました');
    }
    return j.data;
  } catch (e) {
    if (e instanceof TypeError) e = new Error('通信できませんでした。電波を確認して、もう一度試してください');
    if (!opt.silent) toast(e.message, true);
    throw e;
  } finally { busy(false); }
}

function setToken(t) { S.token = t; store.set('cs_token', t); }

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
  $('logoutBtn').onclick = () => { if (!confirmLeave()) return; setToken(null); S.me = null; S.req = null; render(); toast('ログアウトしました'); };
  window.addEventListener('beforeunload', e => { if (S.req && S.req.dirty) { e.preventDefault(); e.returnValue = ''; } });
  if (S.token) {
    try { S.me = await api('me', {}, { silent: true }); } catch (e) { S.me = null; }
  }
  render();
}

function render() {
  const logged = !!S.me;
  $('authView').classList.toggle('hidden', logged);
  $('mainView').classList.toggle('hidden', !logged);
  $('logoutBtn').classList.toggle('hidden', !logged);
  $('who').textContent = !logged ? '未ログイン' : S.me.role === 'admin' ? '管理者：' + S.me.admin.name : S.me.band.name;
  if (!logged) return;
  const tabs = S.me.role === 'admin'
    ? [['shift', '📅', 'シフト'], ['admin', '🛠', '管理'], ['account', '👤', 'アカウント']]
    : [['shift', '📅', 'シフト'], ['request', '✋', '希望提出'], ['account', '👤', 'アカウント']];
  if (!tabs.some(t => t[0] === S.tab)) S.tab = 'shift';
  $('tabs').innerHTML = tabs.map(t => `<button data-tab="${t[0]}" class="${S.tab === t[0] ? 'on' : ''}"><span class="ic">${t[1]}</span>${t[2]}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { if (b.dataset.tab !== 'request' && S.tab === 'request' && !confirmLeave()) return; S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); });
  ({ shift: pageShift, request: pageRequest, account: pageAccount, admin: pageAdmin })[S.tab]();
}

function confirmLeave() {
  if (S.req && S.req.dirty) {
    if (!confirm('希望がまだ保存されていません。保存せずに移動しますか？')) return false;
    S.req = null;
  }
  return true;
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
    try { const r = await api('login', { name: $('loginName').value, password: $('loginPw').value }); loggedIn(r); } catch (_) {}
  };
  $('registerForm').onsubmit = async e => {
    e.preventDefault();
    if ($('regPw').value !== $('regPw2').value) return toast('確認用パスワードが一致しません', true);
    if ($('regPw').value.length < 8) return toast('パスワードは8文字以上にしてください', true);
    try {
      const r = await api('register', { name: $('regName').value, password: $('regPw').value, passphrase: $('regPhrase').value });
      loggedIn(r); toast('登録しました。パスワードはバンドの人と共有しておいてね');
    } catch (_) {}
  };
  $('adminForm').onsubmit = async e => {
    e.preventDefault();
    try { const r = await api('adminLogin', { name: $('adminName').value, password: $('adminPw').value }); loggedIn(r); } catch (_) {}
  };
}
function loggedIn(r) {
  setToken(r.token); S.me = r.me; S.tab = 'shift';
  ['loginPw', 'regPw', 'regPw2', 'adminPw'].forEach(id => $(id).value = '');
  render();
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

/* ---------- シフト ---------- */
async function pageShift() {
  const m = S.month.shift;
  $('page').innerHTML = monthBar('shift') + '<p class="empty">読み込み中…</p>';
  bindMonthBar('shift', pageShift);
  let d;
  try { d = await api('month', { month: m }); } catch (e) { $('page').innerHTML = monthBar('shift') + '<p class="empty">読み込めませんでした</p>'; bindMonthBar('shift', pageShift); return; }
  if (S.tab !== 'shift' || S.month.shift !== m) return;
  const myId = S.me.band && S.me.band.id;
  const conf = {};
  d.confirmed.forEach(x => conf[x.day + '|' + x.period] = x);
  let html = monthBar('shift');
  if (!d.confirmed.length) {
    const msg = d.info.status === '受付中' ? `希望を受付中です（締切 ${fmtDT(d.info.deadline) || '未定'}）` : d.info.status === '締切' ? '締め切りました。管理者が割り当て中です' : 'この月のシフトはまだありません';
    html += `<div class="banner info">${statusPill(d.info)} ${esc(msg)}</div>`;
  }
  if (myId) {
    const mine = d.confirmed.filter(x => x.bandId === myId);
    const up = mine.filter(x => x.day >= today());
    if (up.length) {
      const n = up[0];
      html += `<div class="card next"><small>次の練習</small><b>${esc(slotText(n.day + '|' + n.period, d.info))}</b><small>今月の割り当て：${mine.length}枠</small></div>`;
    } else if (mine.length) {
      html += `<div class="banner ok">今月の割り当て：${mine.length}枠</div>`;
    }
    if (d.confirmed.length) html += `<label class="toggle"><input type="checkbox" id="onlyMine" ${S.onlyMine ? 'checked' : ''}> 自分のバンドだけ表示</label>`;
  }
  const slotMap = {}; d.slots.forEach(s => slotMap[s.day] = s);
  const rows = [];
  daysOf(m).forEach(day => {
    const s = slotMap[day];
    const a = conf[day + '|first'], b = conf[day + '|second'];
    if (!s && !a && !b) return;
    if (S.onlyMine && myId && !((a && a.bandId === myId) || (b && b.bandId === myId))) return;
    if (s && !s.first && !s.second && !a && !b) {
      if (!S.onlyMine) rows.push(`<div class="dayrow">${dayLabel(day)}<div class="cell closed" style="grid-column:span 2"><div class="bn">利用不可</div></div></div>`);
      return;
    }
    const cell = (p, x, open) => {
      if (x) return `<div class="cell ${x.bandId === myId ? 'mine' : ''}"><div class="pt">${PJ[p]} ${timeOf(d.info, p)}</div><div class="bn">${esc(x.band)}</div></div>`;
      if (!open) return `<div class="cell closed"><div class="pt">${PJ[p]}</div><div class="bn">利用不可</div></div>`;
      return `<div class="cell empty"><div class="pt">${PJ[p]} ${timeOf(d.info, p)}</div><div class="bn">${d.confirmed.length ? '空き' : '—'}</div></div>`;
    };
    rows.push(`<div class="dayrow">${dayLabel(day)}${cell('first', a, s && s.first)}${cell('second', b, s && s.second)}</div>`);
  });
  html += rows.length ? `<div class="days">${rows.join('')}</div>` : `<p class="empty">${S.onlyMine ? 'この月の割り当てはありません' : '利用枠がまだ設定されていません'}</p>`;
  $('page').innerHTML = html;
  bindMonthBar('shift', pageShift);
  const om = $('onlyMine');
  if (om) om.onchange = () => { S.onlyMine = om.checked; store.set('cs_onlyMine', om.checked ? '1' : null); pageShift(); };
}

/* ---------- 希望提出 ---------- */
async function pageRequest() {
  const m = S.month.request;
  if (!S.req || S.req.month !== m) {
    $('page').innerHTML = monthBar('request') + '<p class="empty">読み込み中…</p>';
    bindMonthBar('request', pageRequest);
    let d;
    try { d = await api('month', { month: m }); } catch (e) { $('page').innerHTML = monthBar('request') + '<p class="empty">読み込めませんでした</p>'; bindMonthBar('request', pageRequest); return; }
    if (S.tab !== 'request' || S.month.request !== m) return;
    S.req = { month: m, data: d, list: d.myRequests.slice(), saved: d.myRequests.slice(), dirty: false, updated: d.myUpdated };
  }
  drawRequest();
}

function drawRequest() {
  const R = S.req, d = R.data, info = d.info;
  const open = new Set(); d.slots.forEach(s => { if (s.first) open.add(s.day + '|first'); if (s.second) open.add(s.day + '|second'); });
  let html = monthBar('request');
  if (info.accepting) {
    html += `<div class="banner info">${statusPill(info)} 締切：<b>${esc(fmtDT(info.deadline) || '未定')}</b></div>`;
  } else {
    const why = { '準備中': 'まだ受付が始まっていません', '締切': '受付は締め切られました', '確定': 'シフトは確定済みです' }[info.status] || '';
    html += `<div class="banner warn">${statusPill(info)} ${esc(why)}</div>`;
  }
  // 自分の希望リスト
  html += `<div class="card"><h2>あなたの希望（${R.list.length}件）</h2>`;
  if (R.list.length) {
    html += '<ol class="ranklist">' + R.list.map((s, i) => {
      const bad = !open.has(s);
      return `<li><span class="no">${i + 1}</span><span class="tx">${esc(slotText(s, info))}${bad ? '<small style="color:var(--ng)">この枠は利用不可になりました</small>' : ''}</span>` +
        (info.accepting ? `<button class="small" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button><button class="small" data-down="${i}" ${i === R.list.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button><button class="small danger" data-del="${i}" aria-label="削除">✕</button>` : '') + '</li>';
    }).join('') + '</ol>';
  } else {
    html += `<p class="hint">${info.accepting ? '下の枠をタップすると、希望順に追加されます。候補が多いほど割り当てられやすくなります。' : '希望は出ていません。'}</p>`;
  }
  if (R.updated && !R.dirty) html += `<p class="hint">最終保存：${esc(fmtDT(R.updated))}</p>`;
  html += '</div>';
  // 枠の選択
  if (info.accepting) {
    html += `<div class="card"><h2>枠を選ぶ</h2><p class="hint" style="margin:0 0 10px">タップで追加・もう一度タップで外す。番号は希望順位です。</p>`;
    const slotMap = {}; d.slots.forEach(s => slotMap[s.day] = s);
    const rows = daysOf(R.month).filter(day => slotMap[day] && (slotMap[day].first || slotMap[day].second)).map(day => {
      const btn = p => {
        const id = day + '|' + p, idx = R.list.indexOf(id);
        if (!open.has(id)) return `<button disabled>${PJ[p]}<small>利用不可</small></button>`;
        return `<button data-pick="${id}" class="${idx >= 0 ? 'sel' : ''}">${idx >= 0 ? '第' + (idx + 1) + '希望' : PJ[p]}<small>${timeOf(info, p)}</small></button>`;
      };
      return `<div class="pick">${dayLabel(day)}${btn('first')}${btn('second')}</div>`;
    });
    html += rows.length ? rows.join('') : '<p class="empty">利用できる枠がありません</p>';
    html += '</div>';
    html += `<div class="savebar"><button id="saveReq" class="${R.dirty ? 'accent' : 'primary'}" ${R.dirty ? '' : 'disabled'}>${R.dirty ? '⚠ 未保存：タップして保存（' + R.list.length + '件）' : '保存済み'}</button></div>`;
  }
  $('page').innerHTML = html;
  bindMonthBar('request', pageRequest);
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
  if (sv) sv.onclick = async () => {
    sv.disabled = true;
    try {
      const r = await api('saveRequests', { month: R.month, slots: R.list });
      R.saved = R.list.slice(); R.dirty = false; R.updated = r.updated;
      toast(r.saved ? '希望を保存しました（' + r.saved + '件）' : '希望を取り下げました');
    } catch (e) {}
    drawRequest();
  };
}

/* ---------- アカウント（バンド） ---------- */
function pageAccount() {
  const isAdmin = S.me.role === 'admin';
  $('page').innerHTML = `<div class="card"><h2>${esc(isAdmin ? S.me.admin.name : S.me.band.name)}</h2><p class="hint">${isAdmin ? '管理者アカウントです。自分のバンドの希望を出すときは、一度ログアウトしてバンドでログインしてください。' : 'バンド名の変更は管理者に頼んでください。'}</p></div>
  <form class="card" id="pwForm"><h2>パスワード変更</h2>
  <label for="oldPw">今のパスワード</label><input id="oldPw" type="password" autocomplete="current-password" required>
  <label for="newPw">新しいパスワード（8文字以上）</label><input id="newPw" type="password" autocomplete="new-password" minlength="8" required>
  <label for="newPw2">新しいパスワード（確認）</label><input id="newPw2" type="password" autocomplete="new-password" minlength="8" required>
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
  if (!keepScroll) { $('page').innerHTML = monthBar('admin') + '<p class="empty">読み込み中…</p>'; bindMonthBar('admin', () => pageAdmin()); }
  let d;
  try { d = await api('adminMonth', { month: m }); } catch (e) { return; }
  if (S.tab !== 'admin' || S.month.admin !== m) return;
  AD = d;
  AD.form = null;
  AD.edit = d.slots.length ? Object.fromEntries(d.slots.map(s => [s.day, { first: s.first, second: s.second }]))
                          : Object.fromEntries(daysOf(m).map(day => [day, { first: true, second: true }]));
  drawAdmin();
  if (keepScroll) window.scrollTo(0, y);
}

function sec(key, title, body, badge = '') {
  return `<details class="card" data-sec="${key}" ${S.adminOpen[key] ? 'open' : ''}><summary><span>${title} ${badge}</span></summary>${body}</details>`;
}

function captureForm() {
  if (!$('saveMonth')) return;
  AD.form = { status: $('mStatus') ? $('mStatus').value : AD.info.rawStatus, deadline: $('mDeadline').value,
    t1s: $('t1s').value, t1e: $('t1e').value, t2s: $('t2s').value, t2e: $('t2e').value };
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
  prep += `<div class="grid2"><div><label>前半 開始</label><input type="time" id="t1s" value="${esc(F.t1s)}"></div><div><label>前半 終了</label><input type="time" id="t1e" value="${esc(F.t1e)}"></div>
    <div><label>後半 開始</label><input type="time" id="t2s" value="${esc(F.t2s)}"></div><div><label>後半 終了</label><input type="time" id="t2e" value="${esc(F.t2e)}"></div></div>`;
  prep += `<h3>利用できる枠 ${d.slots.length ? '' : '<span class="pill warn">未保存</span>'}</h3><p class="hint" style="margin:0 0 8px">緑＝使える、灰色＝使えない（他の部活など）。タップで切り替え。</p>
    <div class="row" style="margin-bottom:10px"><button class="small" data-bulk="all">全部○</button><button class="small" data-bulk="weekend">土日を×</button><button class="small" data-bulk="none">全部×</button></div>`;
  prep += daysOf(m).map(day => {
    const e = AD.edit[day];
    return `<div class="avail">${dayLabel(day)}<button data-av="${day}|first" class="${e.first ? '' : 'off'}">前半 ${e.first ? '○' : '×'}</button><button data-av="${day}|second" class="${e.second ? '' : 'off'}">後半 ${e.second ? '○' : '×'}</button></div>`;
  }).join('');
  prep += `<button class="primary wide" id="saveMonth">月の設定を保存</button>`;
  html += sec('prep', '① 月の準備', prep, statusPill(info));

  // ② 提出状況
  const sorted = active.slice().sort((a, b) => (a.requests.length ? 1 : 0) - (b.requests.length ? 1 : 0) || a.name.localeCompare(b.name, 'ja'));
  let sub = `<p class="hint" style="margin:0 0 6px">「直近${d.historyMonths}か月」＝公平性の計算に使う過去の確定回数</p><ul class="list">` + sorted.map(b => `<li><div class="line"><span class="nm">${esc(b.name)}</span>${b.requests.length ? `<span class="pill ok">${b.requests.length}件</span>` : '<span class="pill ng">未提出</span>'}</div>
    <div class="hint" style="margin:2px 0 0">直近${d.historyMonths}か月：${b.history}回${b.updated ? '・提出 ' + esc(fmtDT(b.updated)) : ''}</div>
    ${b.requests.length ? `<details><summary class="hint">希望を見る</summary><ol class="hint">${b.requests.map(s => `<li>${esc(slotText(s))}</li>`).join('')}</ol></details>` : ''}</li>`).join('') + '</ul>';
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
  if (d.allocs.length || confirmed || drafts.length) {
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
      const one = p => {
        const id = day + '|' + p, a = amap[id];
        if (!open.has(id) && !a) return `<div><div class="meta">${PJ[p]}</div><select disabled><option>利用不可</option></select></div>`;
        const meta = a ? (a.method === '手動' ? '手動' : '第' + a.rank + '希望') : '空き';
        return `<div><div class="meta">${PJ[p]}・${meta}${!open.has(id) ? ' <b style="color:var(--ng)">利用不可の枠です</b>' : ''}</div><select data-slot="${id}">${optsFor(a && a.bandId)}</select></div>`;
      };
      return `<div class="alloc">${dayLabel(day)}<div class="two">${one('first')}${one('second')}</div></div>`;
    }).join('');
  }
  html += sec('alloc', '③ 割り当て', al, drafts.length ? '<span class="pill warn">仮</span>' : confirmed ? '<span class="pill ok">確定</span>' : '');

  // ④ バンド管理
  let bm = '<ul class="list">' + d.bands.slice().sort((a, b) => a.name.localeCompare(b.name, 'ja')).map(b => `<li><div class="line"><span class="nm">${esc(b.name)}</span><span>${b.status === '有効' ? '' : '<span class="pill ng">停止中</span> '}<button class="small" data-edit="${esc(b.id)}">編集</button></span></div>` +
    (S.editBand === b.id ? `<div class="editbox"><label>バンド名</label><input id="ebName" value="${esc(b.name)}" maxlength="40"><label>新しいパスワード（リセットするときだけ入力）</label><input id="ebPw" type="text" autocomplete="off" placeholder="8文字以上"><div class="row" style="margin-top:10px"><button class="primary" data-save="${esc(b.id)}">保存</button><button class="${b.status === '有効' ? 'danger' : ''}" data-stop="${esc(b.id)}">${b.status === '有効' ? '停止する' : '再開する'}</button></div><p class="hint">停止するとログインできなくなり、割り当て対象から外れます（過去の記録は残ります）。</p></div>` : '') + '</li>').join('') + '</ul>';
  if (!d.bands.length) bm = '<p class="empty">まだバンドが登録されていません</p>';
  html += sec('bands', '④ バンド管理', bm, `<span class="pill">${d.bands.length}</span>`);

  // ⑤ 設定
  html += sec('settings', '⑤ 設定', `<div id="settingsBody"><p class="empty">開くと読み込みます</p></div>`);
  $('page').innerHTML = html;
  bindAdmin();
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
  // 利用枠
  document.querySelectorAll('[data-av]').forEach(b => b.onclick = () => {
    const [day, p] = b.dataset.av.split('|'); const e = AD.edit[day]; e[p] = !e[p];
    b.classList.toggle('off', !e[p]); b.textContent = PJ[p] + ' ' + (e[p] ? '○' : '×');
  });
  document.querySelectorAll('[data-bulk]').forEach(b => b.onclick = () => {
    Object.entries(AD.edit).forEach(([day, e]) => {
      const w = dayInfo(day).w;
      if (b.dataset.bulk === 'all') { e.first = e.second = true; }
      if (b.dataset.bulk === 'none') { e.first = e.second = false; }
      if (b.dataset.bulk === 'weekend' && (w === 0 || w === 6)) { e.first = e.second = false; }
    });
    keepDraw();
  });
  $('saveMonth').onclick = async () => {
    const times = { p1start: $('t1s').value, p1end: $('t1e').value, p2start: $('t2s').value, p2end: $('t2e').value };
    const status = $('mStatus') ? $('mStatus').value : AD.info.rawStatus;
    if (status === '受付中' && !$('mDeadline').value && !confirm('締切日時が空です。締切なしで受付を始めますか？')) return;
    try {
      const r = await api('saveMonth', { month: m, status, deadline: $('mDeadline').value, times, slots: Object.entries(AD.edit).map(([day, e]) => ({ day, first: e.first, second: e.second })) });
      toast('保存しました（状態：' + r.info.status + '）');
      if (r.closedButAllocated) toast('注意：利用不可にした枠に割り当てが' + r.closedButAllocated + '件あります。③で直してください', true);
      pageAdmin(true);
    } catch (e) {}
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
    if (pw && pw.length < 8) return toast('パスワードは8文字以上にしてください', true);
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
      if (b.dataset.asave === ST.myId) { toast('自分のパスワードを変えたので、もう一度ログインしてください'); setToken(null); S.me = null; render(); return; }
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
