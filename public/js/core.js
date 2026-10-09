/* =====================================================================
   FTS CPR — SHARED CORE
   The same file runs in two places:
     • Browser:       frontend/public/js/core.js
     • Apps Script:   apps-script/Core.gs
   It holds the CPR field list (source of truth), Financial-Year helpers,
   all calculations, all validation rules and the printable report layout.
   Do not use browser-only or Apps-Script-only APIs in this file.
   After editing, run:  node tools/sync-core.js   (copies it to both places)
   ===================================================================== */
var CPR = (function () {
  'use strict';

  /* ---------------- dates, Financial Year, months ---------------- */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var FY_MONTH_NOS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isFy(fy) { var m = /^(\d{4})-(\d{2})$/.exec(String(fy || '')); return !!m && ((+m[1] + 1) % 100) === +m[2]; }
  function fyStart(fy) { return parseInt(String(fy).slice(0, 4), 10); }
  function fyOfPeriod(p) { var y = +p.slice(0, 4), m = +p.slice(5, 7), s = m >= 4 ? y : y - 1; return s + '-' + pad2((s + 1) % 100); }
  function periodOf(fy, mNo) { return (fyStart(fy) + (mNo < 4 ? 1 : 0)) + '-' + pad2(mNo); }
  function monthName(mNo) { return MONTHS[mNo - 1]; }
  function isMonthNo(n) { n = +n; return n >= 1 && n <= 12 && Math.floor(n) === n; }
  function prevMonthNo(mNo) { return mNo === 1 ? 12 : mNo - 1; }
  function periodLabel(fy, mNo) { return monthName(mNo) + ' ' + periodOf(fy, mNo).slice(0, 4); }
  function reportId(chapterId, fy, mNo, type) { return chapterId + '_' + fy + '_' + pad2(mNo) + '_' + (type || 'CHAPTER'); }
  function parseReportId(id) { var m = /^([A-Za-z0-9-]{1,20})_(\d{4}-\d{2})_(\d{2})_([A-Z]+)$/.exec(String(id || '')); return m ? {chapterId: m[1], fy: m[2], monthNo: +m[3], type: m[4]} : null; }
  function addMonthsToPeriod(p, k) { var y = +p.slice(0, 4), m = +p.slice(5, 7) + k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + '-' + pad2(m); }

  /* ---------------- status workflow ---------------- */
  var STATUS = {DRAFT: 'DRAFT', AWAITING: 'AWAITING_SIGNED_CPR', SIGNED: 'SIGNED_CPR_UPLOADED', VERIFIED: 'VERIFIED', CORRECTION: 'CORRECTION_REQUIRED', NOT_STARTED: 'NOT_STARTED'};
  var STATUS_LABEL = {
    DRAFT: 'Draft', AWAITING_SIGNED_CPR: 'Submitted – Awaiting Signed CPR', SIGNED_CPR_UPLOADED: 'Signed CPR Uploaded',
    VERIFIED: 'Verified / Approved', CORRECTION_REQUIRED: 'Correction Required', NOT_STARTED: 'Not Started'
  };
  var EDITABLE = ['DRAFT', 'CORRECTION_REQUIRED'];
  var SUBMITTED = ['AWAITING_SIGNED_CPR', 'SIGNED_CPR_UPLOADED', 'VERIFIED'];
  var SIGNED = ['SIGNED_CPR_UPLOADED', 'VERIFIED'];
  var REPORT_TYPES = [{id: 'CHAPTER', label: 'Chapter', active: true}, {id: 'MAHILA', label: 'Mahila', active: false}, {id: 'YUVA', label: 'Yuva', active: false}];
  var EVENT_BY = ['Chapter', 'Mahila Samiti', 'Yuva Samiti', 'Joint'];
  var JOINT_GROUPS = ['Chapter', 'Mahila Samiti', 'Yuva Samiti'];
  var VY_BY = ['Chapter', 'Mahila Samiti', 'Yuva Samiti', 'Jointly'];

  /* ---------------- CPR FIELD LIST (source of truth) ----------------
     type:  text | textarea | int | amount | number | date | month | yesno | enum | bool
     req:   'yes' | 'cond' (conditional, see reqNote) | undefined
     calc:  'carry' (till-date: last month + this month) | 'sum' | 'diff'
     helper: true → added by the web form (not on the paper CPR) */
  var FIELDS = [];
  function f(key, sec, label, type, col, o) { var x = {key: key, sec: sec, label: label, type: type, col: col}; o = o || {}; for (var k in o) x[k] = o[k]; FIELDS.push(x); return x; }

  f('cppName', 'Header', 'Name of CPP', 'text', 'CPP_Name', {req: 'yes', max: 100, suggest: 'cpp'});
  f('submissionDate', 'Header', 'Submission Date', 'date', 'Submission_Date', {req: 'yes', reqNote: 'Chosen from the calendar; not before the 1st of the report month and not after today'});

  var MEM_ROWS = [['ch', 'Chapter Members', 'ChapterMembers'], ['ms', 'Mahila Samiti', 'MahilaSamiti'], ['ys', 'Yuva Samiti', 'YuvaSamiti']];
  MEM_ROWS.forEach(function (r) {
    f('mem.' + r[0] + '.opening', 'A', r[1] + ' – Members as on 31st March', 'int', 'A_' + r[2] + '_AsOn31Mar', {req: 'cond', reqNote: 'Required only when it cannot be carried from last month’s CPR'});
    f('mem.' + r[0] + '.new', 'A', r[1] + ' – During the Month (New Members)', 'int', 'A_' + r[2] + '_NewThisMonth', {req: 'yes'});
    f('mem.' + r[0] + '.total', 'A', r[1] + ' – Total Members (Till Month End)', 'int', 'A_' + r[2] + '_TotalTillMonthEnd', {calc: 'carry', req: 'cond', reqNote: 'Auto: last month’s total + new members (April: as on 31 March + new). Typed once if last month’s CPR is not in the system'});
    f('mem.' + r[0] + '.paidCount', 'A', r[1] + ' – Membership Amount Received: No. of Members (Till Month End)', 'int', 'A_' + r[2] + '_PaidMembers');
    f('mem.' + r[0] + '.paidAmt', 'A', r[1] + ' – Membership Amount Received: Amount Received ₹ (Till Month End)', 'amount', 'A_' + r[2] + '_AmountReceived');
    f('mem.' + r[0] + '.remarks', 'A', r[1] + ' – Remarks / Break-up', 'text', 'A_' + r[2] + '_Remarks', {max: 300});
  });
  [['opening', 'Members as on 31st March', 'int', 'AsOn31Mar'], ['new', 'During the Month (New Members)', 'int', 'NewThisMonth'], ['total', 'Total Members (Till Month End)', 'int', 'TotalTillMonthEnd'], ['paidCount', 'Membership Amount Received: No. of Members', 'int', 'PaidMembers'], ['paidAmt', 'Membership Amount Received: Amount Received ₹', 'amount', 'AmountReceived']].forEach(function (c) {
    f('memT.' + c[0], 'A', 'TOTAL – ' + c[1], c[2], 'A_Total_' + c[3], {calc: 'sum'});
  });

  f('ec.none', 'B', 'No Executive Committee meeting held this month', 'bool', 'B_NoMeetingThisMonth', {helper: true});
  f('ec.reason', 'B', 'Reason no meeting was held', 'text', 'B_NoMeetingReason', {helper: true, req: 'cond', reqNote: 'Required if “No meeting held” is ticked', max: 300});
  /* Executive Committee meetings are a repeating group: see GROUPS.meetings */

  f('ots.prp', 'C', 'OTS Details – OTS PRP', 'int', 'C_OTS_PRP', {reqNote: 'Optional. Filled once: after a chapter saves it, every later CPR shows it locked (read-only)'});
  f('ots.monthCount', 'C', 'OTS Collection – Total Number of OTS: During the Month', 'int', 'C_OTS_Count_Month', {req: 'yes'});
  f('ots.ytdCount', 'C', 'OTS Collection – Total Number of OTS: Till Date (April onwards)', 'int', 'C_OTS_Count_TillDate', {calc: 'carry', req: 'cond', reqNote: 'Auto from last month; typed once if last month’s CPR is not in the system'});
  f('ots.monthAmt', 'C', 'OTS Collection – Amount Received ₹: During the Month', 'amount', 'C_OTS_Amount_Month', {req: 'yes'});
  f('ots.ytdAmt', 'C', 'OTS Collection – Amount Received ₹: Till Date (April onwards)', 'amount', 'C_OTS_Amount_TillDate', {calc: 'carry', req: 'cond', reqNote: 'Auto from last month; typed once if last month’s CPR is not in the system'});

  /* D | Donation & CSR Details (merged). Data keys of existing fields are kept. */
  f('donors.nonCsr', 'D', 'Non-CSR Donation – Number of Non-CSR Donors', 'int', 'D_NonCSR_Donors');
  f('fund.nonCsrMonth', 'D', 'Non-CSR Donation – Fund Received ₹: This Month', 'amount', 'D_NonCSR_Fund_Month');
  f('fund.nonCsrYtd', 'D', 'Non-CSR Donation – Fund Received ₹: Till Date', 'amount', 'D_NonCSR_Fund_TillDate', {calc: 'carry'});
  f('donors.csr', 'D', 'CSR Donation – Number of CSR Donors', 'int', 'D_CSR_Donors');
  f('csr.fundMonth', 'D', 'CSR Donation – Fund Received ₹: This Month', 'amount', 'D_CSR_Fund_Month');
  f('csr.fundYtd', 'D', 'CSR Donation – Fund Received ₹: Till Date', 'amount', 'D_CSR_Fund_TillDate', {calc: 'carry'});
  f('donors.total', 'D', 'Total – Total Number of Donors', 'int', 'D_Total_Donors', {calc: 'sum'});
  f('fund.totalMonth', 'D', 'Total – Total Fund Received ₹: This Month', 'amount', 'D_Total_Fund_Month', {calc: 'sum'});
  f('fund.totalYtd', 'D', 'Total – Total Fund Received ₹: Till Date', 'amount', 'D_Total_Fund_TillDate', {calc: 'sum'});
  f('csr.schools', 'D', 'Number of CSR Schools', 'int', 'D_CSRSchools');
  f('seva.genMonth', 'D', 'Other Donation Detail – General Donation ₹: This Month', 'amount', 'D_GeneralDonation_Month');
  f('seva.genYtd', 'D', 'Other Donation Detail – General Donation ₹: Till Date', 'amount', 'D_GeneralDonation_TillDate', {calc: 'carry'});
  f('seva.oceMonth', 'D', 'Other Donation Detail – One Child Education ₹: This Month', 'amount', 'D_OneChildEducation_Month');
  f('seva.oceYtd', 'D', 'Other Donation Detail – One Child Education ₹: Till Date', 'amount', 'D_OneChildEducation_TillDate', {calc: 'carry'});

  /* E | Sevapatra Boxes */
  f('seva.boxesMonth', 'E', 'Sevapatra Boxes – Boxes Placed: This Month', 'int', 'E_BoxesPlaced_Month');
  f('seva.boxesYtd', 'E', 'Sevapatra Boxes – Boxes Placed: Till Date', 'int', 'E_BoxesPlaced_TillDate', {calc: 'carry'});
  f('seva.amtMonth', 'E', 'Sevapatra Boxes – Amount Collected ₹: This Month', 'amount', 'E_AmountCollected_Month');
  f('seva.amtYtd', 'E', 'Sevapatra Boxes – Amount Collected ₹: Till Date', 'amount', 'E_AmountCollected_TillDate', {calc: 'carry'});

  f('invest.fd', 'F', 'Fixed Deposit (FD) ₹', 'amount', 'F_FixedDeposit');
  f('invest.rec', 'F', 'Recurring Investment ₹', 'amount', 'F_RecurringInvestment');
  f('invest.oth', 'F', 'Others ₹', 'amount', 'F_Others');
  f('invest.othNote', 'F', 'Others (Please Specify)', 'text', 'F_OthersSpecify', {req: 'cond', reqNote: 'Required if Others ₹ is more than 0', max: 200});
  f('invest.total', 'F', 'TOTAL Investment ₹', 'amount', 'F_TotalInvestment', {calc: 'sum'});
  f('invest.bank', 'F', 'Bank Balance in Account as on Date ₹', 'amount', 'F_BankBalance', {req: 'yes'});

  f('vy.monthCount', 'G', 'Number of Vanyatra – This Month', 'int', 'G_VanYatra_Month', {calc: 'count', note: 'Counted from the Vanyatra entries'});
  f('vy.ytdCount', 'G', 'Number of Vanyatra – Till Date (April onwards)', 'int', 'G_VanYatra_TillDate', {calc: 'carry', req: 'cond', reqNote: 'Auto: last month’s till date + this month; typed once if last month’s CPR is not in the system'});
  /* each Vanyatra is a repeating group: see GROUPS.vanyatras */

  f('checks.samagri.v', 'Annexure 2', 'Samagri reached to all schools (Yes/No)', 'yesno', 'X2_SamagriReached', {req: 'yes'});
  f('checks.samagri.reason', 'Annexure 2', 'Samagri – Reason / Remarks (if No)', 'text', 'X2_SamagriReason', {req: 'cond', reqNote: 'Required if answer is No', max: 300});
  f('checks.db.total', 'Annexure 2', 'Donor Board reached to all schools – Total Donor Boards', 'int', 'X2_DonorBoard_Total');
  f('checks.db.sent', 'Annexure 2', 'Donor Board reached to all schools – Already Sent', 'int', 'X2_DonorBoard_Sent', {reqNote: 'Cannot exceed Total'});
  f('checks.db.pending', 'Annexure 2', 'Donor Board reached to all schools – Pending', 'int', 'X2_DonorBoard_Pending', {calc: 'diff'});
  f('checks.db.reason', 'Annexure 2', 'Donor Board – Reason / Remarks', 'text', 'X2_DonorBoard_Reason', {req: 'cond', reqNote: 'Required if Pending is more than 0', max: 300});
  f('checks.cb.total', 'Annexure 2', 'CSR Donor Board reached to all schools – Total Donor Boards', 'int', 'X2_CSRDonorBoard_Total');
  f('checks.cb.sent', 'Annexure 2', 'CSR Donor Board reached to all schools – Already Sent', 'int', 'X2_CSRDonorBoard_Sent', {reqNote: 'Cannot exceed Total'});
  f('checks.cb.pending', 'Annexure 2', 'CSR Donor Board reached to all schools – Pending', 'int', 'X2_CSRDonorBoard_Pending', {calc: 'diff'});
  f('checks.cb.reason', 'Annexure 2', 'CSR Donor Board – Reason / Remarks', 'text', 'X2_CSRDonorBoard_Reason', {req: 'cond', reqNote: 'Required if Pending is more than 0', max: 300});
  f('checks.pr.v', 'Annexure 2', 'School Progress Report sent to CSR Donors (Yes/No)', 'yesno', 'X2_ProgressReportSent');
  f('checks.pr.date', 'Annexure 2', 'School Progress Report sent to CSR Donors – Date', 'date', 'X2_ProgressReportDate', {req: 'cond', reqNote: 'Required if answer is Yes'});
  f('checks.pr.reason', 'Annexure 2', 'School Progress Report – Reason / Remarks (if No)', 'text', 'X2_ProgressReportReason', {max: 300});
  f('monitoringAnchal', 'Annexure 2', 'Monitoring Anchal Name', 'multi', 'X2_MonitoringAnchal', {dyn: 'anchal'});

  var GROUPS = {
    meetings: {sheet: 'CPR_Meetings', sec: 'B', title: 'Executive Committee Meeting', max: 12, fields: [
      {key: 'committee', label: 'Meeting of (Chapter / Mahila Samiti / Yuva Samiti)', type: 'enum', options: JOINT_GROUPS, col: 'Committee', req: 'yes'},
      {key: 'date', label: 'Executive Committee Meeting Date', type: 'date', col: 'Meeting_Date', req: 'yes', reqNote: 'Must be in the report month'},
      {key: 'expected', label: 'Expected Members', type: 'int', col: 'Expected_Members', req: 'yes'},
      {key: 'attended', label: 'Members Attended', type: 'int', col: 'Members_Attended', req: 'yes', reqNote: 'Cannot exceed Expected Members'},
      {key: 'agenda', label: 'Key Agenda Points Discussed', type: 'textarea', col: 'Key_Agenda_Points', max: 3000},
      {key: 'outcome', label: 'Outcome (If Any)', type: 'textarea', col: 'Outcome', max: 2000}]},
    vanyatras: {sheet: 'CPR_Vanyatra', sec: 'G', title: 'Vanyatra', max: 20, fields: [
      {key: 'eid', label: 'Vanyatra ID', type: 'text', col: 'Vanyatra_ID', system: true},
      {key: 'by', label: 'Conducted By (Chapter / Mahila Samiti / Yuva Samiti / Jointly)', type: 'enum', options: VY_BY, col: 'Conducted_By', req: 'yes'},
      {key: 'date', label: 'Date', type: 'date', col: 'Vanyatra_Date', req: 'yes', reqNote: 'Must be in the report month'},
      {key: 'place', label: 'Where / Location Visited', type: 'text', col: 'Location_Visited', req: 'yes', max: 200},
      {key: 'days', label: 'Number of Days', type: 'int', col: 'Number_Of_Days', req: 'yes', reqNote: 'At least 1'},
      {key: 'photoIds', label: 'Photos – Drive File IDs', type: 'idlist', col: 'Photo_File_IDs', system: true, req: 'yes', reqNote: 'At least 2 photos per Vanyatra'},
      {key: 'photoUrls', label: 'Photos – Drive URLs', type: 'idlist', col: 'Photo_URLs', system: true}]},
    events: {sheet: 'CPR_Events', sec: 'Events', title: 'Events During the Month', max: 30, fields: [
      {key: 'eid', label: 'Event ID', type: 'text', col: 'Event_ID', system: true},
      {key: 'date', label: 'Event Date', type: 'date', col: 'Event_Date', req: 'yes', reqNote: 'Must be in the report month'},
      {key: 'by', label: 'Conducted By (Chapter / Mahila Samiti / Yuva Samiti / Joint)', type: 'enum', options: EVENT_BY, col: 'Conducted_By', req: 'yes'},
      {key: 'jointWith', label: 'Joint Participants', type: 'multi', options: JOINT_GROUPS, col: 'Joint_Participants', req: 'cond', reqNote: 'Required (two or more) when Conducted By is Joint'},
      {key: 'name', label: 'Event Name', type: 'text', col: 'Event_Name', req: 'yes', max: 200, dyn: 'event'},
      {key: 'nameOther', label: 'Please Specify Event Name', type: 'text', col: 'Event_Name_Other', req: 'cond', reqNote: 'Required when Event Name is Other', max: 200},
      {key: 'venue', label: 'Venue / Location', type: 'text', col: 'Venue', max: 200},
      {key: 'participants', label: 'No. of Participants', type: 'int', col: 'Participants'},
      {key: 'desc', label: 'Brief Description', type: 'textarea', col: 'Brief_Description', max: 2000},
      {key: 'impact', label: 'Impact / Outcome', type: 'textarea', col: 'Impact_Outcome', max: 2000},
      {key: 'photoIds', label: 'Photographs – Drive File IDs', type: 'idlist', col: 'Photo_File_IDs', system: true, req: 'yes', reqNote: 'Minimum 2, maximum 4 photographs per event'},
      {key: 'photoUrls', label: 'Photographs – Drive URLs', type: 'idlist', col: 'Photo_URLs', system: true}]},
    anchals: {sheet: 'CPR_Anchal', sec: 'Annexure 1', title: 'Annexure 1 – Disbursement to Anchal', max: 40, fields: [
      {key: 'name', label: 'Funding Anchal Name', type: 'text', col: 'Funding_Anchal_Name', req: 'yes', max: 150, dyn: 'anchal'},
      {key: 'acharyas', label: 'No. of Acharyas Paid During this Month', type: 'int', col: 'Acharyas_Paid_This_Month'},
      {key: 'paidUpto', label: 'Up to Which Month Paid', type: 'month', col: 'Paid_Up_To_Month'},
      {key: 'reportOn', label: 'Report When Received', type: 'date', col: 'Report_Received_On'},
      {key: 'remitDate', label: 'Remittance Date', type: 'date', col: 'Remittance_Date'},
      {key: 'tillLast', label: 'Total Remittance till Last Date ₹', type: 'amount', col: 'Total_Remittance_Till_Last', note: 'Filled from last month’s CPR (till last + remittance this month)'},
      {key: 'remitMonth', label: 'Remittance This Month ₹', type: 'amount', col: 'Remittance_This_Month'},
      {key: 'prpName', label: 'As per PRP – Anchal Name', type: 'text', col: 'PRP_Anchal_Name', max: 150, dyn: 'anchal'},
      {key: 'prpAcharyas', label: 'As per PRP – No. of Acharyas', type: 'int', col: 'PRP_No_Of_Acharyas'},
      {key: 'prpAmt', label: 'As per PRP – Amount (Rs.)', type: 'amount', col: 'PRP_Amount'}]},
    subs: {sheet: 'CPR_SubChapters', sec: 'Annexure 2', title: 'Details of Sub Chapter', max: 30, fields: [
      {key: 'name', label: 'Name of Sub Chapter', type: 'text', col: 'Sub_Chapter_Name', req: 'yes', max: 150},
      {key: 'members', label: 'No. of Members', type: 'int', col: 'No_Of_Members'},
      {key: 'ots', label: 'OTS Collected', type: 'number', col: 'OTS_Collected'}]}
  };

  var SECTIONS = [
    {id: 'hdr', l: '', t: 'Report Details', c: '#173B5E'},
    {id: 'A', l: 'A', t: 'Membership Data', c: '#1F4E79'},
    {id: 'B', l: 'B', t: 'Executive Committee Meeting Details', c: '#2E7D32'},
    {id: 'C', l: 'C', t: 'OTS Details & Collection', c: '#C8650A'},
    {id: 'D', l: 'D', t: 'Donation & CSR Details', c: '#A8164F'},
    {id: 'E', l: 'E', t: 'Sevapatra Boxes', c: '#5E4396'},
    {id: 'F', l: 'F', t: 'Investment (As on Date)', c: '#00695C'},
    {id: 'G', l: 'G', t: 'Van Yatra', c: '#7B4F26'},
    {id: 'EV', l: '', t: 'Events During the Month', c: '#34506A'},
    {id: 'X1', l: '', t: 'Annexure 1 – Disbursement to Anchal', c: '#475467'},
    {id: 'X2', l: '', t: 'Annexure 2 – Monthly Summary / Check Points', c: '#475467'}
  ];

  /* ---------------- small helpers ---------------- */
  function has(v) { if (Array.isArray(v)) return v.length > 0; return v !== undefined && v !== null && v !== ''; }
  function num(v) { if (typeof v === 'number') return isFinite(v) ? v : 0; var n = parseFloat(String(v == null ? '' : v).replace(/[,₹\s]/g, '')); return isFinite(n) ? n : 0; }
  function getP(o, p) { var ks = p.split('.'); for (var i = 0; i < ks.length; i++) { if (o == null) return undefined; o = o[ks[i]]; } return o; }
  function setP(o, p, v) { var ks = p.split('.'), a = o; for (var i = 0; i < ks.length - 1; i++) { if (a[ks[i]] === null || typeof a[ks[i]] !== 'object') a[ks[i]] = {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function isEmptyRow(o, ignore) { ignore = ignore || []; for (var k in (o || {})) if (ignore.indexOf(k) < 0 && has(o[k])) return false; return true; }
  function fmtIN(n, dec) {
    if (!has(n) || !isFinite(Number(n))) return '';
    n = Number(n); var neg = n < 0; n = Math.abs(n);
    var s = (dec === 0 ? Math.round(n) : round2(n)).toString(), parts = s.split('.'), x = parts[0];
    var last3 = x.slice(-3), rest = x.slice(0, -3);
    if (rest) last3 = ',' + last3;
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return (neg ? '-' : '') + rest + last3 + (parts[1] ? '.' + (parts[1].length === 1 ? parts[1] + '0' : parts[1]) : '');
  }
  function inr(n) { return has(n) ? '₹' + fmtIN(n) : ''; }
  function fmtDate(iso) { if (!iso) return ''; var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso)); if (!m) return String(iso); return m[3] + '/' + m[2] + '/' + m[1]; }
  function fmtMonth(ym) { var m = /^(\d{4})-(\d{2})$/.exec(String(ym || '')); return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function fieldByKey(k) { for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].key === k) return FIELDS[i]; return null; }

  /* ---------------- value checking / cleaning ---------------- */
  function splitList(v, sep) { return (Array.isArray(v) ? v : String(v == null ? '' : v).split(sep)).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(function (x) { return x !== ''; }); }
  function coerce(fd, v) {
    if (fd.type === 'datelist') {
      var arr = splitList(v, /\s*,\s*/), out = [], bad = false;
      arr.forEach(function (x) { var s = x.slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + 'T00:00:00Z'))) bad = true; else out.push(s); });
      return bad ? {v: out.slice(0, fd.maxItems || 400), err: 'contains an invalid date'} : {v: out.slice(0, fd.maxItems || 400)};
    }
    if (fd.type === 'multi') {
      var m = [], seen = {}, badm = false;
      splitList(v, /\s*;\s*/).forEach(function (x) { if (seen[x]) return; seen[x] = 1; if (fd.options && fd.options.indexOf(x) < 0) badm = true; else m.push(x.slice(0, 150)); });
      return badm ? {v: m, err: 'has a value that is not in the list'} : {v: m.slice(0, 20)};
    }
    if (fd.type === 'idlist') return {v: splitList(v, /\s*,\s*/).filter(function (x) { return /^[A-Za-z0-9_:\/.?=&%#-]{3,300}$/.test(x); }).slice(0, 10)};
    if (v === undefined || v === null) return {v: ''};
    if (typeof v === 'string') v = v.trim();
    if (v === '' && fd.type !== 'bool') return {v: ''};
    switch (fd.type) {
      case 'int': { var n = num(v); if (!/^-?[\d,.\s₹]+$/.test(String(v)) || n < 0 || Math.floor(n) !== n || n > 1e9) return {v: '', err: 'must be a whole number (0 or more)'}; return {v: n}; }
      case 'amount': case 'number': { var a = num(v); if (!/^-?[\d,.\s₹]+$/.test(String(v)) || a < 0 || a > 1e12) return {v: '', err: 'must be a number (0 or more)'}; return {v: round2(a)}; }
      case 'date': { var s2 = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s2) || isNaN(Date.parse(s2 + 'T00:00:00Z'))) return {v: '', err: 'must be a valid date'}; return {v: s2}; }
      case 'month': { var mm = String(v).slice(0, 7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mm)) return {v: '', err: 'must be a valid month'}; return {v: mm}; }
      case 'yesno': { var y = String(v).toLowerCase(); if (y !== 'yes' && y !== 'no') return {v: '', err: 'must be Yes or No'}; return {v: y}; }
      case 'enum': { if (fd.options.indexOf(String(v)) < 0) return {v: '', err: 'must be one of: ' + fd.options.join(', ')}; return {v: String(v)}; }
      case 'bool': return {v: v === true || v === 'true' || v === 'TRUE' || v === 'Yes'};
      case 'textarea': return {v: String(v).slice(0, fd.max || 3000)};
      default: return {v: String(v).replace(/[\r\n]+/g, ' ').slice(0, fd.max || 200)};
    }
  }
  /** Keep only known fields, in the right types. Returns {data, invalid:[{k,label,msg}]} */
  function normalize(input, opts) {
    opts = opts || {}; input = input || {};
    var out = {}, invalid = [];
    FIELDS.forEach(function (fd) {
      if (fd.system && !opts.keepSystem) return;
      var r = coerce(fd, getP(input, fd.key));
      if (r.err) invalid.push({k: fd.key, label: fd.label, msg: r.err});
      setP(out, fd.key, r.v);
    });
    Object.keys(GROUPS).forEach(function (g) {
      var G = GROUPS[g], rows = Array.isArray(input[g]) ? input[g].slice(0, G.max) : [];
      out[g] = [];
      rows.forEach(function (row, i) {
        var o = {};
        G.fields.forEach(function (fd) {
          if (fd.system && !opts.keepSystem && fd.key !== 'eid') return;
          var r = coerce(fd, row ? row[fd.key] : '');
          if (r.err) invalid.push({k: g + '.' + i + '.' + fd.key, label: G.title + ' ' + (i + 1) + ': ' + fd.label, msg: r.err});
          o[fd.key] = r.v;
        });
        if ((g === 'events' || g === 'vanyatras') && !/^[a-z0-9]{6,20}$/.test(String(o.eid || ''))) o.eid = '';
        if (!isEmptyRow(o, ['eid'])) out[g].push(o);
      });
    });
    return {data: out, invalid: invalid};
  }

  /* ---------------- calculations ---------------- */
  /** [till-date key, this-month key, April base key] */
  var CARRY = [
    ['mem.ch.total', 'mem.ch.new', 'mem.ch.opening'], ['mem.ms.total', 'mem.ms.new', 'mem.ms.opening'], ['mem.ys.total', 'mem.ys.new', 'mem.ys.opening'],
    ['ots.ytdCount', 'ots.monthCount'], ['ots.ytdAmt', 'ots.monthAmt'],
    ['csr.fundYtd', 'csr.fundMonth'], ['fund.nonCsrYtd', 'fund.nonCsrMonth'],
    ['seva.boxesYtd', 'seva.boxesMonth'], ['seva.amtYtd', 'seva.amtMonth'], ['seva.genYtd', 'seva.genMonth'], ['seva.oceYtd', 'seva.oceMonth'],
    ['vy.ytdCount', 'vy.monthCount']
  ];
  /** Filled once by the chapter, then locked (read-only) in every later month. */
  var LOCK_OPEN = ['mem.ch.opening', 'mem.ms.opening', 'mem.ys.opening', 'ots.prp'];
  /** Of those, the ones that never reopen: not in April, not after a missed month.
      For these, ctx.earlier (latest earlier CPR of the chapter that has the value, any FY) is used when last month has none. */
  var LOCK_FOREVER = ['ots.prp'];

  function lastDay(period) { var y = +period.slice(0, 4), m = +period.slice(5, 7); return period + '-' + pad2(new Date(Date.UTC(y, m, 0)).getUTCDate()); }
  /** "April 2026 – September 2026": what every “Till Date” means for this report. */
  function tillRange(fy, mNo) { return mNo === 4 ? 'April ' + fyStart(fy) : 'April ' + fyStart(fy) + ' – ' + periodLabel(fy, mNo); }
  function eventName(e) { if (!e) return ''; if (e.name === 'Other') return e.nameOther || 'Other'; return has(e.nameOther) ? e.name + ': ' + e.nameOther : (e.name || ''); }
  function eventBy(e) { return e && e.by === 'Joint' && has(e.jointWith) ? 'Joint (' + e.jointWith.join(' + ') + ')' : ((e && e.by) || ''); }

  /** ctx = {monthNo, prev: data of the previous month's CPR in the same FY (or null)}.
      Fills every calculated field in d. Returns {modes:{key:'calc'|'edit'}}. */
  function compute(d, ctx) {
    var prev = ctx.monthNo === 4 ? null : (ctx.prev || null), april = ctx.monthNo === 4, modes = {};
    setP(d, 'vy.monthCount', (d.vanyatras || []).length);   // this month = number of Vanyatra entries
    LOCK_OPEN.forEach(function (k) {
      var pv = prev ? getP(prev, k) : undefined;
      if (!has(pv) && ctx.earlier && LOCK_FOREVER.indexOf(k) >= 0) pv = getP(ctx.earlier, k);
      if (has(pv)) { setP(d, k, pv); modes[k] = 'calc'; } else modes[k] = 'edit';
    });
    CARRY.forEach(function (c) {
      var k = c[0], m = c[1], base = c[2], mv = getP(d, m), pv = prev ? getP(prev, k) : undefined;
      if (april) { var bv = base ? getP(d, base) : ''; modes[k] = 'calc'; setP(d, k, (has(mv) || has(bv)) ? round2(num(bv) + num(mv)) : ''); }
      else if (has(pv)) { modes[k] = 'calc'; setP(d, k, round2(num(pv) + num(mv))); }
      else modes[k] = 'edit';
    });
    ['opening', 'new', 'total', 'paidCount', 'paidAmt'].forEach(function (c) {
      var vals = MEM_ROWS.map(function (r) { return getP(d, 'mem.' + r[0] + '.' + c); });
      setP(d, 'memT.' + c, vals.some(has) ? round2(vals.reduce(function (a, v) { return a + num(v); }, 0)) : '');
    });
    var nc = getP(d, 'donors.nonCsr'), cs = getP(d, 'donors.csr');
    setP(d, 'donors.total', (has(nc) || has(cs)) ? num(nc) + num(cs) : '');
    [['fund.totalMonth', 'fund.nonCsrMonth', 'csr.fundMonth'], ['fund.totalYtd', 'fund.nonCsrYtd', 'csr.fundYtd']].forEach(function (t) {
      var a = getP(d, t[1]), b = getP(d, t[2]); setP(d, t[0], (has(a) || has(b)) ? round2(num(a) + num(b)) : '');
    });
    var inv = ['fd', 'rec', 'oth'].map(function (k) { return getP(d, 'invest.' + k); });
    setP(d, 'invest.total', inv.some(has) ? round2(inv.reduce(function (a, v) { return a + num(v); }, 0)) : '');
    if (getP(d, 'ec.none')) d.meetings = [];
    ['db', 'cb'].forEach(function (b) { var t = getP(d, 'checks.' + b + '.total'), s = getP(d, 'checks.' + b + '.sent'); setP(d, 'checks.' + b + '.pending', has(t) ? Math.max(0, num(t) - num(s)) : ''); });
    return {modes: modes};
  }

  /** Values to start a new CPR with, taken from earlier CPRs of the same chapter (never sample data). */
  function prefill(ctx) {
    var d = {meetings: [], vanyatras: [], events: [], anchals: [], subs: [], monitoringAnchal: []}, last = ctx.last || null;
    if (last) {
      d.cppName = last.cppName || '';
      d.ots = {prp: getP(last, 'ots.prp')};
      d.monitoringAnchal = (Array.isArray(last.monitoringAnchal) ? last.monitoringAnchal : []).slice();
      d.anchals = (last.anchals || []).filter(function (a) { return a && a.name; }).map(function (a) {
        return {name: a.name, prpName: a.prpName || '', prpAcharyas: a.prpAcharyas, prpAmt: a.prpAmt,
          tillLast: ctx.monthNo === 4 ? 0 : (ctx.lastIsPrev ? round2(num(a.tillLast) + num(a.remitMonth)) : '')};
      });
      d.subs = (last.subs || []).filter(function (s) { return s && s.name; }).map(function (s) { return {name: s.name}; });
    } else if (ctx.cppName) d.cppName = ctx.cppName;
    return d;
  }

  /** Returns a list of problems that block final submission: [{k, label}].
      ctx = {fy, monthNo, prev, lists:{cpp,anchal,event}, photoMin, photoMax} */
  function validate(d, ctx) {
    var errs = [], modes = compute(d, ctx).modes, period = periodOf(ctx.fy, ctx.monthNo), mLabel = periodLabel(ctx.fy, ctx.monthNo), Ls = ctx.lists || null;
    var first = period + '-01', last = lastDay(period), fyFirst = fyStart(ctx.fy) + '-04-01';
    function need(k, label) { if (!has(getP(d, k))) errs.push({k: k, label: label}); }
    function inMonth(iso) { return !!iso && iso >= first && iso <= last; }
    function inList(v, arr) { return arr.indexOf(v) >= 0; }
    need('cppName', 'Name of CPP');
    need('submissionDate', 'Submission Date');
    var sd = getP(d, 'submissionDate');
    if (has(sd) && sd < first) errs.push({k: 'submissionDate', label: 'Submission Date cannot be before ' + fmtDate(first)});
    if (has(sd) && ctx.today && sd > ctx.today) errs.push({k: 'submissionDate', label: 'Submission Date cannot be after today'});
    MEM_ROWS.forEach(function (r) {
      if (modes['mem.' + r[0] + '.opening'] === 'edit') need('mem.' + r[0] + '.opening', r[1] + ': Members as on 31st March (enter 0 if none)');
      need('mem.' + r[0] + '.new', r[1] + ': New members during the month (enter 0 if none)');
      if (modes['mem.' + r[0] + '.total'] === 'edit') need('mem.' + r[0] + '.total', r[1] + ': Total members till month end');
    });
    if (getP(d, 'ec.none')) need('ec.reason', 'Reason no Executive Committee meeting was held');
    else {
      var ms = d.meetings || [];
      if (!ms.length) errs.push({k: 'meetings.add', label: 'Executive Committee: add at least one meeting, or tick “No Executive Committee meeting was held this month”'});
      ms.forEach(function (m, i) {
        var p = 'meetings.' + i + '.', n = 'Meeting ' + (i + 1) + ': ';
        need(p + 'committee', n + 'choose Chapter, Mahila Samiti or Yuva Samiti'); need(p + 'date', n + 'Executive Committee Meeting Date'); need(p + 'expected', n + 'Expected Members'); need(p + 'attended', n + 'Members Attended');
        if (has(m.date) && !inMonth(m.date)) errs.push({k: p + 'date', label: n + 'date is not in ' + mLabel});
        if (has(m.attended) && has(m.expected) && num(m.attended) > num(m.expected)) errs.push({k: p + 'attended', label: n + 'Members Attended cannot be more than Expected Members'});
      });
    }
    need('ots.monthCount', 'Total Number of OTS during the month (enter 0 if none)');
    need('ots.monthAmt', 'OTS Amount Received during the month (enter 0 if none)');
    if (modes['ots.ytdCount'] === 'edit') need('ots.ytdCount', 'Total Number of OTS till date');
    if (modes['ots.ytdAmt'] === 'edit') need('ots.ytdAmt', 'OTS Amount Received till date');
    if (num(getP(d, 'invest.oth')) > 0) need('invest.othNote', 'Investment: please specify “Others”');
    need('invest.bank', 'Bank Balance in Account as on Date');
    // Vanyatra
    var vm = getP(d, 'vy.monthCount'), vy = getP(d, 'vy.ytdCount'), vMin = ctx.vyPhotoMin == null ? 2 : ctx.vyPhotoMin;
    if (modes['vy.ytdCount'] === 'edit') need('vy.ytdCount', 'Number of Vanyatra – Till Date (enter 0 if none)');
    if (has(vm) && has(vy) && num(vy) < num(vm)) errs.push({k: 'vy.ytdCount', label: 'Vanyatra: till date cannot be less than this month'});
    (d.vanyatras || []).forEach(function (v, i) {
      var p = 'vanyatras.' + i + '.', n = 'Vanyatra ' + (i + 1) + ': ';
      need(p + 'by', n + 'Conducted By'); need(p + 'date', n + 'Date'); need(p + 'place', n + 'Where / Location Visited'); need(p + 'days', n + 'Number of Days');
      if (has(v.date) && !inMonth(v.date)) errs.push({k: p + 'date', label: n + 'date is not in ' + mLabel});
      if (has(v.days) && num(v.days) < 1) errs.push({k: p + 'days', label: n + 'Number of Days must be at least 1'});
      var pc = (v.photoIds || []).length;
      if (vMin > 0 && pc < vMin) errs.push({k: p + 'photos', label: n + 'upload at least ' + vMin + ' photos (' + pc + ' uploaded)'});
    });
    need('checks.samagri.v', 'Samagri reached to all schools: choose Yes or No');
    if (getP(d, 'checks.samagri.v') === 'no') need('checks.samagri.reason', 'Reason samagri has not reached all schools');
    [['db', 'Donor boards'], ['cb', 'CSR donor boards']].forEach(function (b) {
      if (has(getP(d, 'checks.' + b[0] + '.total')) && num(getP(d, 'checks.' + b[0] + '.sent')) > num(getP(d, 'checks.' + b[0] + '.total'))) errs.push({k: 'checks.' + b[0] + '.sent', label: b[1] + ': already sent cannot be more than total'});
      if (num(getP(d, 'checks.' + b[0] + '.pending')) > 0) need('checks.' + b[0] + '.reason', b[1] + ': reason for pending boards');
    });
    if (getP(d, 'checks.pr.v') === 'yes') need('checks.pr.date', 'Date the School Progress Report was sent to CSR donors');
    var pMin = ctx.photoMin == null ? 2 : ctx.photoMin;
    (d.events || []).forEach(function (e, i) {
      var p = 'events.' + i + '.', n = 'Event ' + (i + 1) + ': ';
      need(p + 'date', n + 'Event Date'); need(p + 'by', n + 'Conducted By'); need(p + 'name', n + 'Event Name');
      if (has(e.date) && !inMonth(e.date)) errs.push({k: p + 'date', label: n + 'date is not in ' + mLabel});
      if (e.by === 'Joint' && (e.jointWith || []).length < 2) errs.push({k: p + 'jointWith', label: n + 'Joint: select at least two participating groups'});
      if (e.name === 'Other' || (ctx.eventSpecify || []).indexOf(e.name) >= 0) need(p + 'nameOther', n + 'Please Specify Event Name');
      if (e.name !== 'Other' && Ls && has(e.name) && !inList(e.name, Ls.event)) errs.push({k: p + 'name', label: n + 'Event Name: choose from the list'});
      var pc = (e.photoIds || []).length;
      if (pMin > 0 && pc < pMin) errs.push({k: p + 'photos', label: n + 'upload at least ' + pMin + ' photographs (' + pc + ' uploaded)'});
      if (ctx.photoMax && pc > ctx.photoMax) errs.push({k: p + 'photos', label: n + 'at most ' + ctx.photoMax + ' photographs are allowed'});
    });
    var seenA = {};
    (d.anchals || []).forEach(function (a, i) {
      need('anchals.' + i + '.name', 'Annexure 1, row ' + (i + 1) + ': Funding Anchal name');
      if (has(a.name)) {
        if (Ls && !inList(a.name, Ls.anchal)) errs.push({k: 'anchals.' + i + '.name', label: 'Annexure 1, row ' + (i + 1) + ': Funding Anchal name: choose from the list'});
        if (seenA[a.name]) errs.push({k: 'anchals.' + i + '.name', label: 'Annexure 1, row ' + (i + 1) + ': ' + a.name + ' is entered twice'}); seenA[a.name] = 1;
      }
      if (Ls && has(a.prpName) && !inList(a.prpName, Ls.anchal)) errs.push({k: 'anchals.' + i + '.prpName', label: 'Annexure 1, row ' + (i + 1) + ': As per PRP Anchal name: choose from the list'});
    });
    if (Ls) (d.monitoringAnchal || []).forEach(function (x) { if (!inList(x, Ls.anchal)) errs.push({k: 'monitoringAnchal.0', label: 'Monitoring Anchal Name: choose from the list (' + x + ' is not in it)'}); });
    (d.subs || []).forEach(function (s, i) {
      need('subs.' + i + '.name', 'Sub chapter ' + (i + 1) + ': name');
      if (Ls && Ls.sub && Ls.sub.length && has(s.name) && !inList(s.name, Ls.sub)) errs.push({k: 'subs.' + i + '.name', label: 'Sub chapter ' + (i + 1) + ': choose the name from the list'});
    });
    return errs;
  }

  /* ---------------- printable CPR (used for screen view and the PDF) ---------------- */
  var B = 'border:1px solid #9AA9B9;padding:4px 6px;';
  function th(t, al) { return '<th style="' + B + 'background:#DDEBF7;font-size:9pt;text-align:' + (al || 'left') + ';vertical-align:bottom">' + t + '</th>'; }
  function td(t, al, bold) { return '<td style="' + B + 'font-size:9.5pt;text-align:' + (al || 'left') + ';vertical-align:top' + (bold ? ';font-weight:bold;background:#F1F5F9' : '') + '">' + (t === '' || t == null ? '&nbsp;' : t) + '</td>'; }
  function table(heads, rows, aligns, foot) {
    return '<table style="border-collapse:collapse;width:100%;margin:4px 0 8px">' + '<tr>' + heads.map(function (h, i) { return th(h, aligns && aligns[i]); }).join('') + '</tr>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return td(c, aligns && aligns[i]); }).join('') + '</tr>'; }).join('') +
      (foot ? '<tr>' + foot.map(function (c, i) { return td(c, aligns && aligns[i], true); }).join('') + '</tr>' : '') + '</table>';
  }
  function band(s) { var S = SECTIONS.filter(function (x) { return x.id === s; })[0]; return '<div style="background:' + S.c + ';color:#fff;font-weight:bold;font-size:10.5pt;padding:5px 8px;margin-top:10px">' + (S.l ? S.l + ' | ' : '') + esc(S.t.toUpperCase()) + '</div>'; }
  function sub(t, c) { return '<div style="color:' + c + ';font-weight:bold;font-size:10pt;margin:6px 0 2px">' + t + '</div>'; }
  function pctOf(a, e) { return num(e) > 0 && has(a) ? (Math.round(num(a) / num(e) * 1000) / 10) + '%' : ''; }

  /** rep = {chapterName, chapterId, fy, monthNo, statusLabel, reportId, data, submittedOn, generatedOn, watermark} */
  function reportHtml(rep) {
    var d = rep.data || {}, g = function (k) { return getP(d, k); }, N = function (k) { return esc(fmtIN(g(k))); }, R = function (k) { return esc(inr(g(k))); }, T = function (k) { return esc(g(k) || ''); };
    var fy = rep.fy, y31 = fyStart(fy), till = 'Till Date (' + tillRange(fy, rep.monthNo) + ')', R_ = ['left', 'right', 'right', 'right', 'right', 'right', 'left'];
    var yn = function (v) { return v === 'yes' ? 'Yes' : v === 'no' ? 'No' : ''; };
    var dl = function (k) { return esc((g(k) || []).map(fmtDate).join(', ')); };
    var h = [];
    h.push('<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:780px;margin:0 auto">');
    if (rep.watermark) h.push('<div style="border:2px dashed #B42318;color:#B42318;text-align:center;font-weight:bold;padding:4px;margin-bottom:6px">' + esc(rep.watermark) + '</div>');
    h.push('<table style="border-collapse:collapse;width:100%;margin-bottom:4px"><tr><td style="' + B + 'width:22%;font-size:9pt;font-weight:bold;color:#173B5E">Friends of Tribals Society</td><td style="' + B + 'text-align:center;font-size:15pt;font-weight:bold;color:#1F4E79">CHAPTER PERFORMANCE REPORT (CPR)</td></tr></table>');
    h.push('<table style="border-collapse:collapse;width:100%">' +
      '<tr>' + th('Chapter Name') + td('<b>' + esc(rep.chapterName) + '</b>' + (rep.chapterId ? ' (' + esc(rep.chapterId) + ')' : '')) + th('For the Month of') + td('<b>' + esc(periodLabel(fy, rep.monthNo)) + '</b> (FY ' + esc(fy) + ')') + '</tr>' +
      '<tr>' + th('Name of CPP') + td(T('cppName')) + th('Submission Date') + td(esc(fmtDate(g('submissionDate')))) + '</tr></table>');

    h.push(band('A'));
    h.push(table(['Particulars', 'Members as on 31st March ' + y31, 'During the Month (New Members)', 'Total Members (Till Month End ' + fy + ')', 'Membership Amt Recd: No. of Members', 'Membership Amt Recd: Amount (₹)', 'Remarks / Break-up'],
      MEM_ROWS.map(function (r) { var p = 'mem.' + r[0] + '.'; return [r[1], N(p + 'opening'), N(p + 'new'), N(p + 'total'), N(p + 'paidCount'), R(p + 'paidAmt'), T(p + 'remarks')]; }), R_,
      ['TOTAL', N('memT.opening'), N('memT.new'), N('memT.total'), N('memT.paidCount'), R('memT.paidAmt'), '']));

    h.push(band('B'));
    var ms = d.meetings || [];
    if (g('ec.none')) h.push('<p style="font-size:9.5pt;margin:6px 0"><b>No Executive Committee meeting was held this month.</b> Reason: ' + T('ec.reason') + '</p>');
    else h.push(ms.length ? table(['Meeting', 'Meeting of', 'Executive Committee Meeting Date', 'Expected Members', 'Members Attended', 'Key Agenda Points Discussed', 'Outcome (If Any)'],
      ms.map(function (m, i) { return [String(i + 1), esc(m.committee || ''), esc(fmtDate(m.date)), esc(fmtIN(m.expected)), esc(fmtIN(m.attended)), esc(m.agenda || '').replace(/\n/g, '<br>'), esc(m.outcome || '').replace(/\n/g, '<br>')]; }),
      ['center', 'left', 'left', 'right', 'right', 'left', 'left']) : '<p style="font-size:9.5pt;margin:6px 0">No meeting reported.</p>');

    h.push(band('C'));
    h.push(sub('OTS DETAILS', '#C8650A') + table(['OTS PRP'], [[N('ots.prp')]], ['right']));
    h.push(sub('OTS COLLECTION', '#C8650A') + table(['Particulars', 'During the Month', till], [['Total Number of OTS', N('ots.monthCount'), N('ots.ytdCount')], ['Amount Received (₹)', R('ots.monthAmt'), R('ots.ytdAmt')]], ['left', 'right', 'right']));

    h.push(band('D'));
    h.push(table(['Particulars', 'Number of Donors', 'Fund Received – This Month (₹)', 'Fund Received – Till Date (₹)'], [
      ['Non-CSR', N('donors.nonCsr'), R('fund.nonCsrMonth'), R('fund.nonCsrYtd')],
      ['CSR', N('donors.csr'), R('csr.fundMonth'), R('csr.fundYtd')]], ['left', 'right', 'right', 'right'],
      ['Total', N('donors.total'), R('fund.totalMonth'), R('fund.totalYtd')]));
    h.push(table(['Number of CSR Schools'], [[N('csr.schools')]], ['right']));
    h.push(sub('OTHER DONATION DETAIL', '#A8164F') + table(['Particulars', 'This Month (₹)', 'Till Date (₹)'], [['General Donation', R('seva.genMonth'), R('seva.genYtd')], ['One Child Education', R('seva.oceMonth'), R('seva.oceYtd')]], ['left', 'right', 'right']));

    h.push(band('E'));
    h.push(table(['Particulars', 'This Month', 'Till Date'], [['Boxes Placed', N('seva.boxesMonth'), N('seva.boxesYtd')], ['Amount Collected (₹)', R('seva.amtMonth'), R('seva.amtYtd')]], ['left', 'right', 'right']));

    h.push(band('F'));
    h.push(table(['Particulars', 'Amount Invested (₹)'], [['Fixed Deposit (FD)', R('invest.fd')], ['Recurring Investment', R('invest.rec')], ['Others' + (g('invest.othNote') ? ' (' + T('invest.othNote') + ')' : ' (Please Specify)'), R('invest.oth')]], ['left', 'right'], ['TOTAL', R('invest.total')]));
    h.push(table(['Bank Balance in Account as on Date (₹)'], [[R('invest.bank')]], ['right']));

    h.push(band('G'));
    h.push(table(['Number of Vanyatra – This Month', 'Number of Vanyatra – ' + esc(till)], [[N('vy.monthCount'), N('vy.ytdCount')]], ['right', 'right']));
    var vys = d.vanyatras || [];
    h.push(vys.length ? table(['No.', 'Conducted By', 'Date', 'Where / Location Visited', 'Number of Days', 'Photos'],
      vys.map(function (v, i) { return [String(i + 1), esc(v.by || ''), esc(fmtDate(v.date)), esc(v.place || ''), esc(fmtIN(v.days)), String((v.photoIds || []).length)]; }),
      ['center', 'left', 'left', 'left', 'right', 'right']) : '<p style="font-size:9.5pt;margin:6px 0">No Vanyatra this month.</p>');

    h.push(band('EV'));
    var ev = d.events || [];
    h.push(ev.length ? table(['No.', 'Event Date', 'Conducted By', 'Event Name', 'Venue / Location', 'No. of Participants', 'Brief Description', 'Impact / Outcome', 'Photos'],
      ev.map(function (e, i) { return [String(i + 1), esc(fmtDate(e.date)), esc(eventBy(e)), esc(eventName(e)), esc(e.venue || ''), esc(fmtIN(e.participants)), esc(e.desc || '').replace(/\n/g, '<br>'), esc(e.impact || '').replace(/\n/g, '<br>'), String((e.photoIds || []).length)]; }),
      ['center', 'left', 'left', 'left', 'left', 'right', 'left', 'left', 'right']) : '<p style="font-size:9.5pt;margin:6px 0">No events reported.</p>');

    h.push(band('X1'));
    var an = d.anchals || [], sum = function (k) { return an.reduce(function (a, x) { return a + num(x[k]); }, 0); };
    h.push(an.length ? table(['Funding Anchal Name', 'No. of Acharyas Paid this Month', 'Up to Which Month Paid', 'Report When Received', 'Remittance Date', 'Total Remittance till Last Date', 'Remittance This Month', 'PRP: Anchal Name', 'PRP: No. of Acharyas', 'PRP: Amount (Rs.)'],
      an.map(function (a) { return [esc(a.name), esc(fmtIN(a.acharyas)), esc(fmtMonth(a.paidUpto)), esc(fmtDate(a.reportOn)), esc(fmtDate(a.remitDate)), esc(inr(a.tillLast)), esc(inr(a.remitMonth)), esc(a.prpName || ''), esc(fmtIN(a.prpAcharyas)), esc(inr(a.prpAmt))]; }),
      ['left', 'right', 'left', 'left', 'left', 'right', 'right', 'left', 'right', 'right'],
      ['TOTAL', esc(fmtIN(sum('acharyas'))), '', '', '', esc(inr(sum('tillLast'))), esc(inr(sum('remitMonth'))), '', esc(fmtIN(sum('prpAcharyas'))), esc(inr(sum('prpAmt')))]) : '<p style="font-size:9.5pt;margin:6px 0">No disbursement entered.</p>');

    h.push(band('X2'));
    h.push(table(['Particulars', 'Yes / No', 'Reason / Remarks (if No)'], [['Samagri reached to all schools', yn(g('checks.samagri.v')), T('checks.samagri.reason')]], ['left', 'center', 'left']));
    h.push(sub('Donor Board Details', '#475467') + table(['Particulars', 'Total Donor Boards', 'Already Sent', 'Pending', 'Reason / Remarks'],
      [['Donor Board reached to all schools', N('checks.db.total'), N('checks.db.sent'), N('checks.db.pending'), T('checks.db.reason')],
       ['CSR Donor Board reached to all schools', N('checks.cb.total'), N('checks.cb.sent'), N('checks.cb.pending'), T('checks.cb.reason')],
       ['School Progress Report sent to CSR Donors', yn(g('checks.pr.v')) + (g('checks.pr.date') ? ', ' + esc(fmtDate(g('checks.pr.date'))) : ''), '', '', T('checks.pr.reason')]], ['left', 'right', 'right', 'right', 'left']));
    var subs = d.subs || [];
    h.push(sub('Details of Sub Chapter', '#475467') + (subs.length ? table(['Name of Sub Chapter', 'No. of Members', 'OTS Collected'], subs.map(function (s) { return [esc(s.name), esc(fmtIN(s.members)), esc(fmtIN(s.ots))]; }), ['left', 'right', 'right']) : '<p style="font-size:9.5pt;margin:2px 0 6px">None.</p>'));
    h.push('<p style="font-size:9.5pt;margin:4px 0"><b>Monitoring Anchal Name:</b> ' + esc((g('monitoringAnchal') || []).join(', ')) + '</p>');

    h.push('<table style="border-collapse:collapse;width:100%;margin-top:26px"><tr>' +
      ['Name of CPP', 'Secretary', 'President'].map(function (r, i) { return '<td style="width:33%;padding:0 10px;vertical-align:bottom;font-size:9.5pt"><div style="height:46px"></div><div style="border-top:1px solid #111;padding-top:3px"><b>' + r + '</b><br>' + (i === 0 ? T('cppName') : 'Name: ') + '<br>Signature &amp; Date</div></td>'; }).join('') + '</tr></table>');
    h.push('<div style="margin-top:14px;font-size:8pt;color:#555;border-top:1px solid #ccc;padding-top:4px">Report ID: ' + esc(rep.reportId) + (rep.statusLabel ? ' | Status: ' + esc(rep.statusLabel) : '') + (rep.submittedOn ? ' | Submitted on: ' + esc(rep.submittedOn) : '') + (rep.generatedOn ? ' | Generated: ' + esc(rep.generatedOn) : '') + '</div>');
    h.push('</div>');
    return h.join('');
  }

  /** Columns for Excel/CSV export: [{key, col, label}] */
  function exportColumns() { return FIELDS.map(function (fd) { return {key: fd.key, col: fd.col, label: fd.sec + ' | ' + fd.label}; }); }

  return {
    VERSION: '1.0.0', MONTHS: MONTHS, FY_MONTH_NOS: FY_MONTH_NOS, STATUS: STATUS, STATUS_LABEL: STATUS_LABEL, EDITABLE: EDITABLE, SUBMITTED: SUBMITTED, SIGNED: SIGNED,
    REPORT_TYPES: REPORT_TYPES, EVENT_BY: EVENT_BY, FIELDS: FIELDS, GROUPS: GROUPS, SECTIONS: SECTIONS, MEM_ROWS: MEM_ROWS, CARRY: CARRY, LOCK_OPEN: LOCK_OPEN, LOCK_FOREVER: LOCK_FOREVER,
    pad2: pad2, isFy: isFy, fyStart: fyStart, fyOfPeriod: fyOfPeriod, periodOf: periodOf, monthName: monthName, isMonthNo: isMonthNo, prevMonthNo: prevMonthNo,
    periodLabel: periodLabel, reportId: reportId, parseReportId: parseReportId, addMonthsToPeriod: addMonthsToPeriod,
    has: has, num: num, getP: getP, setP: setP, isEmptyRow: isEmptyRow, fmtIN: fmtIN, inr: inr, fmtDate: fmtDate, fmtMonth: fmtMonth, esc: esc, fieldByKey: fieldByKey,
    coerce: coerce, normalize: normalize, compute: compute, prefill: prefill, validate: validate, reportHtml: reportHtml, exportColumns: exportColumns, JOINT_GROUPS: JOINT_GROUPS, VY_BY: VY_BY, tillRange: tillRange, lastDay: lastDay, eventName: eventName, eventBy: eventBy
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CPR;
