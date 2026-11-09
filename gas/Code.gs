/**
 * 軽音楽部 部室シフト：サーバー側（Google Apps Script）
 *
 * 使い方（くわしくは docs/セットアップ手順.md）
 *  1. 部用Gmailでスプレッドシートを作る
 *  2. 拡張機能 > Apps Script を開き、このファイルの中身を全部貼り付けて保存
 *  3. 上の関数選択で「setup」を選んで ▶実行（初回は権限の許可が必要）
 *  4. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *     実行ユーザー：自分 / アクセスできるユーザー：全員
 *  5. 表示された「ウェブアプリのURL」を public/config.js に貼る
 *
 * ⚠ コードを書き換えたら「デプロイを管理 > ✏編集 > バージョン：新バージョン > デプロイ」。
 *   「新しいデプロイ」を押すとURLが変わり、サイトが動かなくなります。
 */

const TZ = 'Asia/Tokyo';
const APP_ID = 'club-shift-v1';
const TOKEN_DAYS = 30;
const MAX_REQUESTS = 31;
const LOGIN_MAX_FAIL = 5;
const LOGIN_LOCK_SEC = 600;
const HASH_ROUNDS = 500;

const PERIODS = { first: '前半', second: '後半' };
const PERIOD_FROM_JA = { '前半': 'first', '後半': 'second' };
const MONTH_STATUSES = ['準備中', '受付中', '締切', '確定'];

const SHEETS = {
  bands:    { name: 'バンド',   head: ['ID', 'バンド名', '照合キー', 'ソルト', 'ハッシュ', '版', '状態', '登録日時'] },
  months:   { name: '月設定',   head: ['月', '状態', '締切', '前半開始', '前半終了', '後半開始', '後半終了', '更新日時'] },
  slots:    { name: '利用枠',   head: ['月', '日付', '前半', '後半'] },
  requests: { name: '希望',     head: ['月', 'バンドID', '日付', '枠', '順位', '更新日時'] },
  allocs:   { name: '割り当て', head: ['月', '日付', '枠', 'バンドID', '状態', '方法', '希望順位', '更新日時'] },
  settings: { name: '設定',     head: ['項目', '値', '説明'] },
  log:      { name: 'ログ',     head: ['日時', '操作者', '操作', '内容'] },
};

const SETTING_NOTES = {
  passphrase: '部の合言葉（バンド登録のときに必要）。アプリの管理画面から変更できます',
  history_months: '公平性の計算で数える「過去の確定回数」の月数',
  initial_admin_password: '初期の管理者パスワード。アプリで変更すると自動で消えます',
  admin_salt: '触らないでください',
  admin_hash: '触らないでください',
  admin_ver: '触らないでください',
};

/* ================= 入口 ================= */

function doGet() {
  return json_({ ok: true, app: APP_ID, now: nowStr_() });
}

function doPost(e) {
  let out;
  let lock = null;
  try {
    MEMO = {};
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const def = ACTIONS[req.action];
    if (!def) throw userErr_('不明な操作です');
    const auth = req.token ? verifyToken_(req.token) : null;
    if (def.auth !== 'none') {
      if (!auth) throw userErr_('ログインし直してください', 'AUTH');
      if (def.auth === 'band' && auth.role !== 'band') throw userErr_('バンドアカウントでログインしてください');
      if (def.auth === 'admin' && auth.role !== 'admin') throw userErr_('管理者のみの操作です');
    }
    if (def.write) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) throw userErr_('混み合っています。少し待ってからもう一度押してください');
    }
    out = { ok: true, data: def.fn(req, auth) };
  } catch (err) {
    if (err && err.user) {
      out = { ok: false, error: err.message, code: err.code || '' };
    } else {
      console.error(err && err.stack || err);
      out = { ok: false, error: 'サーバーでエラーが起きました（' + String(err && err.message || err).slice(0, 120) + '）' };
    }
  } finally {
    if (lock) { try { SpreadsheetApp.flush(); } catch (_) {} lock.releaseLock(); }
  }
  return json_(out);
}

const ACTIONS = {
  ping:          { auth: 'none',  fn: () => ({ app: APP_ID, now: nowStr_() }) },
  register:      { auth: 'none',  write: true, fn: actRegister_ },
  login:         { auth: 'none',  fn: actLogin_ },
  adminLogin:    { auth: 'none',  fn: actAdminLogin_ },
  me:            { auth: 'any',   fn: (req, a) => meOf_(a) },
  month:         { auth: 'any',   fn: actMonth_ },
  saveRequests:  { auth: 'band',  write: true, fn: actSaveRequests_ },
  changePassword:{ auth: 'band',  write: true, fn: actChangePassword_ },
  adminMonth:    { auth: 'admin', fn: actAdminMonth_ },
  saveMonth:     { auth: 'admin', write: true, fn: actSaveMonth_ },
  runAllocation: { auth: 'admin', write: true, fn: actRunAllocation_ },
  setSlot:       { auth: 'admin', write: true, fn: actSetSlot_ },
  confirm:       { auth: 'admin', write: true, fn: actConfirm_ },
  unconfirm:     { auth: 'admin', write: true, fn: actUnconfirm_ },
  updateBand:    { auth: 'admin', write: true, fn: actUpdateBand_ },
  getSettings:   { auth: 'admin', fn: actGetSettings_ },
  saveSettings:  { auth: 'admin', write: true, fn: actSaveSettings_ },
};

/* ================= アカウント ================= */

function actRegister_(req) {
  const name = cleanName_(req.name);
  const pw = String(req.password || '');
  checkPassword_(pw);
  const phrase = getSetting_('passphrase');
  if (!phrase || normKey_(req.passphrase) !== normKey_(phrase)) throw userErr_('部の合言葉が違います');
  const key = normKey_(name);
  const rows = read_('bands');
  if (rows.some(r => r[2] === key)) throw userErr_('そのバンド名はすでに登録されています');
  const id = 'b_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const salt = Utilities.getUuid();
  rows.push([id, name, key, salt, hash_(pw, salt), '1', '有効', nowStr_()]);
  write_('bands', rows);
  log_(name, '登録', '');
  return { token: sign_({ r: 'band', id: id, v: '1' }), me: { role: 'band', band: { id: id, name: name } } };
}

function actLogin_(req) {
  const key = normKey_(req.name);
  if (!key) throw userErr_('バンド名を入力してください');
  checkThrottle_(key);
  const row = read_('bands').find(r => r[2] === key);
  if (!row || hash_(String(req.password || ''), row[3]) !== row[4]) {
    addFail_(key);
    throw userErr_('バンド名かパスワードが違います');
  }
  if (row[6] !== '有効') throw userErr_('このアカウントは停止中です。管理者に連絡してください');
  clearFail_(key);
  return { token: sign_({ r: 'band', id: row[0], v: row[5] }), me: { role: 'band', band: { id: row[0], name: row[1] } } };
}

function actAdminLogin_(req) {
  checkThrottle_('#admin');
  const salt = getSetting_('admin_salt');
  if (!salt || hash_(String(req.password || ''), salt) !== getSetting_('admin_hash')) {
    addFail_('#admin');
    throw userErr_('管理者パスワードが違います');
  }
  clearFail_('#admin');
  return { token: sign_({ r: 'admin', id: 'admin', v: getSetting_('admin_ver') || '1' }), me: { role: 'admin' } };
}

function actChangePassword_(req, auth) {
  const rows = read_('bands');
  const row = rows.find(r => r[0] === auth.id);
  if (hash_(String(req.oldPassword || ''), row[3]) !== row[4]) throw userErr_('今のパスワードが違います');
  const pw = String(req.newPassword || '');
  checkPassword_(pw);
  row[3] = Utilities.getUuid();
  row[4] = hash_(pw, row[3]);
  row[5] = String(Number(row[5] || 1) + 1);
  write_('bands', rows);
  log_(row[1], 'パスワード変更', '');
  return { token: sign_({ r: 'band', id: row[0], v: row[5] }) };
}

function meOf_(auth) {
  if (auth.role === 'admin') return { role: 'admin' };
  return { role: 'band', band: { id: auth.band[0], name: auth.band[1] } };
}

/* ================= 閲覧（全員） ================= */

function actMonth_(req, auth) {
  const m = checkMonth_(req.month);
  const names = bandNames_();
  const res = {
    info: monthInfo_(m),
    slots: slotsOf_(m),
    confirmed: read_('allocs').filter(r => r[0] === m && r[4] === '確定')
      .map(r => ({ day: r[1], period: PERIOD_FROM_JA[r[2]], bandId: r[3], band: names[r[3]] || '（削除済み）' }))
      .sort(slotSort_),
  };
  if (auth.role === 'band') {
    res.myRequests = read_('requests').filter(r => r[0] === m && r[1] === auth.id)
      .sort((a, b) => Number(a[4]) - Number(b[4]))
      .map(r => r[2] + '|' + PERIOD_FROM_JA[r[3]]);
    const up = read_('requests').find(r => r[0] === m && r[1] === auth.id);
    res.myUpdated = up ? up[5] : '';
  }
  return res;
}

/* ================= 希望提出（バンド） ================= */

function actSaveRequests_(req, auth) {
  const m = checkMonth_(req.month);
  const info = monthInfo_(m);
  if (!info.accepting) throw userErr_('この月は希望の受付期間外です（状態：' + info.status + '）');
  const list = Array.isArray(req.slots) ? req.slots.map(String) : [];
  if (list.length > MAX_REQUESTS) throw userErr_('希望は最大' + MAX_REQUESTS + '件までです');
  if (new Set(list).size !== list.length) throw userErr_('同じ枠が2回入っています');
  const open = openSet_(m);
  list.forEach(s => { if (!open.has(s)) throw userErr_('利用できない枠が含まれています（' + s.replace('|', ' ') + '）。画面を更新してください'); });
  const now = nowStr_();
  const rows = read_('requests').filter(r => !(r[0] === m && r[1] === auth.id));
  list.forEach((s, i) => {
    const p = s.split('|');
    rows.push([m, auth.id, p[0], PERIODS[p[1]], String(i + 1), now]);
  });
  write_('requests', rows);
  log_(auth.band[1], '希望提出', m + ' ' + list.length + '件');
  return { saved: list.length, updated: now };
}

/* ================= 管理者 ================= */

function actAdminMonth_(req) {
  const m = checkMonth_(req.month);
  const bands = read_('bands');
  const names = bandNames_();
  const hist = historyCounts_(m);
  const reqRows = read_('requests').filter(r => r[0] === m);
  const byBand = {};
  reqRows.forEach(r => {
    (byBand[r[1]] = byBand[r[1]] || { list: [], updated: r[5] }).list.push({ slot: r[2] + '|' + PERIOD_FROM_JA[r[3]], rank: Number(r[4]) });
  });
  return {
    info: monthInfo_(m),
    slots: slotsOf_(m),
    allocs: read_('allocs').filter(r => r[0] === m).map(r => ({
      day: r[1], period: PERIOD_FROM_JA[r[2]], bandId: r[3], band: names[r[3]] || '（削除済み）',
      status: r[4], method: r[5], rank: r[6] ? Number(r[6]) : null,
    })).sort(slotSort_),
    bands: bands.map(r => {
      const b = byBand[r[0]];
      return {
        id: r[0], name: r[1], status: r[6], created: r[7], history: hist[r[0]] || 0,
        requests: b ? b.list.sort((x, y) => x.rank - y.rank).map(x => x.slot) : [],
        updated: b ? b.updated : '',
      };
    }),
    historyMonths: historyMonths_(),
  };
}

function actSaveMonth_(req) {
  const m = checkMonth_(req.month);
  const cur = monthInfo_(m);
  let status = String(req.status || '準備中');
  if (['準備中', '受付中', '締切'].indexOf(status) < 0) throw userErr_('状態の値が正しくありません');
  if (cur.rawStatus === '確定') status = '確定';
  const deadline = String(req.deadline || '');
  if (deadline && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline)) throw userErr_('締切日時の形式が正しくありません');
  const t = req.times || {};
  ['p1start', 'p1end', 'p2start', 'p2end'].forEach(k => {
    if (!/^\d{2}:\d{2}$/.test(String(t[k] || ''))) throw userErr_('時刻をすべて入力してください');
  });
  if (t.p1start >= t.p1end || t.p2start >= t.p2end) throw userErr_('終了時刻は開始時刻より後にしてください');
  const n = daysIn_(m);
  const given = {};
  (Array.isArray(req.slots) ? req.slots : []).forEach(s => { given[String(s.day)] = s; });
  const slotRows = read_('slots').filter(r => r[0] !== m);
  for (let d = 1; d <= n; d++) {
    const day = m + '-' + pad_(d);
    const s = given[day] || { first: false, second: false };
    slotRows.push([m, day, s.first ? '○' : '×', s.second ? '○' : '×']);
  }
  write_('slots', slotRows);
  const monthRows = read_('months').filter(r => r[0] !== m);
  monthRows.push([m, status, deadline, t.p1start, t.p1end, t.p2start, t.p2end, nowStr_()]);
  write_('months', monthRows);
  const open = openSet_(m);
  const warn = read_('allocs').filter(r => r[0] === m && !open.has(r[1] + '|' + PERIOD_FROM_JA[r[2]])).length;
  log_('管理者', '月設定保存', m + ' ' + status);
  return { info: monthInfo_(m), closedButAllocated: warn };
}

function actRunAllocation_(req) {
  const m = checkMonth_(req.month);
  const all = read_('allocs');
  if (all.some(r => r[0] === m && r[4] === '確定')) throw userErr_('この月は確定済みです。やり直すときは先に「確定を取り消す」を押してください');
  const active = read_('bands').filter(r => r[6] === '有効').map(r => r[0]);
  const activeSet = new Set(active);
  const reqMap = {};
  read_('requests').filter(r => r[0] === m && activeSet.has(r[1]))
    .sort((a, b) => Number(a[4]) - Number(b[4]))
    .forEach(r => (reqMap[r[1]] = reqMap[r[1]] || []).push(r[2] + '|' + PERIOD_FROM_JA[r[3]]));
  const result = allocate_(active, reqMap, openSet_(m), historyCounts_(m), Math.random);
  const now = nowStr_();
  const rows = all.filter(r => r[0] !== m);
  result.forEach(x => {
    const p = x.slot.split('|');
    rows.push([m, p[0], PERIODS[p[1]], x.bandId, '仮', '自動', String(x.rank), now]);
  });
  write_('allocs', rows);
  // 割り当て後に希望が変わらないよう、受付中なら締切にする
  const info = monthInfo_(m);
  if (info.rawStatus === '受付中' || info.rawStatus === '準備中') setMonthStatus_(m, '締切');
  log_('管理者', '自動割り当て', m + ' ' + result.length + '枠');
  return { count: result.length };
}

function actSetSlot_(req) {
  const m = checkMonth_(req.month);
  const day = String(req.day || '');
  const period = String(req.period || '');
  if (!PERIODS[period] || day.slice(0, 7) !== m) throw userErr_('枠の指定が正しくありません');
  const slot = day + '|' + period;
  const bandId = String(req.bandId || '');
  const all = read_('allocs');
  const confirmedMonth = all.some(r => r[0] === m && r[4] === '確定');
  const state = confirmedMonth ? '確定' : '仮';
  let rows = all.filter(r => !(r[0] === m && r[1] === day && r[2] === PERIODS[period]));
  if (bandId) {
    if (!openSet_(m).has(slot)) throw userErr_('その枠は利用不可に設定されています');
    const band = read_('bands').find(r => r[0] === bandId);
    if (!band || band[6] !== '有効') throw userErr_('そのバンドは存在しないか停止中です');
    if (rows.some(r => r[0] === m && r[1] === day && r[3] === bandId)) throw userErr_(band[1] + ' は同じ日に別の枠があります');
    const rq = read_('requests').find(r => r[0] === m && r[1] === bandId && r[2] === day && r[3] === PERIODS[period]);
    rows.push([m, day, PERIODS[period], bandId, state, '手動', rq ? rq[4] : '', nowStr_()]);
  }
  write_('allocs', rows);
  log_('管理者', '枠の手動変更', slot + ' → ' + (bandId ? (bandNames_()[bandId] || bandId) : 'なし') + '（' + state + '）');
  return { state: state };
}

function actConfirm_(req) {
  const m = checkMonth_(req.month);
  const rows = read_('allocs');
  const target = rows.filter(r => r[0] === m && r[4] === '仮');
  if (!target.length) throw userErr_('確定する仮の割り当てがありません');
  const open = openSet_(m);
  if (target.some(r => !open.has(r[1] + '|' + PERIOD_FROM_JA[r[2]]))) throw userErr_('利用不可の枠に割り当てがあります。プレビューで「なし」にしてから確定してください');
  target.forEach(r => { r[4] = '確定'; });
  write_('allocs', rows);
  setMonthStatus_(m, '確定');
  log_('管理者', '一括確定', m + ' ' + target.length + '枠');
  return { count: target.length };
}

function actUnconfirm_(req) {
  const m = checkMonth_(req.month);
  const rows = read_('allocs');
  let n = 0;
  rows.forEach(r => { if (r[0] === m && r[4] === '確定') { r[4] = '仮'; n++; } });
  write_('allocs', rows);
  setMonthStatus_(m, '締切');
  log_('管理者', '確定取り消し', m + ' ' + n + '枠');
  return { count: n };
}

function actUpdateBand_(req) {
  const rows = read_('bands');
  const row = rows.find(r => r[0] === String(req.bandId || ''));
  if (!row) throw userErr_('バンドが見つかりません');
  const done = [];
  if (req.name != null && String(req.name).trim() !== row[1]) {
    const name = cleanName_(req.name);
    const key = normKey_(name);
    if (rows.some(r => r !== row && r[2] === key)) throw userErr_('そのバンド名はすでに使われています');
    done.push('名前変更 ' + row[1] + '→' + name);
    row[1] = name; row[2] = key;
  }
  if (req.password) {
    checkPassword_(String(req.password));
    row[3] = Utilities.getUuid();
    row[4] = hash_(String(req.password), row[3]);
    row[5] = String(Number(row[5] || 1) + 1);
    done.push('パスワードリセット');
  }
  if (req.status && req.status !== row[6]) {
    if (['有効', '停止'].indexOf(req.status) < 0) throw userErr_('状態の値が正しくありません');
    row[6] = req.status;
    row[5] = String(Number(row[5] || 1) + 1);
    done.push('状態→' + req.status);
  }
  write_('bands', rows);
  if (done.length) log_('管理者', 'バンド編集', row[1] + '：' + done.join('、'));
  return { done: done };
}

function actGetSettings_() {
  return { passphrase: getSetting_('passphrase'), historyMonths: historyMonths_() };
}

function actSaveSettings_(req) {
  const res = {};
  if (req.passphrase != null) {
    const p = String(req.passphrase).trim();
    if (p.length < 4) throw userErr_('合言葉は4文字以上にしてください');
    setSetting_('passphrase', p);
  }
  if (req.historyMonths != null) {
    const n = Number(req.historyMonths);
    if (!(n >= 1 && n <= 24 && Math.floor(n) === n)) throw userErr_('履歴の月数は1〜24で入力してください');
    setSetting_('history_months', String(n));
  }
  if (req.adminPassword) {
    checkPassword_(String(req.adminPassword));
    const salt = Utilities.getUuid();
    setSetting_('admin_salt', salt);
    setSetting_('admin_hash', hash_(String(req.adminPassword), salt));
    const v = String(Number(getSetting_('admin_ver') || 1) + 1);
    setSetting_('admin_ver', v);
    setSetting_('initial_admin_password', '');
    res.token = sign_({ r: 'admin', id: 'admin', v: v });
  }
  log_('管理者', '設定変更', Object.keys(req).filter(k => ['passphrase', 'historyMonths', 'adminPassword'].indexOf(k) >= 0 && req[k] != null && req[k] !== '').join(','));
  return res;
}

/* ================= 割り当てアルゴリズム（ドラフト方式） =================
 * 1周ごとに、各バンドは最大1枠。
 * 並び順：直近N か月の確定回数＋今月すでに取った数 が少ない順。同点は毎周シャッフル。
 * 各バンドは「自分の希望のうち、まだ空いていて同じ日に自分の枠がない最上位」を取る。
 * 誰も取れなくなったら終了。希望にない枠は割り当てない。
 */
function allocate_(bandIds, reqMap, openSet, history, rand) {
  const taken = new Set();
  const bandDay = new Set();
  const count = {};
  const result = [];
  let live = bandIds.filter(id => (reqMap[id] || []).length);
  live.forEach(id => { count[id] = 0; });
  while (live.length) {
    const order = live.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    const score = id => (history[id] || 0) + count[id];
    order.sort((a, b) => score(a) - score(b)); // 安定ソートなので同点はシャッフル順
    const next = [];
    order.forEach(id => {
      const list = reqMap[id];
      for (let k = 0; k < list.length; k++) {
        const s = list[k];
        const day = s.split('|')[0];
        if (openSet.has(s) && !taken.has(s) && !bandDay.has(id + '|' + day)) {
          taken.add(s); bandDay.add(id + '|' + day); count[id]++;
          result.push({ bandId: id, slot: s, rank: k + 1 });
          next.push(id);
          return;
        }
      }
    });
    live = next;
  }
  return result;
}

/* ================= 月・枠の補助 ================= */

function monthInfo_(m) {
  const rows = read_('months');
  let row = rows.find(r => r[0] === m);
  let times;
  if (row) {
    times = { p1start: row[3], p1end: row[4], p2start: row[5], p2end: row[6] };
  } else {
    const prev = rows.filter(r => r[0] < m).sort((a, b) => a[0] < b[0] ? 1 : -1)[0];
    times = prev ? { p1start: prev[3], p1end: prev[4], p2start: prev[5], p2end: prev[6] }
                 : { p1start: '15:30', p1end: '17:00', p2start: '17:00', p2end: '18:30' };
  }
  const raw = row ? row[1] : '準備中';
  const deadline = row ? row[2] : '';
  const past = !!deadline && nowStr_() > deadline;
  const status = raw === '受付中' && past ? '締切' : raw;
  return { month: m, rawStatus: raw, status: status, deadline: deadline, times: times, accepting: raw === '受付中' && !past, exists: !!row };
}

function setMonthStatus_(m, status) {
  const rows = read_('months');
  let row = rows.find(r => r[0] === m);
  if (!row) {
    const info = monthInfo_(m);
    row = [m, status, '', info.times.p1start, info.times.p1end, info.times.p2start, info.times.p2end, nowStr_()];
    rows.push(row);
  }
  row[1] = status; row[7] = nowStr_();
  write_('months', rows);
}

function slotsOf_(m) {
  return read_('slots').filter(r => r[0] === m)
    .map(r => ({ day: r[1], first: r[2] === '○', second: r[3] === '○' }))
    .sort((a, b) => a.day < b.day ? -1 : 1);
}

function openSet_(m) {
  const s = new Set();
  slotsOf_(m).forEach(x => { if (x.first) s.add(x.day + '|first'); if (x.second) s.add(x.day + '|second'); });
  return s;
}

function historyMonths_() {
  const n = Number(getSetting_('history_months') || 3);
  return n >= 1 ? n : 3;
}

function historyCounts_(m) {
  const n = historyMonths_();
  const months = new Set();
  let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  for (let i = 0; i < n; i++) {
    mo--; if (mo === 0) { mo = 12; y--; }
    months.add(y + '-' + pad_(mo));
  }
  const c = {};
  read_('allocs').forEach(r => { if (r[4] === '確定' && months.has(r[0])) c[r[3]] = (c[r[3]] || 0) + 1; });
  return c;
}

function bandNames_() {
  const o = {};
  read_('bands').forEach(r => { o[r[0]] = r[1]; });
  return o;
}

function slotSort_(a, b) {
  return a.day < b.day ? -1 : a.day > b.day ? 1 : (a.period === 'first' ? -1 : 1);
}

function checkMonth_(m) {
  m = String(m || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw userErr_('月の形式が正しくありません');
  return m;
}

function daysIn_(m) {
  return new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
}

/* ================= 認証の補助 ================= */

function cleanName_(s) {
  const name = String(s || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 40) throw userErr_('バンド名は1〜40文字で入力してください');
  return name;
}

function normKey_(s) {
  return String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function checkPassword_(pw) {
  if (pw.length < 8) throw userErr_('パスワードは8文字以上にしてください');
  if (pw.length > 72) throw userErr_('パスワードは72文字以内にしてください');
}

function hash_(pw, salt) {
  let h = salt + ':' + pw;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt + pw, Utilities.Charset.UTF_8));
  }
  return h;
}

function hex_(bytes) {
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function secret_() {
  const s = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!s) throw userErr_('初期設定(setup)が未実行です');
  return s;
}

function sign_(payload) {
  payload.exp = Date.now() + TOKEN_DAYS * 86400000;
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8);
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, secret_()));
  return body + '.' + sig;
}

function verifyToken_(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 2) return null;
    const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], secret_()));
    if (!safeEq_(sig, parts[1])) return null;
    const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
    if (!p.exp || p.exp < Date.now()) return null;
    if (p.r === 'admin') {
      if (String(getSetting_('admin_ver') || '1') !== String(p.v)) return null;
      return { role: 'admin' };
    }
    if (p.r === 'band') {
      const row = read_('bands').find(r => r[0] === p.id);
      if (!row || row[6] !== '有効' || row[5] !== String(p.v)) return null;
      return { role: 'band', id: row[0], band: row };
    }
  } catch (e) { /* 不正なトークン */ }
  return null;
}

function safeEq_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function checkThrottle_(key) {
  const n = Number(CacheService.getScriptCache().get('fail:' + key) || 0);
  if (n >= LOGIN_MAX_FAIL) throw userErr_('パスワードを' + LOGIN_MAX_FAIL + '回間違えたため、10分間ログインできません');
}
function addFail_(key) {
  const c = CacheService.getScriptCache();
  c.put('fail:' + key, String(Number(c.get('fail:' + key) || 0) + 1), LOGIN_LOCK_SEC);
}
function clearFail_(key) {
  CacheService.getScriptCache().remove('fail:' + key);
}

/* ================= シート入出力 ================= */

let MEMO = {};

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sh_(k) {
  const s = ss_().getSheetByName(SHEETS[k].name);
  if (!s) throw userErr_('シート「' + SHEETS[k].name + '」がありません。setup を実行してください');
  return s;
}

function read_(k) {
  if (MEMO[k]) return MEMO[k];
  const s = sh_(k);
  const n = s.getLastRow() - 1;
  const w = SHEETS[k].head.length;
  const rows = n > 0 ? s.getRange(2, 1, n, w).getDisplayValues().filter(r => r.some(v => v !== '')) : [];
  MEMO[k] = rows;
  return rows;
}

/** シート本体を丸ごと書き換える（1回の書き込みで行うので途中で壊れにくい） */
function write_(k, rows) {
  const s = sh_(k);
  const w = SHEETS[k].head.length;
  const old = Math.max(0, s.getLastRow() - 1);
  const data = rows.map(r => { const x = []; for (let i = 0; i < w; i++) x.push(r[i] == null ? '' : String(r[i])); return x; });
  const total = Math.max(old, data.length);
  while (data.length < total) data.push(new Array(w).fill(''));
  if (total > 0) {
    const range = s.getRange(2, 1, total, w);
    range.setNumberFormat('@');
    range.setValues(data);
  }
  MEMO[k] = rows.map(r => r.map(v => v == null ? '' : String(v)));
}

function getSetting_(key) {
  const r = read_('settings').find(x => x[0] === key);
  return r ? r[1] : '';
}

function setSetting_(key, value) {
  const rows = read_('settings');
  const r = rows.find(x => x[0] === key);
  if (r) r[1] = value; else rows.push([key, value, SETTING_NOTES[key] || '']);
  write_('settings', rows);
}

function log_(actor, action, detail) {
  try {
    const s = sh_('log');
    s.getRange(s.getLastRow() + 1, 1, 1, 4).setNumberFormat('@').setValues([[nowStr_(), actor, action, detail]]);
  } catch (e) { console.error(e); }
}

/* ================= 小物 ================= */

function nowStr_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm");
}
function pad_(n) { return ('0' + n).slice(-2); }
function userErr_(msg, code) { const e = new Error(msg); e.user = true; e.code = code; return e; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ================= 初期設定（最初に1回だけ実行） ================= */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('スプレッドシートの「拡張機能 > Apps Script」から開いたプロジェクトで実行してください');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('TOKEN_SECRET')) {
    props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  Object.keys(SHEETS).forEach(k => {
    const def = SHEETS[k];
    let s = ss.getSheetByName(def.name);
    if (!s) s = ss.insertSheet(def.name);
    s.getRange(1, 1, s.getMaxRows(), def.head.length).setNumberFormat('@');
    s.getRange(1, 1, 1, def.head.length).setValues([def.head]).setFontWeight('bold').setBackground('#e8ecf6');
    s.setFrozenRows(1);
    if (!s.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      s.protect().setDescription('アプリが使うシートです。直接編集するときは注意').setWarningOnly(true);
    }
  });
  ['シート1', 'Sheet1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() === 0) ss.deleteSheet(s);
  });
  MEMO = {};
  let msg = [];
  if (!getSetting_('admin_hash')) {
    const pw = 'adm-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    const salt = Utilities.getUuid();
    setSetting_('admin_salt', salt);
    setSetting_('admin_hash', hash_(pw, salt));
    setSetting_('admin_ver', String(Date.now()));
    setSetting_('initial_admin_password', pw);
    msg.push('初期の管理者パスワード：' + pw);
  }
  if (!getSetting_('passphrase')) {
    const p = 'keion' + String(Math.floor(1000 + Math.random() * 9000));
    setSetting_('passphrase', p);
    msg.push('部の合言葉：' + p);
  }
  if (!getSetting_('history_months')) setSetting_('history_months', '3');
  msg.push('初期設定が完了しました。「設定」シートにも書いてあります。');
  Logger.log(msg.join('\n'));
  return msg.join('\n');
}
