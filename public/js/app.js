/* FTS CPR — web app (runs in the browser; data lives in Google Sheets via /api/gas). */
(function () {
  'use strict';
  var C = window.CPR;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = C.esc, has = C.has, num = C.num, getP = C.getP, setP = C.setP;
  var R = '<i class="req" aria-hidden="true">*</i>';
  var LS = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var S = {user: null, config: null, screen: '', flash: '', form: null, report: null, home: null, nat: null,
    natFilters: LS.get('cpr.natFilters') || {fy: '', monthNo: null, zone: '', chapterId: '', status: '', type: 'CHAPTER'}, portal: 'CHAPTER'};

  /* ---------------- small UI helpers ---------------- */
  var toastT;
  function toast(msg, ms) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3500); }
  function modal(html, color) {
    closeModal();
    var m = document.createElement('div'); m.className = 'modal'; m.id = 'modal';
    m.innerHTML = '<div class="box" role="dialog" aria-modal="true" style="--bc:' + (color || 'var(--primary)') + '">' + html + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
    document.body.appendChild(m);
    var f = m.querySelector('textarea, input, button.primary, button'); if (f) f.focus();
    return m;
  }
  function closeModal() { var m = $('#modal'); if (m) m.remove(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  function main(html) { $('#main').innerHTML = html; window.scrollTo(0, 0); }
  function loading(msg) { main('<p class="loading"><span class="spinner"></span> ' + esc(msg || 'Loading…') + '</p>'); }
  function errBox(e, retry) { main('<div class="empty"><h2>Could not load this page</h2><p class="muted">' + esc(e.message || 'Please try again.') + '</p>' + (retry ? '<button class="btn primary" data-act="retry">Try again</button>' : '') + '</div>'); }
  function chip(status, label) { return '<span class="chip ' + esc(status) + '">' + esc(label || C.STATUS_LABEL[status] || status) + '</span>'; }
  function fmtStamp(s) { if (!s) return ''; var d = C.fmtDate(String(s).slice(0, 10)), t = String(s).slice(11, 16); return d + (t ? ', ' + t : ''); }
  function busy(btn, on, text) { if (!btn) return; if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + esc(text || 'Please wait…'); } else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; } }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }

  /* ---------------- header ---------------- */
  function renderHeader() {
    var u = S.user, m = $('#menu');
    if (!u || u.mustChangePassword) { m.innerHTML = installBtn(); return; }
    var who = u.role === 'CHAPTER' ? u.chapterName + ' Chapter' : 'National Office';
    m.innerHTML = '<span class="who-name">' + esc(who) + '<small>' + esc(u.name || u.loginId) + '</small></span>' + installBtn() +
      '<button class="btn sm" data-act="home">Home</button><button class="btn sm" data-act="password">Password</button><button class="btn sm" data-act="logout">Logout</button>';
  }
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; renderHeader(); });
  function installBtn() { return installEvt ? '<button class="btn sm" data-act="install">Install app</button>' : ''; }

  /* ---------------- routing ---------------- */
  API.onExpired = function (msg) { S.user = null; API.setToken(''); S.flash = msg; renderHeader(); if (!/^#\/login/.test(location.hash)) go('#/login'); else renderLogin(); };
  window.addEventListener('hashchange', route);
  async function route() {
    closeModal();
    await leaveForm();
    var parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    renderHeader();
    if (!S.user) return renderLogin();
    if (S.user.mustChangePassword) return renderPassword(true);
    var nat = S.user.role === 'NATIONAL';
    switch (parts[0]) {
      case 'password': return renderPassword(false);
      case 'select': return renderSelect();
      case 'chapter': return nat ? go('#/national') : renderChapterHome(parts[1]);
      case 'cpr': return nat ? go('#/national') : openForm(parts[1], parseInt(parts[2], 10));
      case 'report': return openReport(parts[1]);
      case 'national': return nat ? renderNational() : go('#/chapter');
      default: return go('#/select');
    }
  }
  async function boot() {
    if (API.token()) {
      try { var r = await API.call('auth.me'); S.user = r.user; S.config = r.config; }
      catch (e) { if (e.code === 'OFFLINE') S.flash = e.message; else API.setToken(''); }
    }
    route();
  }

  /* ======================================================================
     LOGIN & PASSWORD
     ====================================================================== */
  function renderLogin() {
    S.screen = 'login';
    var p = S.portal;
    main('<form class="auth" id="loginForm" novalidate>' +
      '<div class="logo"><span class="mark" aria-hidden="true">FTS</span><div><h1>Chapter Performance Report</h1><div class="org">Friends of Tribals Society</div></div></div>' +
      (S.flash ? '<p class="formerr" role="alert">' + esc(S.flash) + '</p>' : '') +
      '<div class="seg" role="group" aria-label="Login as"><button type="button" data-portal="CHAPTER" aria-pressed="' + (p === 'CHAPTER') + '">Chapter</button><button type="button" data-portal="NATIONAL" aria-pressed="' + (p === 'NATIONAL') + '">National Office</button></div>' +
      '<label class="fld"><span class="lbl">' + (p === 'CHAPTER' ? 'Chapter Login ID' : 'Login ID') + '</span><input class="in" id="lgId" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
      '<label class="fld"><span class="lbl">Password</span><span class="pwwrap"><input class="in" id="lgPw" type="password" autocomplete="current-password" required><button type="button" data-act="showpw" aria-label="Show password">Show</button></span></label>' +
      '<button class="btn primary" type="submit" id="lgBtn">Login</button>' +
      '<p class="note">Forgot your password? Ask the National Office to reset it.</p></form>');
    S.flash = '';
    $('#lgId').focus();
  }
  async function doLogin(e) {
    e.preventDefault();
    var id = $('#lgId').value.trim(), pw = $('#lgPw').value, btn = $('#lgBtn'), old = $('.formerr');
    if (old) old.remove();
    if (!id || !pw) return showFormErr('#loginForm', 'Enter your Login ID and Password.');
    busy(btn, true, 'Logging in…');
    try {
      var r = await API.call('auth.login', {loginId: id, password: pw, portal: S.portal});
      API.setToken(r.token); S.user = r.user; S.config = r.config;
      go(r.user.mustChangePassword ? '#/password' : '#/select');
    } catch (err) { busy(btn, false); showFormErr('#loginForm', err.message); $('#lgPw').value = ''; $('#lgPw').focus(); }
  }
  function showFormErr(sel, msg) { var f = $(sel), p = document.createElement('p'); p.className = 'formerr'; p.setAttribute('role', 'alert'); p.textContent = msg; var o = $('.formerr', f); if (o) o.remove(); f.insertBefore(p, f.querySelector('.seg') || f.querySelector('.fld')); }

  function renderPassword(forced) {
    S.screen = 'password';
    main('<form class="auth" id="pwForm" novalidate><h1>' + (forced ? 'Set your own password' : 'Change password') + '</h1>' +
      '<p class="org">' + (forced ? 'Welcome, ' + esc(S.user.name || S.user.loginId) + '. Before you start, replace the temporary password with one only you know.' : 'Use at least 8 characters with letters and numbers.') + '</p>' +
      '<label class="fld"><span class="lbl">' + (forced ? 'Temporary password' : 'Current password') + '</span><input class="in" id="pwCur" type="password" autocomplete="current-password"></label>' +
      '<label class="fld"><span class="lbl">New password</span><input class="in" id="pwNew" type="password" autocomplete="new-password"></label>' +
      '<label class="fld"><span class="lbl">Type the new password again</span><input class="in" id="pwNew2" type="password" autocomplete="new-password"></label>' +
      '<button class="btn primary" id="pwBtn" type="submit">Save password</button>' +
      (forced ? '' : '<p class="note"><a href="#/select">Cancel</a></p>') + '</form>');
    $('#pwCur').focus();
  }
  async function doPassword(e) {
    e.preventDefault();
    var cur = $('#pwCur').value, n1 = $('#pwNew').value, n2 = $('#pwNew2').value, btn = $('#pwBtn');
    if (!cur || !n1) return showFormErr('#pwForm', 'Fill in all three boxes.');
    if (n1 !== n2) return showFormErr('#pwForm', 'The two new passwords do not match.');
    busy(btn, true, 'Saving…');
    try { var r = await API.call('auth.changePassword', {currentPassword: cur, newPassword: n1}); S.user = r.user; toast('Password changed.'); go('#/select'); }
    catch (err) { busy(btn, false); showFormErr('#pwForm', err.message); }
  }

  /* ======================================================================
     REPORT TYPE SELECTION
     ====================================================================== */
  function renderSelect() {
    S.screen = 'select';
    var colors = {CHAPTER: 'var(--sA)', MAHILA: 'var(--sD)', YUVA: 'var(--sB)'};
    var desc = {CHAPTER: 'Monthly CPR of the chapter: membership, donations, CSR, Seva Patra, investments, Van Yatra, events and Anchal disbursement.', MAHILA: 'Monthly report of the Mahila Samiti.', YUVA: 'Monthly report of the Yuva Samiti.'};
    main('<div class="select-wrap"><h1>FTS Chapter Performance Report</h1><p class="muted">' + (S.user.role === 'CHAPTER' ? esc(S.user.chapterName) + ' Chapter. ' : 'National Office. ') + 'Select report:</p><div class="types">' +
      C.REPORT_TYPES.map(function (t) {
        return '<button class="type" style="--tc:' + colors[t.id] + '" ' + (t.active ? 'data-type="' + t.id + '"' : 'disabled aria-disabled="true"') + '><b>' + esc(t.label) + '</b><span>' + esc(desc[t.id]) + '</span>' +
          (t.active ? '<span class="go">Open</span>' : '<span class="soon">Coming Soon</span>') + '</button>';
      }).join('') + '</div></div>');
  }

  /* ======================================================================
     CHAPTER HOME
     ====================================================================== */
  async function renderChapterHome(fy) {
    S.screen = 'chapterHome'; loading('Loading your CPRs…');
    try { S.home = await API.call('chapter.dashboard', {fy: fy || ''}); } catch (e) { return errBox(e, true); }
    var h = S.home, c = h.counts, due = h.due;
    var dueAct = !due.inList ? '' : due.status === 'NOT_STARTED' ? '<button class="btn primary" data-open-cpr="' + due.fy + '/' + due.monthNo + '">Start ' + esc(due.label) + ' CPR</button>' :
      C.EDITABLE.indexOf(due.status) >= 0 ? '<button class="btn primary" data-open-cpr="' + due.fy + '/' + due.monthNo + '">Continue ' + esc(due.label) + ' CPR</button>' :
      '<button class="btn" data-open-report="' + esc(C.reportId(h.chapter.id, due.fy, due.monthNo, 'CHAPTER')) + '">View ' + esc(due.label) + ' CPR</button>';
    var card = function (cc, v, l) { return '<div class="card" style="--cc:' + cc + '"><div class="cv">' + v + '</div><div class="clbl">' + l + '</div></div>'; };
    var fyOpts = h.financialYears.map(function (y) { return '<option ' + (y === h.fy ? 'selected' : '') + '>' + y + '</option>'; }).join('');
    var rows = h.months.map(function (m) {
      var st = m.isFuture ? 'FUTURE' : (m.overdue ? 'OVERDUE' : m.status);
      var lbl = m.isFuture ? 'Opens in ' + C.monthName(m.monthNo) : (m.overdue ? 'Pending' : m.statusLabel);
      var act = '';
      if (!m.isFuture) {
        if (m.status === 'NOT_STARTED') act = '<button class="btn sm" data-open-cpr="' + h.fy + '/' + m.monthNo + '">Start</button>';
        else if (C.EDITABLE.indexOf(m.status) >= 0) act = '<button class="btn sm primary" data-open-cpr="' + h.fy + '/' + m.monthNo + '">' + (m.status === 'CORRECTION_REQUIRED' ? 'Correct' : 'Continue') + '</button>';
        else act = '<button class="btn sm" data-open-report="' + esc(m.reportId) + '">' + (m.status === 'AWAITING_SIGNED_CPR' ? 'Upload signed CPR' : 'View') + '</button>';
      }
      return '<tr class="' + (m.isFuture ? 'future' : '') + '"><td><b>' + esc(m.label) + '</b>' + (m.isDue ? ' <span class="muted">(due now)</span>' : '') + '</td><td>' + chip(st, lbl) + (m.remarks && m.status === 'CORRECTION_REQUIRED' ? '<div class="muted" style="font-size:.85rem">' + esc(m.remarks) + '</div>' : '') + '</td><td>' + esc(fmtStamp(m.submittedOn)) + '</td><td>' + esc(fmtStamp(m.signedOn)) + '</td><td class="rowact">' + act + '</td></tr>';
    }).join('');
    main('<div class="crumb"><a href="#/select">Reports</a> › Chapter CPR</div>' +
      '<div class="dhead"><div><h1>' + esc(h.chapter.name) + ' Chapter</h1><p class="muted">Financial Year ' + esc(h.fy) + (h.chapter.zone ? ', ' + esc(h.chapter.zone) + ' zone' : '') + '. Current month: ' + esc(C.periodLabel(C.fyOfPeriod(h.currentPeriod), +h.currentPeriod.slice(5))) + '.</p></div>' +
      '<label class="fld" style="min-width:140px"><span class="lbl">Financial Year</span><select class="in" id="homeFy">' + fyOpts + '</select></label></div>' +
      (due.inList ? '<div class="duebox"><div><h2>' + esc(due.label) + ' CPR</h2><p class="muted" style="margin:0">Status: ' + chip(due.status) + '</p></div>' + dueAct + '</div>' : '') +
      '<div class="cards">' + card('var(--warn)', c.draft + c.correction, 'Draft CPRs' + (c.correction ? ' (' + c.correction + ' to correct)' : '')) + card('#1D4F86', c.submitted, 'Submitted CPRs') + card('#0B6B5F', c.signed, 'Signed CPRs') + card('var(--ok)', c.verified, 'Verified') + card('var(--bad)', c.pending, 'Pending CPRs') + '</div>' +
      '<section class="panel"><div class="ph"><h2>Months in ' + esc(h.fy) + '</h2></div><div class="wrap"><table class="tbl months"><thead><tr><th>Month</th><th>Status</th><th>Submitted on</th><th>Signed CPR uploaded</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<section class="panel"><h2>Open a CPR for another month</h2><div class="pick" style="margin-top:10px"><label class="fld"><span class="lbl">Financial Year</span><select class="in" id="pickFy">' + fyOpts + '</select></label>' +
      '<label class="fld"><span class="lbl">Month</span><select class="in" id="pickMonth">' + C.FY_MONTH_NOS.map(function (m) { return '<option value="' + m + '">' + C.monthName(m) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn" data-act="pickOpen">Open CPR</button></div></section>');
  }

  /* ======================================================================
     CPR FORM
     ====================================================================== */
  var FT = {}; C.FIELDS.forEach(function (f) { FT[f.key] = f; });
  function LST() { var l = (S.config && S.config.lists) || {}; return {cpp: l.cpp || [], anchal: l.anchal || [], event: l.event || [], sub: l.sub || []}; }
  function isReq(k) { var f = FT[k]; return f && f.req === 'yes'; }
  function rangeFor(kind) {
    var m = S.form.meta, first = m.period + '-01', last = C.lastDay(m.period);
    return kind === 'ytd' ? {min: C.fyStart(m.fy) + '-04-01', max: last} : {min: first, max: last};
  }
  function tillLabel() { return 'Till Date (' + C.tillRange(S.form.meta.fy, S.form.meta.monthNo) + ')'; }
  function selHtml(k, label, list, cur, o) {
    o = o || {};
    var opts = '<option value="">Choose</option>' + list.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
    if (has(cur) && list.indexOf(cur) < 0) opts += '<option value="' + esc(cur) + '">' + esc(cur) + ' (not in list)</option>';
    return '<select class="in" data-k="' + k + '" aria-label="' + esc(label) + '"' + (list.length ? '' : ' disabled') + '>' + opts + '</select>';
  }
  function ctl(kind, k, label, o) {
    o = o || {};
    var al = 'aria-label="' + esc(label) + '"';
    if (kind === 'int') return '<input class="in num" data-k="' + k + '" type="text" inputmode="numeric" autocomplete="off" ' + al + '>';
    if (kind === 'amount' || kind === 'number') return '<input class="in num" data-k="' + k + '" type="text" inputmode="decimal" autocomplete="off" ' + al + '>';
    if (kind === 'text') return '<input class="in" data-k="' + k + '" type="text" autocomplete="off" maxlength="' + (o.max || 200) + '" ' + al + '>';
    if (kind === 'date') return '<input class="in" data-k="' + k + '" type="date"' + (o.min ? ' min="' + o.min + '"' : '') + (o.max ? ' max="' + o.max + '"' : '') + ' ' + al + '><small class="dhint"></small>';
    if (kind === 'textarea') return '<textarea class="in" data-k="' + k + '" rows="' + (o.rows || 3) + '" maxlength="' + (o.max || 2000) + '" ' + al + '></textarea>';
    if (kind === 'calc') return '<output class="calc" data-c="' + k + '" ' + al + '></output>';
    if (kind === 'dlist') return selHtml(k, label, o.list || [], getP(S.form.data, k), o);
    if (kind === 'enum' || kind === 'month') return '<select class="in" data-k="' + k + '" ' + al + '><option value="">Choose</option>' + o.opts.map(function (x) { return Array.isArray(x) ? '<option value="' + esc(x[0]) + '">' + esc(x[1]) + '</option>' : '<option>' + esc(x) + '</option>'; }).join('') + '</select>';
    if (kind === 'choice') return '<div class="yn choice" role="radiogroup" ' + al + ' data-yn="' + k + '">' + o.opts.map(function (x) { return '<button type="button" role="radio" data-v="' + esc(x) + '" aria-pressed="false">' + esc(x) + '</button>'; }).join('') + '</div>';
    if (kind === 'yesno') return '<div class="yn" role="radiogroup" ' + al + ' data-yn="' + k + '"><button type="button" role="radio" data-v="yes" aria-pressed="false">Yes</button><button type="button" role="radio" data-v="no" aria-pressed="false">No</button></div>';
    return '';
  }
  function typeOf(k) { var f = FT[k]; return f ? (f.calc ? (f.calc === 'carry' ? f.type : 'calc') : f.type) : 'text'; }
  function F(k, label, o) {
    o = o || {}; var kind = o.kind || typeOf(k);
    var empty = kind === 'dlist' && !(o.list || []).length ? '<small class="muted">The list is empty. Ask the National Office to add it.</small>' : '';
    return '<label class="fld' + (o.full ? ' full' : '') + (o.wide ? ' wide' : '') + '"' + (o.if ? ' data-if="' + o.if + '"' : '') + '><span class="lbl">' + esc(label) + (o.req || isReq(k) ? R : '') + '</span>' + ctl(kind, k, label, o) + empty + '</label>';
  }
  function checksHtml(path, options, label, req, cls) {
    var cur = getP(S.form.data, path) || [], all = options.concat(cur.filter(function (x) { return options.indexOf(x) < 0; }));
    return '<div class="fld full ' + (cls || '') + '"><span class="lbl">' + esc(label) + (req ? R : '') + '</span><div class="checks" data-multi="' + path + '">' +
      all.map(function (a) { return '<label class="chk2"><input type="checkbox" data-multi="' + path + '" data-opt="' + esc(a) + '"> ' + esc(a) + (options.indexOf(a) < 0 ? ' (not in list)' : '') + '</label>'; }).join('') + '</div></div>';
  }
  function cell(k, label, kind) { var short = label.split(': ').pop(); return '<div class="cell"><span class="cl">' + esc(short.charAt(0).toUpperCase() + short.slice(1)) + '</span>' + ctl(kind || typeOf(k), k, label) + '</div>'; }
  function gtable(cols, rows, cls) {
    var tpl = cols.map(function (c) { return c.w || 'minmax(0,1fr)'; }).join(' ');
    return '<div class="gt ' + (cls || '') + '" style="--cols:' + tpl + '"><div class="gt-head" aria-hidden="true">' + cols.map(function (c) { return '<div><span>' + c.h + '</span></div>'; }).join('') + '</div>' +
      rows.map(function (r) { return '<div class="gt-row ' + (r.cls || '') + '"><div class="rh"><span>' + r.l + '</span></div>' + r.cells.join('') + '</div>'; }).join('') + '</div>';
  }
  var SECCOL = {}; C.SECTIONS.forEach(function (s) { SECCOL[s.id] = s; });
  function sec(id, title, body) { var s = SECCOL[id]; return '<section class="sec" id="sec-' + id + '" style="--sc:' + s.c + '"><h2 class="band">' + (s.l ? '<span class="lt">' + s.l + '</span>' : '') + '<span>' + title + '</span></h2><div class="sec-body">' + body + '</div></section>'; }

  function formHtml() {
    var f = S.form, m = f.meta, fy = m.fy, y31 = C.fyStart(fy), till = tillLabel(), lst = LST(), locked = !!S.config.chapterLocked;
    var chOpts = (S.config.chapters || []).map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === m.chapterId ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    var y0 = +m.period.slice(0, 4), m0 = +m.period.slice(5, 7);
    var yearOpts = (S.config.reportYears && S.config.reportYears.length ? S.config.reportYears : [y0]).map(function (y) { return '<option' + (y === y0 ? ' selected' : '') + '>' + y + '</option>'; }).join('');
    var monthOpts = C.MONTHS.map(function (n, ix) { return '<option value="' + (ix + 1) + '"' + (ix + 1 === m0 ? ' selected' : '') + '>' + n + '</option>'; }).join('');
    var basics = '<section class="sec sec-hdr" id="sec-hdr"><div class="sec-body"><div class="grid4">' +
      '<label class="fld"><span class="lbl">Chapter Name' + R + '</span><select class="in' + (locked ? ' carry' : '') + '" id="fChapter" ' + (locked ? 'disabled' : '') + '><option value="">Choose chapter</option>' + chOpts + '</select>' + (locked ? '<small class="muted">Set by your login</small>' : '') + '</label>' +
      '<div class="fld"><span class="lbl">For the Month Of</span><span class="ym"><select class="in" id="fYear" aria-label="Year">' + yearOpts + '</select><select class="in" id="fMonth" aria-label="Month">' + monthOpts + '</select></span><small class="muted">FY ' + esc(fy) + '</small></div>' +
      '<label class="fld"><span class="lbl">Name of CPP' + R + '</span><input class="in" data-k="cppName" type="text" maxlength="100" autocomplete="off" aria-label="Name of CPP"></label>' +
      F('submissionDate', 'Submission Date', {kind: 'date', req: 1, min: m.period + '-01', max: S.config.today || nowStamp().slice(0, 10)}) + '</div></div></section>';
    var memRow = function (r) {
      var p = 'mem.' + r[0] + '.';
      return {l: r[1], cells: [cell(p + 'opening', r[1] + ': members as on 31st March'), cell(p + 'new', r[1] + ': new members during the month'), cell(p + 'total', r[1] + ': total members till month end'),
        cell(p + 'paidCount', r[1] + ': membership amount received, no. of members'), cell(p + 'paidAmt', r[1] + ': amount received ₹'), cell(p + 'remarks', r[1] + ': remarks / break-up')]};
    };
    var TOTL = {opening: 'TOTAL: members as on 31st March', new: 'TOTAL: new members during the month', total: 'TOTAL: total members till month end', paidCount: 'TOTAL: membership amount received, no. of members', paidAmt: 'TOTAL: amount received ₹'};
    var A = sec('A', 'Membership Data', '<div class="wrap">' + gtable(
      [{h: 'Particulars', w: 'minmax(110px,1.1fr)'}, {h: 'Members as on 31st March ' + y31}, {h: 'During the Month (New Members)' + R}, {h: 'Total Members (Till Month End ' + fy + ')'}, {h: 'Membership Amt Received: No. of Members'}, {h: 'Membership Amt Received: Amount ₹'}, {h: 'Remarks / Break-up', w: 'minmax(120px,1.4fr)'}],
      C.MEM_ROWS.map(memRow).concat([{l: 'TOTAL', cls: 'total', cells: ['opening', 'new', 'total', 'paidCount', 'paidAmt'].map(function (c) { return cell('memT.' + c, TOTL[c], 'calc'); }).concat('<div class="cell"></div>')}]), 'keep') + '</div>' +
      '<p class="note">Enter 0 where there were no new members. Total members adds this month’s new members to last month’s total.</p>');
    var B = sec('B', 'Executive Committee Meeting Details',
      '<label class="chk"><input type="checkbox" data-k="ec.none"> No Executive Committee Meeting was held this month</label>' +
      '<div data-if="!ec.none"><div id="meetList"></div><button type="button" class="btn" data-add="meetings">+ Add Meeting</button><p class="note">Held more than one meeting this month? Click “Add Meeting” again. Each meeting has its own details.</p></div>' +
      '<div data-if="ec.none">' + F('ec.reason', 'Reason no meeting was held', {req: 1}) + '</div>');
    var pair = function (l, a, b) { return {l: l, cells: [cell(a, l + ': this month'), cell(b, l + ': till date')]}; };
    var Cs = sec('C', 'OTS Details &amp; Collection',
      '<h3 class="subh">OTS Details</h3><div class="grid">' + F('ots.prp', 'OTS PRP') + '</div>' +
      '<p class="note" style="margin:4px 0 12px">OTS PRP is filled only once. After you save it, it is locked in every later month’s CPR. If it needs correcting, please ask the National Office.</p>' +
      '<h3 class="subh">OTS Collection</h3><p class="note" style="margin:0 0 8px"><b>Till Date</b> means ' + esc(C.tillRange(fy, m.monthNo)) + '.</p>' +
      gtable([{h: 'Particulars', w: 'minmax(140px,1.3fr)'}, {h: 'During the Month' + R}, {h: till}], [
        {l: 'Total Number of OTS', cells: [cell('ots.monthCount', 'Total Number of OTS: During the Month'), cell('ots.ytdCount', 'Total Number of OTS: Till Date')]},
        {l: 'Amount Received (₹)', cells: [cell('ots.monthAmt', 'Amount Received: During the Month'), cell('ots.ytdAmt', 'Amount Received: Till Date')]}]));
    var D = sec('D', 'Donation &amp; CSR Details',
      '<p class="note" style="margin:0 0 8px">Enter each donor and fund once; Total adds up by itself. “Till Date” means ' + esc(C.tillRange(fy, m.monthNo)) + '.</p>' +
      gtable([{h: 'Particulars', w: 'minmax(100px,0.9fr)'}, {h: 'Number of Donors'}, {h: 'Fund Received – This Month (₹)'}, {h: 'Fund Received – Till Date (₹)'}], [
        {l: 'Non-CSR', cells: [cell('donors.nonCsr', 'Non-CSR: number of donors'), cell('fund.nonCsrMonth', 'Non-CSR: fund received this month'), cell('fund.nonCsrYtd', 'Non-CSR: fund received till date')]},
        {l: 'CSR', cells: [cell('donors.csr', 'CSR: number of donors'), cell('csr.fundMonth', 'CSR: fund received this month'), cell('csr.fundYtd', 'CSR: fund received till date')]},
        {l: 'Total', cls: 'total', cells: [cell('donors.total', 'Total: number of donors', 'calc'), cell('fund.totalMonth', 'Total: fund received this month', 'calc'), cell('fund.totalYtd', 'Total: fund received till date', 'calc')]}]) +
      '<div class="grid" style="margin-top:12px">' + F('csr.schools', 'Number of CSR Schools') + '</div>' +
      '<h3 class="subh">Other Donation Detail</h3>' + gtable([{h: 'Particulars', w: 'minmax(140px,1.3fr)'}, {h: 'This Month (₹)'}, {h: 'Till Date (₹)'}], [pair('General Donation', 'seva.genMonth', 'seva.genYtd'), pair('One Child Education', 'seva.oceMonth', 'seva.oceYtd')]));
    var E = sec('E', 'Sevapatra Boxes', gtable([{h: 'Particulars', w: 'minmax(140px,1.3fr)'}, {h: 'This Month'}, {h: 'Till Date'}],
      [pair('Boxes Placed', 'seva.boxesMonth', 'seva.boxesYtd'), pair('Amount Collected (₹)', 'seva.amtMonth', 'seva.amtYtd')]));
    var Fs = sec('F', 'Investment (As on Date)', '<div class="grid">' + F('invest.fd', 'Fixed Deposit (FD) ₹') + F('invest.rec', 'Recurring Investment ₹') + F('invest.oth', 'Others ₹') + F('invest.othNote', 'Others (Please Specify)') +
      '<div class="fld"><span class="lbl">TOTAL</span><output class="calc" data-c="invest.total"></output></div>' + F('invest.bank', 'Bank Balance in Account as on Date ₹', {req: 1}) + '</div>');
    var G = sec('G', 'Vanyatra',
      '<div class="grid"><div class="fld"><span class="lbl">Number of Vanyatra – This Month</span><output class="calc" data-c="vy.monthCount"></output><small class="muted">Counted from the entries below</small></div>' +
      F('vy.ytdCount', 'Number of Vanyatra – ' + till) + '</div>' +
      '<h3 class="subh">Vanyatra Details</h3><div id="vyList"></div><button type="button" class="btn" data-add="vanyatras">+ Add Vanyatra</button>');
    var maxP = S.config.photosMax || 4, minP = S.config.photosMin == null ? 2 : S.config.photosMin;
    var EV = sec('EV', 'Events During the Month', '<div id="evList"></div><button type="button" class="btn" data-add="events">+ Add Event</button>' +
      '<p class="note">Upload ' + minP + '–' + maxP + ' photographs for each event (JPG, PNG or WEBP). Save the draft once, then add photographs.</p>');
    var X1 = sec('X1', 'Annexure 1 – Disbursement to Anchal', '<div id="x1List"></div><div class="totals" id="x1Tot"></div><button type="button" class="btn" data-add="anchals">+ Add Anchal</button>' +
      '<p class="note">Choose Anchal names from the list. “Total Remittance till Last Date” is filled from last month’s CPR.</p>');
    var board = function (b, l) { return {l: l, cells: [cell('checks.' + b + '.total', l + ': total donor boards'), cell('checks.' + b + '.sent', l + ': already sent'), cell('checks.' + b + '.pending', l + ': pending', 'calc'), cell('checks.' + b + '.reason', l + ': reason / remarks')]}; };
    var X2 = sec('X2', 'Annexure 2 – Monthly Summary / Check Points',
      '<div class="qrow"><span class="q">Samagri reached to all schools' + R + '</span>' + ctl('yesno', 'checks.samagri.v', 'Samagri reached to all schools') +
      '<div data-if="checks.samagri.v=no">' + ctl('text', 'checks.samagri.reason', 'Reason / Remarks (if No)') + '</div></div>' +
      '<h3 class="subh">Donor Board Details</h3>' + gtable([{h: 'Particulars', w: 'minmax(140px,1.3fr)'}, {h: 'Total Donor Boards'}, {h: 'Already Sent'}, {h: 'Pending'}, {h: 'Reason / Remarks', w: 'minmax(0,1.5fr)'}], [board('db', 'Donor Board reached to all schools'), board('cb', 'CSR Donor Board reached to all schools')]) +
      '<div class="qrow" style="margin-top:12px"><span class="q">School Progress Report sent to CSR Donors</span>' + ctl('yesno', 'checks.pr.v', 'School Progress Report sent to CSR Donors') +
      '<div><div data-if="checks.pr.v=yes">' + ctl('date', 'checks.pr.date', 'Date sent') + '</div><div data-if="checks.pr.v=no">' + ctl('text', 'checks.pr.reason', 'Reason / Remarks') + '</div></div></div>' +
      '<h3 class="subh">Details of Sub Chapter</h3><div id="subList"></div><div id="subAdd"></div>' +
      '<div class="grid" style="margin-top:14px" id="monitor"></div>');
    var toc = C.SECTIONS.map(function (s) { return '<a href="#" data-jumpsec="sec-' + s.id + '" style="--sc:' + s.c + '"><b>' + s.l + '</b><span>' + esc(s.t.replace('Annexure ', 'Annex ').replace('&', '&amp;')) + '</span></a>'; }).join('');
    var corr = m.status === 'CORRECTION_REQUIRED' ? '<div class="banner-bad"><b>Returned by the National Office for correction</b>' + esc(m.remarks || '') + '</div>' : '';
    return '<div class="crumb no-print"><a href="#/chapter/' + esc(fy) + '">' + esc(m.chapterName || 'Your') + ' CPRs</a> › ' + esc(C.periodLabel(fy, m.monthNo)) + '</div>' +
      '<form id="cprForm" class="formwrap" novalidate><nav class="toc no-print" aria-label="Sections">' + toc + '</nav><div class="formcol">' +
      '<div class="ftitle"><h1>Chapter Performance Report</h1><p class="status" id="fstatus"></p></div>' + corr + '<div id="restoreSlot"></div>' +
      '<div class="legend"><span><i class="sw fill"></i>You fill</span><span><i class="sw calc"></i>Fills itself from your entries and last month’s CPR</span><span><i class="req">*</i>Needed to submit</span></div>' +
      basics + A + B + Cs + D + E + Fs + G + EV + X1 + X2 +
      '<div class="actbar no-print"><span class="savehint" id="savehint"></span><span class="sp"></span><button type="button" class="btn" data-act="saveDraft">Save Draft</button><button type="button" class="btn primary" data-act="submit">Submit CPR</button></div>' +
      '</div></form>';
  }
  function meetRows() {
    var L = S.form.data.meetings, r = rangeFor('m');
    if (!L.length) return '<p class="muted">No meeting added yet. Click “Add Meeting”.</p>';
    return L.map(function (m, i) {
      var p = 'meetings.' + i + '.';
      return '<div class="rcard" style="--sc:var(--sB)"><div class="rcard-h"><b>Meeting ' + (i + 1) + (m.committee ? ' – ' + esc(m.committee) : '') + '</b><button type="button" class="btn ghost sm" data-del="meetings" data-i="' + i + '">Remove meeting</button></div><div class="grid">' +
        F(p + 'committee', 'Meeting of', {kind: 'enum', opts: C.JOINT_GROUPS, req: 1}) + F(p + 'date', 'Executive Committee Meeting Date', {kind: 'date', req: 1, min: r.min, max: r.max}) +
        F(p + 'expected', 'Expected Members', {kind: 'int', req: 1}) + F(p + 'attended', 'Members Attended', {kind: 'int', req: 1}) +
        F(p + 'agenda', 'Key Agenda Points Discussed', {kind: 'textarea', full: 1, rows: 3}) + F(p + 'outcome', 'Outcome (If Any)', {kind: 'textarea', full: 1, rows: 2}) + '</div></div>';
    }).join('');
  }
  /* repeatable entries with Save / Done / Cancel: an entry is either open (editing) or closed (one-line summary) */
  var openRows = new WeakMap();
  function isOpen(row) { return openRows.has(row); }
  function openRow(row, isNew) { if (!openRows.has(row)) openRows.set(row, {snap: isNew ? null : JSON.stringify(row)}); }
  function cardHtml(g, i, row, color, title, body, summary, missing) {
    if (!isOpen(row)) return '<div class="rcard compact" style="--sc:' + color + '"><div class="rcard-h"><div><b>' + title + '</b> <span class="sum">' + (summary || '') + '</span>' + (missing ? ' <span class="chip DRAFT">Details missing</span>' : '') + '</div><span class="acts"><button type="button" class="btn sm" data-rowedit="' + g + '" data-i="' + i + '">Edit</button><button type="button" class="btn ghost sm" data-del="' + g + '" data-i="' + i + '">Remove</button></span></div></div>';
    return '<div class="rcard" style="--sc:' + color + '"><div class="rcard-h"><b>' + title + '</b></div>' + body +
      '<div class="rowacts"><button type="button" class="btn sm" data-rowsave="' + g + '" data-i="' + i + '">Save</button><button type="button" class="btn sm primary" data-rowdone="' + g + '" data-i="' + i + '">Done</button><button type="button" class="btn sm ghost" data-rowcancel="' + g + '" data-i="' + i + '">Cancel</button></div></div>';
  }
  function thumbHtml(g, i, id, label) {
    return '<span class="th"><img data-thumb="' + esc(id) + '" alt="' + esc(label) + '"><span class="thb"><button type="button" class="linkbtn" data-replacephoto="' + i + '" data-group="' + g + '" data-file="' + esc(id) + '">Replace</button><button type="button" class="linkbtn" data-delphoto="' + i + '" data-group="' + g + '" data-file="' + esc(id) + '">Remove</button></span></span>';
  }
  function vyRows() {
    var L = S.form.data.vanyatras, r = rangeFor('m'), min = S.config.vyPhotosMin == null ? 2 : S.config.vyPhotosMin, max = S.config.vyPhotosMax || 2;
    if (!L.length) return '<p class="muted">No Vanyatra added. Click “+ Add Vanyatra”.</p>';
    return L.map(function (v, i) {
      var p = 'vanyatras.' + i + '.', ids = v.photoIds || [], slots = '';
      for (var k = 0; k < max; k++) slots += '<div class="slot"><span class="lbl">Photo ' + (k + 1) + (k < min ? R : '') + '</span>' + (ids[k] ? thumbHtml('vanyatras', i, ids[k], 'Vanyatra ' + (i + 1) + ' photo ' + (k + 1)) : '<button type="button" class="btn sm" data-addphoto="' + i + '" data-group="vanyatras">Upload photo ' + (k + 1) + '</button>') + '</div>';
      var body = '<div class="grid">' + F(p + 'by', 'Conducted By', {kind: 'enum', opts: C.VY_BY, req: 1}) + F(p + 'date', 'Date', {kind: 'date', req: 1, min: r.min, max: r.max}) +
        F(p + 'place', 'Where / Location Visited', {kind: 'text', req: 1, wide: 1}) + F(p + 'days', 'Number of Days', {kind: 'int', req: 1}) +
        '<div class="photos" data-photos-g="vanyatras" data-photos="' + i + '"><div class="phhead"><span class="lbl">Photos</span> <span class="muted">Upload at least ' + min + ' photos (JPG, PNG or WEBP)</span></div><div class="slots">' + slots + '</div></div></div>';
      var sum = [C.fmtDate(v.date), v.place, has(v.days) ? v.days + ' day' + (num(v.days) === 1 ? '' : 's') : '', v.by, ids.length + ' photo' + (ids.length === 1 ? '' : 's')].filter(Boolean).map(esc).join(' · ');
      return cardHtml('vanyatras', i, v, 'var(--sG)', 'Vanyatra ' + (i + 1), body, sum, !v.by || !v.date || !v.place || !has(v.days) || ids.length < min);
    }).join('');
  }
  function photosHtml(e, i) {
    var maxP = S.config.photosMax || 4, minP = S.config.photosMin == null ? 2 : S.config.photosMin, ids = e.photoIds || [];
    return '<div class="photos" data-photos-g="events" data-photos="' + i + '"><div class="phhead"><span class="lbl">Photographs' + (minP ? R : '') + '</span> <span class="muted">Upload ' + minP + '–' + maxP + ' photographs (JPG, PNG or WEBP). ' + ids.length + ' of ' + maxP + ' uploaded.</span></div>' +
      '<div class="thumbs">' + ids.map(function (id, k) { return thumbHtml('events', i, id, 'Photograph ' + (k + 1) + ' of event ' + (i + 1)); }).join('') + '</div>' + (ids.length < maxP ? '<button type="button" class="btn sm" data-addphoto="' + i + '" data-group="events">Add photograph</button>' : '') + '</div>';
  }
  function evRows() {
    var L = S.form.data.events, r = rangeFor('m'), evl = LST().event.filter(function (x) { return x !== 'Other'; }).concat(['Other']);
    if (!L.length) return '<p class="muted">No events added yet.</p>';
    return L.map(function (e, i) {
      var p = 'events.' + i + '.';
      var minP = S.config.photosMin == null ? 2 : S.config.photosMin, sum = [C.fmtDate(e.date), C.eventName(e), C.eventBy(e), (e.photoIds || []).length + ' photos'].filter(Boolean).map(esc).join(' · ');
      var miss = !e.date || !e.by || !e.name || (e.name === 'Other' && !e.nameOther) || (e.by === 'Joint' && (e.jointWith || []).length < 2) || (e.photoIds || []).length < minP;
      return cardHtml('events', i, e, 'var(--sH)', 'Event ' + (i + 1), '<div class="grid">' +
        F(p + 'date', 'Event Date', {kind: 'date', req: 1, min: r.min, max: r.max}) + F(p + 'by', 'Conducted By', {kind: 'enum', opts: C.EVENT_BY, req: 1}) +
        checksHtml(p + 'jointWith', C.JOINT_GROUPS, 'Joint with (select two or more)', true, 'jointbox').replace('class="fld full jointbox"', 'class="fld full" data-if="' + p + 'by=Joint"') +
        F(p + 'name', 'Event Name', {kind: 'dlist', list: evl, req: 1, wide: 1}) + F(p + 'nameOther', 'Please Specify Event Name', {kind: 'text', req: 1, wide: 1, if: p + 'name=Other' + (S.config.eventSpecify || []).map(function (x) { return '||' + p + 'name=' + x; }).join('')}) +
        F(p + 'venue', 'Venue / Location', {kind: 'text'}) + F(p + 'participants', 'Number of Participants', {kind: 'int'}) +
        F(p + 'desc', 'Brief Description', {kind: 'textarea', full: 1}) + F(p + 'impact', 'Impact / Outcome', {kind: 'textarea', full: 1, rows: 2}) + photosHtml(e, i) + '</div>', sum, miss);
    }).join('');
  }
  function x1Rows() {
    var L = S.form.data.anchals, al = LST().anchal;
    if (!L.length) return '<p class="muted">No Anchal added yet. Click “Add Anchal”.</p>';
    var months = []; for (var k = 2; k >= -15; k--) { var pp = C.addMonthsToPeriod(S.form.meta.period, k); months.push([pp, C.fmtMonth(pp)]); }
    return L.map(function (a, i) {
      var p = 'anchals.' + i + '.';
      return '<div class="rcard" style="--sc:var(--sX)"><div class="rcard-h"><b>' + esc(a.name || 'Anchal ' + (i + 1)) + '</b><button type="button" class="btn ghost sm" data-del="anchals" data-i="' + i + '">Remove</button></div><div class="grid">' +
        F(p + 'name', 'Funding Anchal Name', {kind: 'dlist', list: al, req: 1}) + F(p + 'acharyas', 'No. of Acharyas Paid During this Month', {kind: 'int'}) + F(p + 'paidUpto', 'Up to Which Month Paid', {kind: 'month', opts: months}) +
        F(p + 'reportOn', 'Report When Received', {kind: 'date'}) + F(p + 'remitDate', 'Remittance Date', {kind: 'date'}) + F(p + 'tillLast', 'Total Remittance till Last Date ₹', {kind: 'amount'}) + F(p + 'remitMonth', 'Remittance This Month ₹', {kind: 'amount'}) +
        '<div class="subhead">As per PRP</div>' + F(p + 'prpName', 'Anchal Name', {kind: 'dlist', list: al}) + F(p + 'prpAcharyas', 'No. of Acharyas', {kind: 'int'}) + F(p + 'prpAmt', 'Amount (Rs.)', {kind: 'amount'}) + '</div></div>';
    }).join('');
  }
  /* Details of Sub Chapter: a plain table, as in the paper CPR. The chapter's own sub chapters are listed automatically. */
  function subRows() {
    var L = S.form.data.subs, sl = LST().sub;
    if (!L.length) return '<p class="muted">No sub chapters entered.</p>';
    return gtable([{h: 'Name of Sub Chapter' + R, w: 'minmax(0,1.6fr)'}, {h: 'No. of Members'}, {h: 'OTS Collected'}, {h: '', w: '90px'}],
      L.map(function (s, i) {
        var nameCtl = sl.length ? selHtml('subs.' + i + '.name', 'Name of Sub Chapter', sl, s.name) : '<input class="in" data-k="subs.' + i + '.name" type="text" maxlength="150" aria-label="Name of Sub Chapter">';
        return {l: nameCtl, cells: [cell('subs.' + i + '.members', 'No. of Members', 'int'), cell('subs.' + i + '.ots', 'OTS Collected', 'number'), '<div class="cell"><button type="button" class="btn ghost sm" data-del="subs" data-i="' + i + '">Remove</button></div>']};
      }));
  }
  function subAddHtml() {
    var note = !S.form.meta.chapterId ? '<p class="note">Choose the Chapter Name above to list its sub chapters.</p>' : '';
    return note + '<button type="button" class="btn sm" data-add="subs" style="margin-top:8px">+ Add Sub Chapter</button>';
  }
  /** Put a row for every sub chapter of this chapter (from the Lists tab), so the chapter only fills members and OTS. */
  function ensureSubs() {
    var d = S.form.data;
    LST().sub.forEach(function (n) { if (!d.subs.some(function (s) { return s.name === n; })) d.subs.push({name: n}); });
  }
  function monitorHtml() {
    var al = LST().anchal;
    return S.config.monitoringMulti ? checksHtml('monitoringAnchal', al, 'Monitoring Anchal Name (select all that apply)', false) : F('monitoringAnchal.0', 'Monitoring Anchal Name', {kind: 'dlist', list: al});
  }
  function updateDateHints() { $$('#cprForm input[type=date]').forEach(function (el) { var h = el.nextElementSibling; if (h && h.classList.contains('dhint')) h.textContent = el.value ? C.fmtDate(el.value) : ''; }); }

  var thumbCache = {};
  function loadThumbs() {
    $$('img[data-thumb]').forEach(function (img) {
      var id = img.dataset.thumb;
      if (thumbCache[id]) { img.src = thumbCache[id]; return; }
      if (img.dataset.loading) return; img.dataset.loading = '1';
      API.call('file.download', {fileId: id, offset: 0, thumb: true}).then(function (r) {
        if (!r.done) return;
        var bin = atob(r.data), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        thumbCache[id] = URL.createObjectURL(new Blob([arr], {type: r.mime}));
        $$('img[data-thumb="' + id + '"]').forEach(function (x) { x.src = thumbCache[id]; });
      }).catch(function () {});
    });
  }
  function renderLists() {
    $('#meetList').innerHTML = meetRows(); $('#vyList').innerHTML = vyRows(); $('#evList').innerHTML = evRows(); $('#x1List').innerHTML = x1Rows();
    $('#subList').innerHTML = subRows(); $('#subAdd').innerHTML = subAddHtml(); $('#monitor').innerHTML = monitorHtml();
    loadThumbs();
  }
  function rerender() { renderLists(); fillForm(); paint(); applyIfs(); }
  function ensureShape(d) {
    ['meetings', 'vanyatras', 'events', 'anchals', 'subs'].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    if (!Array.isArray(d.monitoringAnchal)) d.monitoringAnchal = [];
    if (!d.vy || typeof d.vy !== 'object') d.vy = {};
    d.events.forEach(function (e) { if (!Array.isArray(e.jointWith)) e.jointWith = []; });
    d.events.concat(d.vanyatras).forEach(function (e) { if (!Array.isArray(e.photoIds)) e.photoIds = []; if (!Array.isArray(e.photoUrls)) e.photoUrls = []; if (!e.eid) e.eid = newEid(); });
  }
  async function openForm(fy, monthNo) {
    if (!C.isFy(fy) || !C.isMonthNo(monthNo)) return go('#/chapter');
    S.screen = 'form'; loading('Opening ' + C.periodLabel(fy, monthNo) + ' CPR…');
    var r;
    try { r = await API.call('report.open', {fy: fy, monthNo: monthNo, type: 'CHAPTER'}); } catch (e) { if (e.code === 'FUTURE_MONTH' || e.code === 'BAD_INPUT') { toast(e.message, 6000); return go('#/chapter'); } return errBox(e, true); }
    if (r.exists && C.EDITABLE.indexOf(r.meta.status) < 0) return go('#/report/' + encodeURIComponent(r.meta.reportId));
    var d = r.data; ensureShape(d);
    var savedEids = {}; d.events.concat(d.vanyatras).forEach(function (e) { if (r.exists) savedEids[e.eid] = true; });
    S.form = {meta: r.meta, data: d, prev: r.prev, earlier: r.earlier || null, files: r.files, version: r.meta.version || 0, exists: r.exists, dirty: false, savedEids: savedEids, savedAt: r.meta.lastSavedOn || '', modes: {}};
    ensureSubs();
    main(formHtml());
    renderLists(); fillForm(); paint(); applyIfs(); updateMeta();
    var local = LS.get(localKey());
    if (local && local.data && (!r.exists || (local.baseVersion === S.form.version && local.at > (S.form.savedAt || '')))) {
      $('#restoreSlot').innerHTML = '<div class="restore">You have changes on this device from ' + esc(fmtStamp(local.at)) + ' that were not saved to the server.<span class="sp" style="flex:1"></span><button type="button" class="btn sm" data-act="restore">Restore them</button><button type="button" class="btn ghost sm" data-act="discardLocal">Discard</button></div>';
    }
  }
  function newEid() { var s = ''; var a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 11; i++) s += a.charAt(Math.floor(Math.random() * a.length)); return 'e' + s; }
  function localKey() { return 'cpr.local.' + S.form.meta.reportId; }
  function fmtNum(v) { return has(v) ? C.fmtIN(v) : ''; }
  function fillForm(root) {
    var d = S.form.data; root = root || $('#cprForm');
    $$('[data-k]', root).forEach(function (el) {
      var v = getP(d, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.classList.contains('num')) el.value = document.activeElement === el ? (has(v) ? String(v) : '') : fmtNum(v);
      else el.value = v == null ? '' : v;
    });
    $$('input[data-multi]', root).forEach(function (el) { el.checked = (getP(d, el.dataset.multi) || []).indexOf(el.dataset.opt) >= 0; });
    $$('[data-yn]', root).forEach(function (g) { var v = getP(d, g.dataset.yn); $$('button', g).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); }); });
  }
  function fmtCalc(k) {
    var v = getP(S.form.data, k);
    if (!has(v)) return '';
    if (/\.pct$/.test(k)) return v + '%';
    var f = FT[k]; return f && f.type === 'amount' ? C.inr(v) : C.fmtIN(v);
  }
  function paint() {
    var f = S.form, modes = C.compute(f.data, {monthNo: f.meta.monthNo, prev: f.prev, earlier: f.earlier}).modes; f.modes = modes;
    $$('#cprForm [data-c]').forEach(function (o) { o.textContent = fmtCalc(o.dataset.c); });
    Object.keys(modes).forEach(function (k) {
      var el = $('#cprForm [data-k="' + k + '"]'); if (!el) return;
      var lock = modes[k] === 'calc';
      el.readOnly = lock; el.classList.toggle('carry', lock); el.tabIndex = lock ? -1 : 0;
      el.title = (C.LOCK_FOREVER || []).indexOf(k) >= 0 ? (lock ? 'Locked: this was filled once in an earlier CPR' : 'Fill this once. After you save it, it is locked in every later month.')
        : lock ? 'Fills itself' : 'Last month’s CPR is not in the system, so type this once. From next month it fills itself.';
      if (lock && document.activeElement !== el) el.value = fmtNum(getP(f.data, k));
    });
    var A = f.data.anchals, sum = function (k) { return A.reduce(function (a, x) { return a + num(x[k]); }, 0); }, tot = $('#x1Tot');
    if (tot) { tot.hidden = !A.length; tot.innerHTML = A.length ? [['No. of Acharyas Paid', C.fmtIN(sum('acharyas'))], ['Total Remittance till Last Date', C.inr(sum('tillLast'))], ['Remittance This Month', C.inr(sum('remitMonth'))], ['PRP: No. of Acharyas', C.fmtIN(sum('prpAcharyas'))], ['PRP: Amount', C.inr(sum('prpAmt'))]].map(function (x) { return '<div class="fld"><span class="lbl">' + x[0] + '</span><output class="calc">' + x[1] + '</output></div>'; }).join('') : ''; }
    updateDateHints();
  }
  function evalIf(expr, d) { if (expr.indexOf('||') > 0) return expr.split('||').some(function (x) { return evalIf(x, d); }); if (expr.indexOf('=') > 0) { var p = expr.split('='); return getP(d, p[0]) === p[1]; } if (expr.charAt(0) === '!') return !getP(d, expr.slice(1)); return !!getP(d, expr); }
  function applyIfs() { $$('#cprForm [data-if]').forEach(function (el) { el.hidden = !evalIf(el.dataset.if, S.form.data); }); }
  function updateMeta() {
    var f = S.form, st = $('#fstatus'), hint = $('#savehint'); if (!st) return;
    st.innerHTML = chip(f.meta.status === 'NOT_STARTED' ? 'NOT_STARTED' : f.meta.status) + ' <span class="muted">' + (f.savedAt ? 'Saved ' + esc(fmtStamp(f.savedAt)) : 'Not saved yet') + '</span>';
    hint.textContent = f.saving ? 'Saving…' : f.offline ? 'Offline: kept on this device. It will save when you are back online.' : f.dirty ? 'Changes not saved yet. Drafts save by themselves every few seconds.' : (f.exists ? 'All changes saved.' : 'Your entries save as a draft by themselves.');
  }
  function changed() {
    var f = S.form; f.dirty = true;
    paint(); applyIfs(); updateMeta();
    clearTimeout(f.localT); f.localT = setTimeout(function () { LS.set(localKey(), {data: f.data, at: nowStamp(), baseVersion: f.version}); }, 600);
    clearTimeout(f.autoT); f.autoT = setTimeout(function () { saveDraft(true); }, 15000);
  }
  function nowStamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

  var saving = null;
  async function saveDraft(quiet) {
    var f = S.form; if (!f) return false;
    if (!S.config.chapterLocked && !f.meta.chapterId) { if (!quiet) toast('Choose the Chapter Name first.', 5000); return false; }
    clearTimeout(f.autoT);
    if (saving) { await saving; if (!f.dirty) return true; }
    var snapshot = JSON.stringify(f.data);
    f.saving = true; updateMeta();
    saving = API.call('report.saveDraft', {fy: f.meta.fy, monthNo: f.meta.monthNo, type: 'CHAPTER', data: JSON.parse(snapshot), version: f.version});
    try {
      var r = await saving;
      var editedMeanwhile = JSON.stringify(f.data) !== snapshot;
      var keepCh = {id: f.meta.chapterId, name: f.meta.chapterName};
      f.meta = r.meta; if (!S.config.chapterLocked) { f.meta.chapterId = keepCh.id; f.meta.chapterName = keepCh.name; }
      f.version = r.meta.version; f.exists = true; f.savedAt = r.meta.lastSavedOn; f.offline = false;
      ['events', 'vanyatras'].forEach(function (g) { (r.data[g] || []).forEach(function (se) { var le = (f.data[g] || []).filter(function (e) { return e.eid === se.eid; })[0]; if (le) { le.photoIds = se.photoIds || []; le.photoUrls = se.photoUrls || []; } f.savedEids[se.eid] = true; }); });
      f.dirty = editedMeanwhile;
      if (editedMeanwhile) { clearTimeout(f.autoT); f.autoT = setTimeout(function () { saveDraft(true); }, 5000); } else LS.del(localKey());
      if (!quiet) toast('CPR saved successfully.');
      if (r.warnings && r.warnings.length && !quiet) toast(r.warnings.length + ' value' + (r.warnings.length > 1 ? 's were' : ' was') + ' not valid and was left empty: ' + r.warnings[0].label, 7000);
      return true;
    } catch (e) {
      if (e.code === 'OFFLINE') { f.offline = true; if (!quiet) toast('No internet. Your CPR is kept on this device and will save when you are online.', 6000); }
      else if (e.code === 'CONFLICT') modal('<h2>This CPR changed somewhere else</h2><p>' + esc(e.message) + '</p><p class="muted">Your changes are kept on this device; after reloading you can choose “Restore them”.</p><div class="acts"><button class="btn primary" data-act="reloadForm">Reload</button></div>', 'var(--bad)');
      else if (e.code === 'LOCKED' || e.code === 'ALREADY_SUBMITTED') { toast(e.message, 6000); go('#/report/' + encodeURIComponent(f.meta.reportId)); }
      else if (!quiet || e.code !== 'SESSION_EXPIRED') toast(e.message || 'CPR could not be saved. Please try again.', 6000);
      return false;
    } finally { saving = null; f.saving = false; updateMeta(); }
  }
  window.addEventListener('online', function () { if (S.form && S.form.offline && S.screen === 'form') saveDraft(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && S.screen === 'form' && S.form && S.form.dirty) saveDraft(true); });
  window.addEventListener('beforeunload', function (e) { if (S.screen === 'form' && S.form && S.form.dirty) { e.preventDefault(); e.returnValue = ''; } });
  async function leaveForm() { if (S.screen === 'form' && S.form && S.form.dirty) await saveDraft(true); }

  function findEl(k) {
    return $('#cprForm [data-k="' + k + '"]') || $('#cprForm [data-yn="' + k + '"]') || $('#cprForm .checks[data-multi="' + k + '"]') || document.getElementById(k) ||
      (k === 'meetings.add' ? $('#cprForm [data-add="meetings"]') : null) || (/^(events|vanyatras)\.\d+\.photos$/.test(k) ? $('#cprForm [data-photos-g="' + k.split('.')[0] + '"][data-photos="' + k.split('.')[1] + '"]') : null);
  }
  function markErrors(errs) {
    $$('#cprForm .err').forEach(function (el) { el.classList.remove('err'); });
    errs.forEach(function (e) { var el = findEl(e.k); if (el) el.classList.add('err'); });
  }
  function jumpTo(k) {
    var el = findEl(k); if (!el) return;
    var hid = el.closest('[hidden]'); if (hid) hid.hidden = false;
    el.scrollIntoView({block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    setTimeout(function () { var t = el.matches('input,select,textarea,button') ? el : el.querySelector('input,button,select'); if (t) t.focus({preventScroll: true}); }, 250);
  }
  function showErrors(errs) {
    var reopened = false;
    errs.forEach(function (e) { var mm = /^(events|vanyatras|subs)\.(\d+)\./.exec(e.k), row = mm && S.form.data[mm[1]][+mm[2]]; if (row && !isOpen(row)) { openRow(row, false); reopened = true; } });
    if (reopened) rerender();
    markErrors(errs);
    var m = modal('<h2>' + (errs.length === 1 ? 'One thing' : errs.length + ' things') + ' to complete before submitting</h2><ol>' + errs.map(function (e, i) { return '<li><button class="linkbtn" data-jump="' + i + '">' + esc(e.label) + '</button></li>'; }).join('') + '</ol>' +
      '<p class="muted">Your CPR is saved as a draft, so nothing is lost.</p><div class="acts"><button class="btn primary" data-close>Go back to the CPR</button></div>', 'var(--bad)');
    m.addEventListener('click', function (e) { var b = e.target.closest('[data-jump]'); if (b) { closeModal(); jumpTo(errs[+b.dataset.jump].k); } });
  }
  function validationCtx() { var f = S.form; return {fy: f.meta.fy, monthNo: f.meta.monthNo, prev: f.prev, earlier: f.earlier, lists: LST(), eventSpecify: S.config.eventSpecify || [], today: S.config.today || nowStamp().slice(0, 10), vyPhotoMin: S.config.vyPhotosMin, photoMin: S.config.photosMin, photoMax: S.config.photosMax}; }
  async function trySubmit() {
    var f = S.form, sys = ['eid', 'photoIds', 'photoUrls', 'tillLast'];
    ['meetings', 'vanyatras', 'events', 'anchals', 'subs'].forEach(function (k) { f.data[k] = f.data[k].filter(function (x) { return !C.isEmptyRow(x, sys); }); });
    renderLists(); fillForm(); paint(); applyIfs();
    var norm = C.normalize(f.data);
    var errs = norm.invalid.map(function (i) { return {k: i.k, label: i.label + ' ' + i.msg}; }).concat(C.validate(f.data, validationCtx()));
    if (!f.meta.chapterId) errs.unshift({k: 'fChapter', label: 'Chapter Name'});
    if (errs.length) { if (f.dirty && f.meta.chapterId) saveDraft(true); return showErrors(errs); }
    var m = modal('<h2>Submit ' + esc(C.periodLabel(f.meta.fy, f.meta.monthNo)) + ' CPR?</h2><p>After submission the CPR is <b>locked</b>. You will then download it, get it signed by the Secretary / President, and upload the signed copy.</p>' +
      '<p class="muted">If something needs to change later, the National Office can return it to you for correction.</p><div class="acts"><button class="btn" data-close>Not yet</button><button class="btn primary" id="okSubmit">Submit CPR</button></div>');
    $('#okSubmit', m).onclick = async function () {
      var btn = this; busy(btn, true, 'Submitting…'); clearTimeout(f.autoT);
      try {
        var r = await API.call('report.submit', {fy: f.meta.fy, monthNo: f.meta.monthNo, type: 'CHAPTER', data: f.data, version: f.version});
        LS.del(localKey()); f.dirty = false; closeModal();
        S.flash = 'CPR submitted successfully.';
        go('#/report/' + encodeURIComponent(r.meta.reportId));
      } catch (e) {
        closeModal();
        if (e.code === 'VALIDATION') showErrors(e.details.errors);
        else if (e.code === 'CONFLICT') modal('<h2>This CPR changed somewhere else</h2><p>' + esc(e.message) + '</p><div class="acts"><button class="btn primary" data-act="reloadForm">Reload</button></div>', 'var(--bad)');
        else toast(e.message || 'The CPR could not be submitted. Please try again.', 7000);
      }
    };
  }

  /* event photographs: 2–4 per event, JPG / PNG / WEBP, previews, replace, remove */
  var photoTarget = null;
  function pickPhoto(g, i, replaceId) {
    var row = S.form.data[g][i];
    if (g === 'events' && (!row.name || !row.date)) return toast('Choose the event date and event name first, then add photographs.', 5000);
    if (g === 'vanyatras' && (!row.date || !row.place)) return toast('Fill the Vanyatra date and place first, then add photos.', 5000);
    photoTarget = {g: g, eid: row.eid, replace: replaceId || '', kind: g === 'events' ? 'EVENT_PHOTO' : 'VANYATRA_PHOTO'};
    var inp = $('#filePick'); inp.accept = 'image/jpeg,image/png,image/webp'; inp.dataset.kind = 'PHOTO'; inp.value = ''; inp.click();
  }
  async function uploadPhoto(file) {
    var f = S.form, t = photoTarget, ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].indexOf(ext) < 0) return toast('Please choose a JPG, PNG or WEBP photo.', 6000);
    try { await API.checkImage(file); } catch (e) { return toast(e.message, 6000); }
    if (f.dirty || !f.savedEids[t.eid]) { toast('Saving the draft first…'); if (!(await saveDraft(true))) return; }
    file = await API.shrinkImage(file, 1800, 0.82, 600 * 1024);
    if (file.size > (S.config.photoMaxMb || 25) * 1048576) return toast('This photo is larger than ' + (S.config.photoMaxMb || 25) + ' MB.', 6000);
    toast('Uploading photo…', 30000);
    try {
      var r = await API.upload(file, {kind: t.kind, reportId: f.meta.reportId, eventId: t.eid, replaceFileId: t.replace}, S.config.chunkChars);
      var row = (f.data[t.g] || []).filter(function (e) { return e.eid === t.eid; })[0];
      if (row) { row.photoIds = r.photoIds || []; row.photoUrls = r.photoUrls || []; }
      thumbCache[r.fileId] = URL.createObjectURL(file);
      rerender();
      toast(t.replace ? 'Photo replaced.' : 'Photo uploaded.');
    } catch (e) { toast(e.message || 'File upload failed. Please try again.', 6000); }
  }

  /* ======================================================================
     REPORT VIEW (chapter and national)
     ====================================================================== */
  async function openReport(id) {
    S.screen = 'report'; loading('Loading CPR…');
    try { S.report = await API.call('report.get', {reportId: id}); } catch (e) { if (e.code === 'FORBIDDEN' || e.code === 'NOT_FOUND') { toast(e.message, 6000); return go('#/select'); } return errBox(e, true); }
    renderReport();
  }
  function timeline(st) {
    var steps = [['DRAFT', 'Draft'], ['SUBMITTED', 'Submitted'], ['AWAITING_SIGNED_CPR', 'Awaiting signed CPR'], ['SIGNED_CPR_UPLOADED', 'Signed CPR uploaded'], ['VERIFIED', 'Verified / Approved']];
    var level = {DRAFT: 0, CORRECTION_REQUIRED: 0, AWAITING_SIGNED_CPR: 2, SIGNED_CPR_UPLOADED: 3, VERIFIED: 4}[st];
    return '<ol class="timeline" aria-label="Status">' + steps.map(function (s, i) {
      var cls = st === 'CORRECTION_REQUIRED' && i === 0 ? 'bad' : i < level || (i === level && st === 'VERIFIED') ? 'done' : i === level ? 'now' : '';
      return '<li class="' + cls + '">' + (st === 'CORRECTION_REQUIRED' && i === 0 ? 'Correction required' : s[1]) + '</li>';
    }).join('') + '</ol>';
  }
  function renderReport() {
    var r = S.report, m = r.meta, nat = S.user.role === 'NATIONAL', st = m.status;
    var signed = r.files.filter(function (x) { return x.type === 'SIGNED_CPR'; })[0];
    var back = nat ? '<a href="#/national">National dashboard</a>' : '<a href="#/chapter/' + esc(m.fy) + '">' + esc(m.chapterName) + ' CPRs</a>';
    var flash = S.flash ? '<p class="formok" role="status">' + esc(S.flash) + '</p>' : ''; S.flash = '';
    var actions = '<button class="btn" data-act="downloadCpr">Download CPR</button><button class="btn" data-act="print">Print</button>';
    if (!nat && C.EDITABLE.indexOf(st) >= 0) actions = '<button class="btn primary" data-open-cpr="' + m.fy + '/' + m.monthNo + '">' + (st === 'CORRECTION_REQUIRED' ? 'Correct the CPR' : 'Continue editing') + '</button>' + actions;
    var corr = st === 'CORRECTION_REQUIRED' ? '<div class="banner-bad"><b>Returned for correction by the National Office</b>' + esc(m.remarks || '') + '</div>' : '';
    var signBox = '';
    if (C.SUBMITTED.indexOf(st) >= 0) {
      var types = (S.config.signedTypes || []).map(function (x) { return x.toUpperCase(); }).join(', ');
      signBox = '<section class="signbox" id="signed"><h2>Signed &amp; Approved CPR</h2>' +
        (signed ? '<div class="filecard"><span>' + chip('SIGNED_CPR_UPLOADED', 'Uploaded') + '</span><span><b>' + esc(signed.name) + '</b><br><span class="muted">' + esc(fmtStamp(signed.uploadedOn)) + ' by ' + esc(signed.uploadedBy) + '</span></span><span class="sp" style="flex:1"></span><button class="btn sm" data-download="' + esc(signed.fileId) + '">Download Signed CPR</button></div>' : '') +
        (!nat && st !== 'VERIFIED' ? (signed ? '<p class="muted">Uploaded the wrong file? You can replace it until the National Office verifies the CPR.</p>' :
          '<ol><li>Download the CPR (button above).</li><li>Print it.</li><li>Get it signed by the Chapter Secretary / President.</li><li>Scan it or take a clear photograph of each page.</li><li>Upload the signed CPR here.</li></ol>') +
          '<div class="upl"><button class="btn primary" data-act="uploadSigned">' + (signed ? 'Replace Signed CPR' : 'Upload Signed CPR') + '</button><span class="muted">' + esc(types) + ', up to ' + esc(S.config.maxUploadMb) + ' MB</span><div class="progress" id="upProg" hidden><i></i></div></div>' : '') +
        (nat && !signed ? '<p class="muted">The chapter has not uploaded the signed CPR yet.</p>' : '') +
        (st === 'VERIFIED' ? '<p class="formok" style="margin-top:8px">Verified by ' + esc(m.verifiedBy) + ' on ' + esc(fmtStamp(m.verifiedOn)) + '.' + (m.remarks ? ' Remarks: ' + esc(m.remarks) : '') + '</p>' : '') + '</section>';
    }
    var verify = '';
    if (nat && C.SUBMITTED.indexOf(st) >= 0) {
      verify = '<section class="verify"><h2>National Office review</h2>' +
        '<label class="fld"><span class="lbl">Remarks (required to return for correction)</span><textarea class="in" id="natRemarks" rows="2" maxlength="1000"></textarea></label>' +
        '<div class="upl">' + (st === 'SIGNED_CPR_UPLOADED' ? '<button class="btn primary" data-setstatus="VERIFIED">Verify / Approve</button>' : '') +
        '<button class="btn" data-setstatus="CORRECTION_REQUIRED">Return for correction</button>' + (st === 'AWAITING_SIGNED_CPR' ? '<span class="muted">Verification opens after the chapter uploads the signed CPR.</span>' : '') + '</div></section>';
    }
    var html = C.reportHtml({chapterName: m.chapterName, chapterId: m.chapterId, fy: m.fy, monthNo: m.monthNo, reportId: m.reportId, data: r.data, statusLabel: m.statusLabel, submittedOn: m.submittedOn,
      watermark: C.SUBMITTED.indexOf(st) < 0 ? 'DRAFT – NOT SUBMITTED' : ''});
    main('<div class="crumb no-print">' + back + ' › ' + esc(C.periodLabel(m.fy, m.monthNo)) + '</div>' + flash +
      '<div class="rhead no-print"><div><h1>' + esc(m.chapterName) + ': ' + esc(C.periodLabel(m.fy, m.monthNo)) + '</h1><div class="rmeta"><span>' + chip(st, m.statusLabel) + '</span><span>FY <b>' + esc(m.fy) + '</b></span>' +
      (m.submittedOn ? '<span>Submitted <b>' + esc(fmtStamp(m.submittedOn)) + '</b></span>' : '') + '</div></div><div class="dctl">' + actions + '</div></div>' +
      '<div class="no-print">' + timeline(st) + corr + signBox + verify + '</div>' +
      '<div class="paper" id="paper">' + html + '</div>');
  }
  async function uploadSigned(file) {
    var r = S.report, ext = (file.name.split('.').pop() || '').toLowerCase();
    if ((S.config.signedTypes || []).indexOf(ext) < 0) return toast('Please choose a ' + S.config.signedTypes.join(', ').toUpperCase() + ' file.', 6000);
    if (/^image\//.test(file.type)) file = await API.shrinkImage(file, 2400, 0.88, 2.5 * 1048576);
    if (file.size > S.config.maxUploadMb * 1048576) return toast('This file is larger than ' + S.config.maxUploadMb + ' MB. Please scan at a lower resolution.', 7000);
    var prog = $('#upProg'), btn = $('[data-act="uploadSigned"]');
    if (prog) prog.hidden = false; busy(btn, true, 'Uploading…');
    try {
      await API.upload(file, {kind: 'SIGNED_CPR', reportId: r.meta.reportId}, S.config.chunkChars, function (p) { if (prog) prog.firstChild.style.width = Math.round(p * 100) + '%'; });
      S.flash = 'Signed CPR uploaded successfully.';
      openReport(r.meta.reportId);
    } catch (e) { busy(btn, false); if (prog) prog.hidden = true; toast(e.message || 'File upload failed. Please try again.', 7000); }
  }
  async function downloadCpr(btn, reportId) {
    busy(btn, true, 'Preparing…');
    try {
      var r = await API.call('report.pdf', {reportId: reportId});
      if (r.fileId) await API.download(r.fileId); else API.saveBase64(r.data, r.name, r.mime);
    } catch (e) { toast(e.message || 'Download failed. Please try again.', 6000); }
    finally { busy(btn, false); }
  }

  /* ======================================================================
     NATIONAL OFFICE DASHBOARD
     ====================================================================== */
  async function renderNational() {
    S.screen = 'national'; loading('Loading dashboard…');
    var f = S.natFilters;
    if (f.monthNo === null || f.monthNo === undefined) {   // first visit: open on the month whose CPR is due now
      var dp = /^\d{4}-\d{2}$/.test((S.config && S.config.currentPeriod) || '') ? C.addMonthsToPeriod(S.config.currentPeriod, -1) : '';
      f.monthNo = dp ? String(+dp.slice(5)) : ''; if (dp && !f.fy) f.fy = C.fyOfPeriod(dp);
    }
    try { S.nat = await API.call('national.dashboard', {fy: f.fy, monthNo: f.monthNo, zone: f.zone, chapterId: f.chapterId, status: f.status, type: 'CHAPTER'}); } catch (e) { return errBox(e, true); }
    var n = S.nat, c = n.counts; f.fy = n.fy;
    var sel = function (id, label, opts, val) { return '<label class="fld"><span class="lbl">' + label + '</span><select class="in" data-filter="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + (o[2] ? ' disabled' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>'; };
    var filters = '<div class="filters no-print">' +
      sel('fy', 'Financial Year', n.financialYears.map(function (y) { return [y, y]; }), n.fy) +
      sel('monthNo', 'Month', [['', 'All months']].concat(C.FY_MONTH_NOS.map(function (m) { return [m, C.periodLabel(n.fy, m)]; })), n.monthNo || '') +
      sel('zone', 'Zone', [['', 'All zones']].concat(n.zones.map(function (z) { return [z, z]; })), f.zone) +
      sel('chapterId', 'Chapter', [['', 'All chapters']].concat(n.chapters.filter(function (ch) { return !f.zone || ch.zone === f.zone; }).map(function (ch) { return [ch.id, ch.name]; })), f.chapterId) +
      sel('status', 'Status', n.statuses.map(function (s) { return [s.id, s.label]; }), f.status) +
      sel('type', 'Report Type', n.reportTypes.map(function (t) { return [t.id, t.label + (t.active ? '' : ' (coming soon)'), !t.active]; }), 'CHAPTER') + '</div>';
    var unit = n.monthNo ? 'chapters' : 'chapter-months';
    var card = function (cc, v, l, st) { return '<button class="card" style="--cc:' + cc + '" data-statuscard="' + st + '" aria-pressed="' + (f.status === st) + '"><div class="cv">' + v + '</div><div class="clbl">' + l + '</div></button>'; };
    var cards = '<div class="cards">' + '<div class="card" style="--cc:var(--sHdr)"><div class="cv">' + c.chapters + '</div><div class="clbl">Total Chapters' + (n.monthNo ? '' : ' (' + c.slots + ' CPRs due)') + '</div></div>' +
      card('#1D4F86', c.submitted, 'Submitted', 'SUBMITTED') + card('var(--bad)', c.notSubmitted, 'Pending / Not Submitted', 'NOT_SUBMITTED') + card('var(--ink2)', c.notStarted, 'Not Started', 'NOT_STARTED') + card('var(--warn)', c.draft, 'Draft', 'DRAFT') +
      card('#0B6B5F', c.signed, 'Signed', 'SIGNED_CPR_UPLOADED') + card('var(--ok)', c.verified, 'Approved', 'VERIFIED') + card('var(--bad)', c.correction, 'Correction Required', 'CORRECTION_REQUIRED') + '</div>';
    var k = n.kpis, kp = '';
    if (k) {
      var kk = function (cc, l, v, s) { return '<div class="kpi" style="--kc:' + cc + '"><div class="kl">' + l + '</div><div class="kv">' + v + '</div><div class="ks">' + s + '</div></div>'; };
      kp = '<section class="panel"><div class="ph"><h2>Key figures, ' + esc(C.periodLabel(n.fy, n.monthNo)) + '</h2><span class="muted">From ' + k.reports + ' submitted CPR' + (k.reports === 1 ? '' : 's') + '</span></div><div class="kpis" style="margin:0">' +
        kk('var(--sC)', 'OTS this month', C.fmtIN(k.otsMonthCount), C.inr(k.otsMonthAmt) + ' received') + kk('var(--sC)', 'OTS this year (till date)', C.fmtIN(k.otsYtdCount), C.inr(k.otsYtdAmt) + ' received') +
        kk('var(--sA)', 'Members', C.fmtIN(k.memTotal), C.fmtIN(k.memNew) + ' new this month') + kk('var(--sX)', 'Remitted to Anchals', C.inr(k.remitMonth), 'this month') + '</div></section>';
    }
    var rows = n.rows.map(function (r) {
      var acts = r.reportId ? '<button class="btn sm" data-open-report="' + esc(r.reportId) + '">View</button>' +
        (C.SUBMITTED.indexOf(r.status) >= 0 ? '<button class="btn sm" data-dlcpr="' + esc(r.reportId) + '">Download CPR</button>' : '') +
        (r.signedFileId ? '<button class="btn sm" data-download="' + esc(r.signedFileId) + '">Download Signed CPR</button>' : '') : '<span class="muted">—</span>';
      return '<tr><td><b>' + esc(r.chapterName) + '</b><div class="muted" style="font-size:.82rem">' + esc(r.chapterId) + (r.zone ? ', ' + esc(r.zone) : '') + '</div></td><td>' + esc(r.month) + '</td><td>' + chip(r.status, r.statusLabel) +
        (r.status === 'CORRECTION_REQUIRED' && r.remarks ? '<div class="muted" style="font-size:.82rem">' + esc(r.remarks) + '</div>' : '') + '</td><td>' + esc(fmtStamp(r.submittedOn)) + '</td><td>' + (r.signedOn ? esc(fmtStamp(r.signedOn)) : '<span class="muted">—</span>') + '</td><td class="rowact">' + acts + '</td></tr>';
    }).join('');
    main('<div class="dhead"><div><h1>National Office dashboard</h1><p class="muted">Chapter CPR, FY ' + esc(n.fy) + (n.monthNo ? ', ' + esc(C.periodLabel(n.fy, n.monthNo)) : ', all months that are over') + '.</p></div>' +
      '<div class="exportbar no-print"><button class="btn" data-act="exportXlsx">Download Excel</button><button class="btn" data-act="exportCsv">Download CSV</button></div></div>' +
      filters + cards + kp +
      '<section class="panel"><div class="ph"><h2>Chapter-wise status</h2><span class="muted">' + n.rows.length + ' row' + (n.rows.length === 1 ? '' : 's') + '</span></div>' +
      (n.rows.length ? '<div class="wrap"><table class="tbl months"><thead><tr><th>Chapter</th><th>Month</th><th>Status</th><th>Submitted On</th><th>Signed CPR</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="empty-sm">No CPRs match these filters.</p>') +
      '</section>');
  }
  function setFilter(k, v) {
    S.natFilters[k] = v;
    if (k === 'zone') S.natFilters.chapterId = '';
    LS.set('cpr.natFilters', S.natFilters);
    renderNational();
  }
  var xlsxLoading = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return xlsxLoading || (xlsxLoading = new Promise(function (ok, fail) { var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = function () { xlsxLoading = null; fail({message: 'The Excel tool could not load. Use Download CSV instead.'}); }; document.head.appendChild(s); }));
  }
  async function exportData(kind, btn) {
    busy(btn, true, 'Preparing…');
    try {
      var f = S.natFilters, x = await API.call('national.export', {fy: f.fy, monthNo: f.monthNo, zone: f.zone, chapterId: f.chapterId, status: f.status, type: 'CHAPTER'});
      if (!x.count) { toast('No CPRs match these filters.', 5000); return; }
      var base = 'FTS_CPR_' + x.fy + (x.monthNo ? '_' + C.pad2(x.monthNo) + '-' + C.monthName(x.monthNo) : '_All-months') + (f.zone ? '_' + f.zone : '') + (f.chapterId ? '_' + f.chapterId : '');
      if (kind === 'csv') {
        var csv = '\ufeff' + [x.main.columns].concat(x.main.rows).map(function (r) { return r.map(function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\r\n');
        API.saveBlob(new Blob([csv], {type: 'text/csv;charset=utf-8'}), base + '.csv');
      } else {
        await loadXlsx();
        var wb = XLSX.utils.book_new(), add = function (t, name) { var ws = XLSX.utils.aoa_to_sheet([t.columns].concat(t.rows)); ws['!freeze'] = {xSplit: 0, ySplit: 1}; XLSX.utils.book_append_sheet(wb, ws, name); };
        add(x.main, 'CPR Data'); add(x.meetings, 'Executive Committee'); add(x.vanyatras, 'Vanyatra'); add(x.events, 'Events'); add(x.anchals, 'Anchal Disbursement'); add(x.subs, 'Sub Chapters');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Filter', 'Value'], ['Financial Year', x.fy], ['Month', x.monthNo ? C.monthName(x.monthNo) : 'All'], ['Zone', f.zone || 'All'], ['Chapter', f.chapterId || 'All'], ['Status', f.status || 'All'], ['CPRs', x.count], ['Downloaded', nowStamp()]]), 'Filters');
        XLSX.writeFile(wb, base + '.xlsx');
      }
      toast('Downloaded ' + x.count + ' CPR' + (x.count === 1 ? '' : 's') + '.');
    } catch (e) { toast(e.message || 'Download failed. Please try again.', 6000); }
    finally { busy(btn, false); }
  }

  /* ======================================================================
     EVENTS
     ====================================================================== */
  function onField(e) {
    var t = e.target;
    if (S.screen !== 'form' || !S.form || !t.dataset || (!t.dataset.k && !t.dataset.multi) || t.readOnly) return;
    var d = S.form.data;
    if (t.dataset.multi) {
      var path = t.dataset.multi; setP(d, path, $$('input[data-multi="' + path + '"]:checked').map(function (x) { return x.dataset.opt; }));
      var box = t.closest('.checks'); if (box) box.classList.remove('err');
      return changed();
    }
    var v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.classList.contains('num')) {
      var raw = t.value.replace(/[^0-9.]/g, ''), i = raw.indexOf('.');
      if (i >= 0) raw = raw.slice(0, i + 1) + raw.slice(i + 1).replace(/\./g, '');
      if (t.inputMode === 'numeric') raw = raw.replace(/\..*/, '');
      if (raw !== t.value) t.value = raw;
      v = raw === '' || raw === '.' ? '' : Number(raw.replace(/\.$/, ''));
    } else v = t.value;
    setP(d, t.dataset.k, v);
    t.classList.remove('err');
    var am = /^anchals\.(\d+)\.name$/.exec(t.dataset.k);
    if (am) {
      var h = t.closest('.rcard') && t.closest('.rcard').querySelector('.rcard-h b'); if (h) h.textContent = t.value || 'Anchal';
      var row = d.anchals[+am[1]]; if (row && v && !has(row.prpName)) { row.prpName = v; var pe = $('#cprForm [data-k="anchals.' + am[1] + '.prpName"]'); if (pe) pe.value = v; }
    }
    if (t.dataset.k === 'ec.none') { renderLists(); fillForm(); }
    var mc = /^meetings\.(\d+)\.committee$/.exec(t.dataset.k);
    if (mc) { var hb = t.closest('.rcard') && t.closest('.rcard').querySelector('.rcard-h b'); if (hb) hb.textContent = 'Meeting ' + (+mc[1] + 1) + (v ? ' – ' + v : ''); }
    changed();
  }
  document.addEventListener('input', onField);
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'filePick') { var file = t.files && t.files[0]; if (!file) return; if (t.dataset.kind === 'SIGNED_CPR') uploadSigned(file); else uploadPhoto(file); return; }
    if ((t.id === 'fYear' || t.id === 'fMonth') && S.form) {
      var yy = +$('#fYear').value, mm2 = +$('#fMonth').value, fy2 = mm2 >= 4 ? yy + '-' + C.pad2((yy + 1) % 100) : (yy - 1) + '-' + C.pad2(yy % 100);
      if ((S.config.financialYears || []).indexOf(fy2) < 0) { toast(C.monthName(mm2) + ' ' + yy + ' is not open for CPRs.', 5000); $('#fYear').value = S.form.meta.period.slice(0, 4); $('#fMonth').value = String(+S.form.meta.period.slice(5, 7)); return; }
      return go('#/cpr/' + fy2 + '/' + mm2);
    }
    if (t.id === 'homeFy') return go('#/chapter/' + t.value);
    if (t.id === 'fChapter' && S.form) { if (S.config.chapterLocked) return; var c = (S.config.chapters || []).filter(function (x) { return x.id === t.value; })[0]; S.form.meta.chapterId = c ? c.id : ''; S.form.meta.chapterName = c ? c.name : ''; t.classList.remove('err'); S.form.data.subs = S.form.data.subs.filter(function (x) { return has(x.members) || has(x.ots); }); ensureSubs(); renderLists(); fillForm(); paint(); applyIfs(); changed(); return; }
    if (t.dataset && t.dataset.filter) return setFilter(t.dataset.filter, t.value);
    if (t.type === 'checkbox' || t.tagName === 'SELECT' || t.type === 'date') onField(e);
  });
  document.addEventListener('focusin', function (e) { var t = e.target; if (S.form && t.classList && t.classList.contains('num') && t.dataset.k && !t.readOnly) { var v = getP(S.form.data, t.dataset.k); t.value = has(v) ? String(v) : ''; } });
  document.addEventListener('focusout', function (e) { var t = e.target; if (S.form && t.classList && t.classList.contains('num') && t.dataset.k && S.screen === 'form') t.value = fmtNum(getP(S.form.data, t.dataset.k)); });
  document.addEventListener('submit', function (e) { if (e.target.id === 'loginForm') doLogin(e); else if (e.target.id === 'pwForm') doPassword(e); else e.preventDefault(); });
  document.addEventListener('click', async function (e) {
    var t = e.target.closest('button, a[data-jumpsec]'); if (!t) return;
    var d = t.dataset;
    if (d.jumpsec) { e.preventDefault(); var s = document.getElementById(d.jumpsec); if (s) s.scrollIntoView({block: 'start'}); return; }
    if (d.portal) { S.portal = d.portal; return renderLogin(); }
    if (d.type) return go(S.user.role === 'NATIONAL' ? '#/national' : '#/chapter');
    if (d.openCpr) return go('#/cpr/' + d.openCpr);
    if (d.openReport) return go('#/report/' + encodeURIComponent(d.openReport));
    if (d.download) { busy(t, true, 'Downloading…'); try { await API.download(d.download); } catch (err) { toast(err.message, 6000); } busy(t, false); return; }
    if (d.viewfile) { try { await API.download(d.viewfile); } catch (err) { toast(err.message, 6000); } return; }
    if (d.dlcpr) return downloadCpr(t, d.dlcpr);
    if (d.statuscard !== undefined) return setFilter('status', S.natFilters.status === d.statuscard ? '' : d.statuscard);
    if (d.setstatus) {
      var rem = ($('#natRemarks') || {}).value || '';
      if (d.setstatus === 'CORRECTION_REQUIRED' && rem.trim().length < 5) { toast('Write in Remarks what the chapter needs to correct.', 5000); $('#natRemarks').focus(); return; }
      busy(t, true, 'Saving…');
      try { await API.call('national.setStatus', {reportId: S.report.meta.reportId, status: d.setstatus, remarks: rem}); S.flash = d.setstatus === 'VERIFIED' ? 'CPR verified and approved.' : 'CPR returned to the chapter for correction.'; openReport(S.report.meta.reportId); }
      catch (err) { busy(t, false); toast(err.message, 6000); }
      return;
    }
    if (S.form && S.screen === 'form') {
      if (t.closest('.yn') && !t.disabled) { var g0 = t.closest('.yn'); setP(S.form.data, g0.dataset.yn, d.v); $$('button', g0).forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); }); g0.classList.remove('err'); changed(); return; }
      if (d.add) {
        var G = C.GROUPS[d.add]; if (S.form.data[d.add].length >= G.max) return toast('You can add up to ' + G.max + ' here.');
        var nr = d.add === 'events' ? {eid: newEid(), jointWith: [], photoIds: [], photoUrls: []} : d.add === 'vanyatras' ? {eid: newEid(), photoIds: [], photoUrls: []} : {};
        S.form.data[d.add].push(nr);
        if (d.add === 'events' || d.add === 'vanyatras') openRow(nr, true);
        rerender(); changed();
        var idx = S.form.data[d.add].length - 1, first = $$('#cprForm [data-k^="' + d.add + '.' + idx + '."]')[0]; if (first) first.focus();
        return;
      }
      if (d.del) {
        var row = S.form.data[d.del][+d.i];
        if (row && (row.photoIds || []).length && !confirm('Remove this entry and its photos from the CPR?')) return;
        if (row) openRows.delete(row);
        S.form.data[d.del].splice(+d.i, 1); rerender(); changed(); return;
      }
      if (d.rowedit) { var re = S.form.data[d.rowedit][+d.i]; openRow(re, false); rerender(); var fe = $$('#cprForm [data-k^="' + d.rowedit + '.' + d.i + '."]')[0]; if (fe) fe.focus(); return; }
      if (d.rowsave) { busy(t, true, 'Saving…'); await saveDraft(false); busy(t, false); return; }
      if (d.rowdone) { openRows.delete(S.form.data[d.rowdone][+d.i]); rerender(); if (S.form.dirty) saveDraft(true); return; }
      if (d.rowcancel) {
        var arr = S.form.data[d.rowcancel], rc = arr[+d.i], stt = openRows.get(rc);
        if (stt && stt.snap === null) arr.splice(+d.i, 1);
        else if (stt) { var keepIds = rc.photoIds, keepUrls = rc.photoUrls, old = JSON.parse(stt.snap); Object.keys(rc).forEach(function (k) { delete rc[k]; }); Object.keys(old).forEach(function (k) { rc[k] = old[k]; }); if (keepIds) { rc.photoIds = keepIds; rc.photoUrls = keepUrls; } }
        openRows.delete(rc); rerender(); changed(); return;
      }
      if (d.addphoto !== undefined) return pickPhoto(d.group || 'events', +d.addphoto, '');
      if (d.replacephoto !== undefined) return pickPhoto(d.group || 'events', +d.replacephoto, d.file);
      if (d.delphoto !== undefined) {
        var pg = d.group || 'events', ev = S.form.data[pg][+d.delphoto];
        if (!confirm('Remove this photo?')) return;
        try { var rr = await API.call('photo.remove', {reportId: S.form.meta.reportId, eventId: ev.eid, fileId: d.file}); (rr[pg] || []).forEach(function (se) { var le = S.form.data[pg].filter(function (x) { return x.eid === se.eid; })[0]; if (le) { le.photoIds = se.photoIds || []; le.photoUrls = se.photoUrls || []; } }); rerender(); toast('Photo removed. You can add another.'); }
        catch (err) { toast(err.message, 6000); }
        return;
      }
    }
    switch (d.act) {
      case 'showpw': var pw = $('#lgPw'); pw.type = pw.type === 'password' ? 'text' : 'password'; t.textContent = pw.type === 'password' ? 'Show' : 'Hide'; return;
      case 'logout': await leaveForm(); try { await API.call('auth.logout'); } catch (err) {} API.setToken(''); S.user = null; S.form = null; S.flash = 'You have logged out.'; return go('#/login');
      case 'password': return go('#/password');
      case 'home': return go('#/select');
      case 'install': if (installEvt) { installEvt.prompt(); installEvt = null; renderHeader(); } return;
      case 'retry': return route();
      case 'pickOpen': return go('#/cpr/' + $('#pickFy').value + '/' + $('#pickMonth').value);
      case 'saveDraft': busy(t, true, 'Saving…'); await saveDraft(false); busy(t, false); return;
      case 'submit': return trySubmit();
      case 'restore': var loc = LS.get(localKey()); if (loc && loc.data) { S.form.data = loc.data; renderLists(); fillForm(); paint(); applyIfs(); changed(); } $('#restoreSlot').innerHTML = ''; toast('Restored. Saving…'); saveDraft(true); return;
      case 'discardLocal': LS.del(localKey()); $('#restoreSlot').innerHTML = ''; return;
      case 'reloadForm': closeModal(); S.form.dirty = false; return openForm(S.form.meta.fy, S.form.meta.monthNo);
      case 'uploadSigned': var inp = $('#filePick'); inp.accept = (S.config.signedTypes || []).map(function (x) { return '.' + x; }).join(',') + ',application/pdf,image/jpeg,image/png'; inp.dataset.kind = 'SIGNED_CPR'; inp.value = ''; inp.click(); return;
      case 'downloadCpr': return downloadCpr(t, S.report.meta.reportId);
      case 'print': document.body.classList.add('printing'); window.print(); setTimeout(function () { document.body.classList.remove('printing'); }, 500); return;
      case 'exportXlsx': return exportData('xlsx', t);
      case 'exportCsv': return exportData('csv', t);
    }
  });

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  boot();
})();
