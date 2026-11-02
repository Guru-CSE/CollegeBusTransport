const byId = id => document.getElementById(id);
const loginView = byId('login-view');
const workspaceView = byId('workspace-view');
const messageBox = byId('global-message');
const workspace = byId('workspace-content');
const state = { user:null, tab:'overview', reader:null, scanControls:null, scanTimer:null, poll:null, students:[], scans:[], scanFilter:'all', studentFilter:'all', searchTimer:null, verifying:false };

async function api(url, options = {}) {
  const response = await fetch(url, { credentials:'same-origin', ...options, headers:{ ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function showMessage(text, type='info') { messageBox.textContent=text; messageBox.className=`notice ${type}`; messageBox.classList.remove('hidden'); }
function hideMessage() { messageBox.classList.add('hidden'); }
function dateTime(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(); }
function roleName(role) { return role === 'bus_staff' ? 'Bus staff' : role === 'staff_passenger' ? 'Staff passenger' : role[0].toUpperCase()+role.slice(1); }

async function start() {
  try {
    const health = await api('/api/health');
    byId('connection-pill').textContent = health.ok ? 'DATABASE READY' : 'DATABASE ISSUE';
    byId('connection-pill').classList.toggle('online', !!health.ok);
  } catch { byId('connection-pill').textContent='SERVER UNAVAILABLE'; }
  try { const {user} = await api('/api/me'); if (user) enterWorkspace(user); } catch { /* Login view remains available. */ }
}

byId('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = byId('login-error');
  const button = form.querySelector('button[type=submit]');
  error.textContent=''; button.disabled=true; button.textContent='Signing in…';
  try {
    const result = await api('/api/login', {method:'POST',body:JSON.stringify({role:byId('login-role').value,username:byId('username').value,password:byId('password').value})});
    form.reset(); enterWorkspace(result.user);
  } catch (err) { error.textContent=err.message; }
  finally { button.disabled=false; button.innerHTML='Sign in <span aria-hidden="true">→</span>'; }
});
byId('show-registration').addEventListener('click',()=>{byId('login-form').classList.add('hidden');byId('registration-form').classList.remove('hidden');byId('status-form').classList.add('hidden');loadRegistrationRoutes();});
byId('show-login').addEventListener('click',()=>{byId('registration-form').classList.add('hidden');byId('status-form').classList.remove('hidden');byId('login-form').classList.remove('hidden');});
byId('registration-form').elements.role.addEventListener('change',e=>{const student=e.target.value==='student';byId('registration-id-label').firstChild.textContent=student?'Student roll number':'Staff ID';byId('study-year').classList.toggle('hidden',!student);byId('study-year').querySelector('input').required=student;});
async function loadRegistrationRoutes(){try{const d=await api('/api/registration/routes');byId('registration-route').innerHTML='<option value="">Choose a route</option>'+d.routes.map(r=>`<option value="${r.id}">${escapeHtml(r.route_name)}</option>`).join('');}catch(e){byId('registration-route').innerHTML='<option value="">Routes unavailable</option>';}}
byId('registration-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,d=Object.fromEntries(new FormData(f));const error=byId('registration-error');error.textContent='';if(d.password!==d.confirmPassword){error.textContent='Passwords do not match.';return;}try{const result=await api('/api/register',{method:'POST',body:JSON.stringify({...d,routeId:Number(d.routeId),yearOfStudy:Number(d.yearOfStudy)})});f.reset();showMessage(`${result.message} Save your ID to check the application status.`,'success');byId('status-form').elements.username.value=result.username;byId('status-form').classList.remove('hidden');byId('registration-form').classList.add('hidden');byId('login-form').classList.remove('hidden');}catch(err){error.textContent=err.message;}});
byId('status-form').addEventListener('submit',async e=>{e.preventDefault();const target=byId('status-result');target.textContent='';try{const d=await api(`/api/registration/status/${encodeURIComponent(e.currentTarget.elements.username.value)}`),r=d.request;target.textContent=`${r.status}${r.rejection_reason?`: ${r.rejection_reason}`:''}`;target.className=r.status==='Approved'?'success-text':r.status==='Rejected'?'error-text':'muted';}catch(err){target.textContent=err.message;target.className='error-text';}});

document.querySelectorAll('input[type="password"]').forEach(input=>{const toggle=document.createElement('span');toggle.className='password-toggle';toggle.innerHTML='<input type="checkbox"><span>Show password</span>';toggle.querySelector('input').addEventListener('change',e=>{input.type=e.target.checked?'text':'password';});input.insertAdjacentElement('afterend',toggle);});
document.addEventListener('click',event=>{const button=event.target.closest('.decision-form button[name="action"]');if(!button)return;const form=button.form,reject=button.value==='reject';for(const name of ['busId','stopId']){const field=form.elements[name],label=field.closest('label');field.required=!reject;label.classList.toggle('hidden',reject);}form.elements.reason.required=reject;});

byId('logout-button').addEventListener('click', async () => {
  stopScanner(); clearInterval(state.poll); state.user=null;
  try { await api('/api/logout',{method:'POST'}); } catch { /* Clear the local screen even if the server went away. */ }
  byId('logout-button').classList.add('hidden'); byId('signed-in-as').classList.add('hidden');
  workspaceView.classList.add('hidden'); loginView.classList.remove('hidden'); byId('status-form').elements.username.value=''; byId('status-result').textContent=''; byId('status-result').className=''; byId('status-form').classList.remove('hidden'); hideMessage();
});

function enterWorkspace(user) {
  state.user=user; state.tab=user.role === 'student' ? 'overview' : user.role === 'admin' ? 'dashboard' : user.role === 'staff_passenger' ? 'staff-info' : 'verify';
  byId('status-form').elements.username.value=''; byId('status-result').textContent=''; byId('status-result').className=''; byId('status-form').classList.add('hidden');
  loginView.classList.add('hidden'); workspaceView.classList.remove('hidden');
  byId('signed-in-as').textContent=`${user.username} · ${roleName(user.role)}`;
  byId('signed-in-as').classList.remove('hidden'); byId('logout-button').classList.remove('hidden');
  byId('role-label').textContent=`${roleName(user.role).toUpperCase()} WORKSPACE`;
  byId('page-title').textContent=user.role==='student' ? 'My transport' : user.role==='admin' ? 'Transport overview' : user.role==='staff_passenger' ? 'Staff transport account' : 'Student verification';
  drawTabs(); renderTab();
  clearInterval(state.poll);
  if (user.role==='admin') { refreshAdmin(); state.poll=setInterval(()=>{if(state.tab==='dashboard')refreshAdmin();},5000); }
  if (user.role==='bus_staff') { refreshScans(); state.poll=setInterval(refreshScans,5000); }
}

function drawTabs() {
  const tabs=state.user.role==='admin' ? [['dashboard','Overview'],['admin-requests','Registration requests'],['admin-test','Scan / verify'],['admin-staff','Staff fees']] : state.user.role==='bus_staff' ? [['verify','Scan / verify']] : state.user.role==='staff_passenger' ? [['staff-info','My staff fees']] : [['overview','My fees']];
  byId('role-nav').innerHTML=tabs.map(([id,label])=>`<button type="button" class="tab ${state.tab===id?'active':''}" data-tab="${id}">${label}</button>`).join('');
  byId('role-nav').classList.toggle('hidden',tabs.length<=1);
  byId('role-nav').querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{stopScanner();state.tab=button.dataset.tab;if(state.user.role==='admin')byId('page-title').textContent=state.tab==='dashboard'?'Transport overview':state.tab==='admin-staff'?'Staff fees':state.tab==='admin-requests'?'Registration requests':'Shared ID scanner';drawTabs();renderTab();}));
}

function renderTab() {
  stopScanner(); hideMessage();
  if (state.user.role==='student') return renderStudent();
  if (state.user.role==='staff_passenger') return renderStaffPortal();
  if (state.user.role==='admin' && state.tab==='admin-staff') return renderAdminStaff();
  if (state.user.role==='admin' && state.tab==='admin-requests') return renderRegistrationRequests();
  if (state.user.role==='admin' && state.tab==='admin-test') return renderVerifier({admin:true});
  if (state.user.role==='bus_staff') return renderVerifier();
  return renderAdmin();
}

function renderVerifier({admin=false}={}) {
  const history=admin ? '' : `<section class="card history-card"><div class="section-head"><div><div class="eyebrow">RECENT ACTIVITY</div><h2>Verification history</h2></div><span id="history-updated" class="muted small">Updating every 5 seconds</span></div><div id="scan-history" class="table-wrap"></div></section>`;
  workspace.innerHTML=`<div class="two-col"><section class="card verify-card"><div class="section-head"><div><div class="eyebrow">${admin?'ADMIN · MANUAL TEST':'BOARDING CHECK'}</div><h2>Verify transport status</h2></div><span class="mini-badge">${admin?'TEST TOOL':'BUS STAFF'}</span></div>
    <p class="muted">Scan a student or staff ID barcode, or enter it manually. Student rolls use six digits; staff IDs look like STF001.</p>
    <div class="camera-frame"><video id="camera-video" muted playsinline></video><div id="camera-placeholder" class="camera-placeholder"><span class="camera-icon" aria-hidden="true"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l1.5-2h7L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.5"/><path d="M8 9h.01"/></svg></span><b>Camera scan</b><span>Supports common 1D and 2D barcode formats.</span></div></div>
    <div id="scanner-message" class="small muted" role="status">Camera access requires permission and may require HTTPS on a phone.</div>
    <div class="button-row"><button id="start-camera" class="button secondary" type="button">Start camera</button><button id="stop-camera" class="button ghost" type="button" disabled>Stop</button><button id="use-decoded" class="button primary hidden" type="button">Use decoded code</button></div>
    <div class="divider"><span>OR ENTER MANUALLY</span></div>
    <form id="verify-form"><label for="roll-input">Student roll number or staff ID</label><div class="input-action"><input id="roll-input" maxlength="20" autocomplete="off" placeholder="e.g. 680377 or STF001" required><button class="button primary" type="submit">Verify / board</button></div></form>
    <div id="verify-result" class="result-slot" aria-live="polite"></div></section>
    <aside class="card side-card"><div class="eyebrow">SCANNER NOTES</div><h3>Barcode and QR support</h3><p>ZXing checks common linear formats such as Code 128, Code 39, Code 93, ITF, Codabar and EAN/UPC, plus QR, Data Matrix, Aztec and PDF417.</p><p class="muted">A six-digit decoded value such as 680377 is accepted. The college ID’s exact barcode format is not confirmed; check the decoded value before submitting. If the value is wrong or unreadable, enter the roll manually or request manual review.</p><div class="privacy-note">Camera frames stay in this browser and are not uploaded or saved.</div></aside></div>${history}`;
  byId('verify-form').addEventListener('submit',submitVerification);
  byId('start-camera').addEventListener('click',startScanner);
  byId('stop-camera').addEventListener('click',()=>{stopScanner();byId('scanner-message').textContent='Camera stopped. Enter a roll number or start scanning again.';});
  byId('use-decoded').addEventListener('click',()=>{const value=byId('use-decoded').dataset.value;byId('roll-input').value=value;byId('use-decoded').classList.add('hidden');byId('scanner-message').textContent='Decoded value copied to the roll-number field. Confirm it, then check.';byId('roll-input').focus();});
  if(!admin)refreshScans();
}

async function submitVerification(event) {
  event.preventDefault();
  if(state.verifying)return;
  const input=byId('roll-input'); const value=input.value.trim(); const button=event.currentTarget.querySelector('button');
  if (!(/^\d{6}$/.test(value)||/^STF\d{3,17}$/i.test(value))) { showResult('Unable to Verify','Enter a six-digit roll number or staff ID such as STF001.','unknown'); return; }
  state.verifying=true; button.disabled=true; button.textContent='Checking…';
  try {
    const result=await api('/api/verify',{method:'POST',body:JSON.stringify({id:value})});
    renderVerificationResult(result);
    if (state.user.role==='bus_staff') refreshScans();
  } catch (error) {
    showResult('Unable to Verify — Manual Review Required',`${error.message} Check the server/database or ask an admin to review.`, 'unknown');
  } finally { state.verifying=false; button.disabled=false; button.textContent='Verify / board'; }
}

function renderVerificationResult(data) {
  if (data.staff) { const c=data.charge||{}; const title=data.duplicate?'ALREADY CHARGED TODAY':'STAFF BOARDING RECORDED'; const detail=`${data.staff.full_name} · ${data.staff.staff_code} · ${data.staff.department} · Daily rate ₹${Number(data.staff.daily_transport_rate).toFixed(2)} · ${data.duplicate?'Today’s charge':'Daily charge'} ₹${Number(c.amount||0).toFixed(2)} · ${String(c.boarding_date||data.createdAt||'').slice(0,10)}`; showResult(title,detail,data.duplicate?'pending':'success'); return; }
  const student=data.student; let title, detail, kind;
  if (data.result==='Eligible') { title='ELIGIBLE TO BOARD'; detail='Transport fee is paid.'; kind='success'; }
  else if (data.result==='Fee Pending') { title='NOT ELIGIBLE — FEE PENDING'; detail=`Pending amount: ₹${Number(student?.amount_due||0).toLocaleString('en-IN')}.`; kind='pending'; }
  else { title='UNABLE TO VERIFY — MANUAL REVIEW REQUIRED'; detail=String(byId('roll-input')?.value||'').toUpperCase().startsWith('STF')?'No matching staff record was found. No charge was created.':'No matching student record was found. This is not a fee-pending result.'; kind='unknown'; }
  if (student) detail+=` ${student.full_name} · ${student.roll_number}${student.bus_name?` · ${student.bus_name}`:''}${student.stop_name?` · ${student.stop_name}`:''}`;
  const time=data.createdAt ? `Saved ${dateTime(data.createdAt)}` : 'Attempt saved';
  showResult(title,`${detail} ${time}`,kind);
}
function showResult(title,detail,kind) { const box=byId('verify-result'); box.innerHTML=`<div class="result ${kind}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span><button type="button" class="text-button" id="scan-next">Scan next student</button></div>`; byId('scan-next').addEventListener('click',()=>{byId('roll-input').value='';box.innerHTML='';byId('roll-input').focus();}); }

async function startScanner() {
  const status=byId('scanner-message');
  if (!window.isSecureContext && location.hostname!=='localhost' && location.hostname!=='127.0.0.1') { status.textContent='Phone camera access needs HTTPS. Use localhost on this laptop or open this site over a trusted HTTPS origin. Manual entry is available below.'; return; }
  if (!navigator.mediaDevices?.getUserMedia) { status.textContent='Camera access is unavailable in this browser. Allow camera permission or use manual entry.'; return; }
  if (!window.ZXingBrowser?.BrowserMultiFormatReader) { status.textContent='Barcode scanner library did not load. Use manual roll-number entry.'; return; }
  byId('start-camera').disabled=true; status.textContent='Requesting camera permission…';
  try {
    state.reader=new ZXingBrowser.BrowserMultiFormatReader();
    state.scanControls=await state.reader.decodeFromVideoDevice(undefined,byId('camera-video'),(result,error)=>{
      if (!result) {
        if(error && !['NotFoundException','ChecksumException','FormatException'].includes(error.name))status.textContent='The camera could not read this frame. Keep the barcode steady and well lit, or use manual entry.';
        return;
      }
      const decoded=String(result.getText()||'').trim();
      stopScanner(); byId('camera-placeholder').classList.add('hidden');
      if (!(/^\d{6}$/.test(decoded)||/^STF\d{3,17}$/i.test(decoded))) { status.textContent=`Unsupported student roll or staff ID: ${decoded.slice(0,70)}`; return; }
      status.textContent=`Decoded ${result.getBarcodeFormat?.() || 'barcode'}: ${decoded}. Sending for verification…`;
      byId('roll-input').value=decoded; byId('verify-form').requestSubmit();
    });
    byId('camera-placeholder').classList.add('hidden'); byId('stop-camera').disabled=false; status.textContent='Camera is active. Hold the barcode in view; supported 1D barcodes and QR codes are checked.';
    state.scanTimer=setTimeout(()=>{if(state.scanControls)status.textContent='No supported barcode decoded yet. Try better lighting or a steadier angle, or enter the six-digit roll number manually.';},15000);
  } catch (error) {
    stopScanner();
    const message=error?.name==='NotAllowedError' ? 'Camera permission was denied. Allow access in browser settings or use manual entry.' : error?.name==='NotFoundError' ? 'No camera was found. Use manual roll-number entry.' : 'Could not start the camera. Check permissions, use HTTPS on your phone, or enter the roll manually.';
    status.textContent=message;
  } finally { byId('start-camera').disabled=false; }
}
function stopScanner() {
  clearTimeout(state.scanTimer);state.scanTimer=null;
  try { state.scanControls?.stop(); } catch { /* Camera may already have stopped. */ }
  state.scanControls=null;
  const stop=byId('stop-camera'); if (stop) stop.disabled=true;
}

async function refreshScans() {
  if (!state.user || !['admin','bus_staff'].includes(state.user.role)) return;
  try { const data=await api('/api/staff/scans'); state.scans=data.scans||[]; drawScans(); if(byId('history-updated'))byId('history-updated').textContent=`Updated ${new Date().toLocaleTimeString()}`; }
  catch (error) { if(byId('scan-history'))byId('scan-history').innerHTML=`<p class="inline-error">${escapeHtml(error.message)}</p>`; }
}
function drawScans() {
  const target=byId('scan-history'); if(!target)return;
  if (!state.scans.length) { target.innerHTML='<div class="empty">No verification attempts yet.</div>'; return; }
  target.innerHTML=`<table><thead><tr><th>Time</th><th>ID</th><th>Passenger</th><th>Type</th><th>Result</th></tr></thead><tbody>${state.scans.map(scan=>`<tr><td>${escapeHtml(dateTime(scan.created_at))}</td><td>${escapeHtml(scan.roll_number||'—')}</td><td>${escapeHtml(scan.staff_name||scan.student_name||'Unknown ID')}</td><td>${escapeHtml(scan.scan_type||'student')}</td><td>${resultBadge(scan.result)}</td></tr>`).join('')}</tbody></table>`;
}

async function renderAdmin() {
  workspace.innerHTML=`<div id="admin-stats" class="stats-grid"><div class="stat-card"><span>Total students</span><b>—</b></div><div class="stat-card"><span>Eligible to board</span><b>—</b></div><div class="stat-card"><span>Fee pending</span><b>—</b></div><div class="stat-card"><span>Scans today</span><b>—</b></div></div>
    <section class="card data-card"><div class="section-head"><div><div class="eyebrow">TRANSPORT ROSTER</div><h2>Students</h2></div><span id="roster-count" class="muted small"></span></div><div class="filters"><label class="search-label">Search name or six-digit roll<input id="student-search" placeholder="Name or e.g. 680377" autocomplete="off"></label><label>Status<select id="student-status"><option value="all">All fee statuses</option><option value="Paid">Paid</option><option value="Pending">Pending</option></select></label></div><div id="student-table" class="table-wrap"></div></section>
    <section class="card data-card"><div class="section-head"><div><div class="eyebrow">LATEST ACTIVITY</div><h2>Verification history</h2></div><label class="filter-label">Result<select id="scan-status"><option value="all">All results</option><option>Eligible</option><option>Fee Pending</option><option>Unknown/Unable to Verify</option></select></label></div><div id="admin-scans" class="table-wrap"></div></section>`;
  byId('student-search').addEventListener('input',()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(loadStudents,250);});
  byId('student-status').addEventListener('change',event=>{state.studentFilter=event.target.value;drawStudents();});
  byId('scan-status').addEventListener('change',event=>{state.scanFilter=event.target.value;drawAdminScans();});
  await refreshAdmin();
}
async function refreshAdmin() {
  if (!state.user || state.user.role!=='admin') return;
  try {
    const [summary]=await Promise.all([api('/api/admin/summary')]);
    if (state.tab!=='dashboard' || !byId('admin-stats')) return;
    state.scans=summary.recent||[]; const total=Number(summary.students.total)||0; const pending=Number(summary.pending)||0; byId('admin-stats').innerHTML=`<div class="stat-card"><span>Total students</span><b>${total}</b><small>In transport roster</small></div><div class="stat-card"><span>Eligible to board</span><b>${Math.max(0,total-pending)}</b><small>Fee status paid</small></div><div class="stat-card"><span>Fee pending</span><b>${pending}</b><small>Require fee follow-up</small></div><div class="stat-card"><span>Scans today</span><b>${Number(summary.todayScans)||0}</b><small>Verification attempts</small></div>`;
    await loadStudents(); drawAdminScans(); byId('last-updated').textContent=`Refreshed ${new Date().toLocaleTimeString()}`;
  } catch (error) { showMessage(error.message,'error'); }
}
async function loadStudents() {
  const search=byId('student-search')?.value||'';
  try { const data=await api(`/api/admin/students?search=${encodeURIComponent(search)}`); state.students=data.students||[]; drawStudents(); }
  catch (error) { const target=byId('student-table'); if(target)target.innerHTML=`<p class="inline-error">${escapeHtml(error.message)}</p>`; }
}
function drawStudents() {
  const target=byId('student-table'); if(!target)return;
  const rows=state.students.filter(student=>state.studentFilter==='all'||student.fee_status===state.studentFilter);
  byId('roster-count').textContent=`${rows.length} shown · search returns up to 100`;
  if(!rows.length){target.innerHTML='<div class="empty">No matching student records.</div>';return;}
  target.innerHTML=`<table><thead><tr><th>Student</th><th>Roll number</th><th>Department / year</th><th>Bus / stop</th><th>Fee status</th><th>Amount due</th></tr></thead><tbody>${rows.map(s=>`<tr><td><b>${escapeHtml(s.full_name)}</b></td><td>${escapeHtml(s.roll_number)}</td><td>${escapeHtml(s.department)} · Year ${escapeHtml(s.year_of_study)}</td><td>${escapeHtml(s.bus_name||'—')}<small class="table-sub">${escapeHtml(s.stop_name||'')}</small></td><td>${resultBadge(s.fee_status)}</td><td>₹${Number(s.amount_due||0).toLocaleString('en-IN')}</td></tr>`).join('')}</tbody></table>`;
}
function drawAdminScans() {
  const target=byId('admin-scans'); if(!target)return;
  const rows=state.scans.filter(scan=>state.scanFilter==='all'||scan.result===state.scanFilter);
  if(!rows.length){target.innerHTML='<div class="empty">No matching verification attempts.</div>';return;}
  target.innerHTML=`<table><thead><tr><th>Time</th><th>ID</th><th>Passenger</th><th>Type</th><th>Result</th></tr></thead><tbody>${rows.map(scan=>`<tr><td>${escapeHtml(dateTime(scan.created_at))}</td><td>${escapeHtml(scan.roll_number||'—')}</td><td>${escapeHtml(scan.staff_name||scan.student_name||'Unknown ID')}</td><td>${escapeHtml(scan.scan_type||'student')}</td><td>${resultBadge(scan.result)}</td></tr>`).join('')}</tbody></table>`;
}
function resultBadge(result) { const kind=result==='Eligible'||result==='Paid'?'success':result==='Fee Pending'||result==='Pending'?'pending':'unknown';return `<span class="badge ${kind}">${escapeHtml(result)}</span>`; }

async function renderStudent() {
  workspace.innerHTML='<div class="student-loading card">Loading your transport record…</div>';
  try {
    const {student}=await api('/api/student/me');
    const paid=student.fee_status==='Paid';
    workspace.innerHTML=`<section class="student-hero card"><div class="eyebrow">YOUR TRANSPORT RECORD</div><h2>${escapeHtml(student.full_name)}</h2><p class="muted">${escapeHtml(student.roll_number)} · ${escapeHtml(student.department)} · Year ${escapeHtml(student.year_of_study)}</p><div class="student-status ${paid?'success':'pending'}"><span>${paid?'FEE PAID':'FEE PENDING'}</span>${paid?'Your transport fee is paid.':`Amount due: ₹${Number(student.amount_due||0).toLocaleString('en-IN')}`}</div><div class="student-details"><div><span>Assigned bus</span><b>${escapeHtml(student.bus_name||'Not assigned')}</b></div><div><span>Assigned stop</span><b>${escapeHtml(student.stop_name||'Not assigned')}</b></div><div><span>Fee status</span><b>${escapeHtml(student.fee_status)}</b></div></div></section><p class="muted privacy-copy">You are viewing the transport record linked to your signed-in account.</p>`;
  } catch (error) { workspace.innerHTML=`<div class="card inline-error">${escapeHtml(error.message)}</div>`; }
}

async function renderAdminStaff() {
  workspace.innerHTML='<section class="card"><h2>Staff daily charges and balances</h2><p class="muted">Rate changes apply to future boardings; saved charges are preserved.</p><div id="admin-staff-table">Loading staff records…</div></section>';
  try { const d=await api('/api/admin/staff'); const t=byId('admin-staff-table'); t.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Department</th><th>Rate</th><th>Days</th><th>Charges</th><th>Paid</th><th>Balance</th><th>Set rate</th></tr></thead><tbody>${d.staff.map(s=>`<tr><td>${escapeHtml(s.staff_code)} · ${escapeHtml(s.full_name)}</td><td>${escapeHtml(s.department)}</td><td>₹${Number(s.daily_transport_rate).toFixed(2)}</td><td>${s.chargeable_days}</td><td>₹${Number(s.total_charges).toFixed(2)}</td><td>₹${Number(s.total_payments).toFixed(2)}</td><td>₹${Number(s.balance).toFixed(2)}</td><td><form class="rate-form" data-id="${s.id}"><input type="number" min="0" step="0.01" value="${s.daily_transport_rate}" required><button class="button secondary">Save</button></form></td></tr>`).join('')}</tbody></table></div>`;t.querySelectorAll('.rate-form').forEach(f=>f.addEventListener('submit',async e=>{e.preventDefault();try{await api(`/api/admin/staff/${f.dataset.id}/rate`,{method:'PATCH',body:JSON.stringify({dailyRate:Number(f.querySelector('input').value)})});renderAdminStaff();}catch(err){showMessage(err.message,'error');}}));}catch(e){workspace.innerHTML=`<section class="card inline-error">${escapeHtml(e.message)}</section>`;}
}
async function renderStaffPortal() {
  workspace.innerHTML='<section class="card">Loading your staff account…</section>';
  try {const d=await api('/api/staff-passenger/me'),s=d.staff,t=d.totals,balance=Math.max(0,Number(t.charges)-Number(t.payments));workspace.innerHTML=`<section class="student-hero card"><div class="eyebrow">STAFF PASSENGER · SIMULATED FEES</div><h2>${escapeHtml(s.full_name)}</h2><p>${escapeHtml(s.staff_code)} · ${escapeHtml(s.department)}</p><div class="student-details"><div><span>Assigned bus</span><b>${escapeHtml(s.bus_name||'Not assigned')}</b></div><div><span>Route</span><b>${escapeHtml(s.route_name||'Not assigned')}</b></div><div><span>Boarding stop</span><b>${escapeHtml(s.stop_name||'Not assigned')}</b></div><div><span>Daily rate</span><b>₹${Number(s.daily_transport_rate).toFixed(2)}</b></div><div><span>All charges</span><b>₹${Number(t.charges).toFixed(2)}</b></div><div><span>Payments</span><b>₹${Number(t.payments).toFixed(2)}</b></div><div><span>Balance carried forward</span><b>₹${balance.toFixed(2)}</b></div></div><form id="staff-payment" class="payment-form"><label>Simulated payment (up to ₹${balance.toFixed(2)})<input name="amount" type="number" min="0.01" max="${balance}" step="0.01" required ${balance<=0?'disabled':''}></label><button class="button primary" ${balance<=0?'disabled':''}>Make simulated payment</button><small>No real money is transferred.</small></form></section><section class="card data-card"><h2>Monthly summary</h2>${historyTable('Monthly charges',d.monthly.map(x=>({date:x.month,amount:x.charges,reference:`${x.chargeable_days} chargeable days` })))}</section>${historyTable('Charge history',d.charges.map(x=>({date:x.boarding_date,amount:x.amount,reference:`Daily rate ₹${Number(x.daily_rate).toFixed(2)}`})))}${historyTable('Payment history',d.payments.map(x=>({date:x.created_at,amount:x.amount,reference:x.reference})))}`;
    byId('staff-payment').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{const p=await api('/api/staff-passenger/payment',{method:'POST',body:JSON.stringify({amount:Number(f.amount.value),requestKey:crypto.randomUUID()})});showMessage(`Simulated payment recorded: ${p.payment.reference}. No real money was transferred.`,'success');renderStaffPortal();}catch(err){showMessage(err.message,'error');b.disabled=false;}});
  }catch(e){workspace.innerHTML=`<section class="card inline-error">${escapeHtml(e.message)}</section>`;}
}
function historyTable(title,rows){return `<section class="card data-card"><h2>${title}</h2>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Reference / detail</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${escapeHtml(dateTime(x.date))}</td><td>₹${Number(x.amount).toFixed(2)}</td><td>${escapeHtml(x.reference||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No saved records.</div>'}</section>`;}
async function renderRegistrationRequests(){workspace.innerHTML='<section class="card data-card"><div class="section-head"><div><div class="eyebrow">ADMIN</div><h2>Registration requests</h2></div></div><div class="filters"><label>Search name or ID<input id="request-search" placeholder="Name, roll number or staff ID"></label><label>Status<select id="request-status"><option value="all">All requests</option><option>Pending</option><option>Approved</option><option>Rejected</option></select></label><label>Role<select id="request-role"><option value="all">All roles</option><option value="student">Student</option><option value="staff_passenger">Staff</option></select></label></div><div id="request-list">Loading…</div></section>';const load=async()=>{const target=byId('request-list');try{const d=await api(`/api/admin/registration-requests?search=${encodeURIComponent(byId('request-search').value)}&status=${encodeURIComponent(byId('request-status').value)}&role=${encodeURIComponent(byId('request-role').value)}`);target.innerHTML=d.requests.length?d.requests.map(r=>`<article class="request-card"><div class="section-head"><div><b>${escapeHtml(r.full_name)}</b><div class="muted">${escapeHtml(r.role==='student'?'Student':'Staff')} · ${escapeHtml(r.username)} · ${escapeHtml(r.department)}${r.year_of_study?` · Year ${r.year_of_study}`:''}</div></div><span class="pill">${escapeHtml(r.status)}</span></div><p>${escapeHtml(r.phone)} · ${escapeHtml(r.address)} · Preferred route: ${escapeHtml(r.route_name||'—')}</p><p class="muted">Existing transport records: ${r.existing_records?.length?r.existing_records.map(x=>`${escapeHtml(x.id)} · ${escapeHtml(x.full_name)} · ${escapeHtml(x.department)}`).join('; '):'No matching existing record.'}</p>${r.status==='Pending'?`<form class="decision-form" data-id="${r.id}"><label>Bus<select name="busId" required><option value="">Assign bus</option>${d.buses.map(x=>`<option value="${x.id}">${escapeHtml(x.bus_name)} · ${escapeHtml(x.registration_no)}</option>`).join('')}</select></label><label>Stop on preferred route<select name="stopId" required><option value="">Assign stop</option>${d.stops.filter(x=>Number(x.route_id)===Number(r.preferred_route_id)).map(x=>`<option value="${x.id}">${escapeHtml(x.stop_name)}</option>`).join('')}</select></label><button class="button primary" name="action" value="approve">Approve</button><label>Rejection reason<input name="reason" maxlength="500" placeholder="Required to reject"></label><button class="button secondary" name="action" value="reject">Reject</button></form>`:r.rejection_reason?`<p class="error-text">Reason: ${escapeHtml(r.rejection_reason)}</p>`:''}</article>`).join(''):'<div class="empty">No matching requests.</div>';target.querySelectorAll('.decision-form').forEach(f=>f.addEventListener('submit',async e=>{e.preventDefault();const action=e.submitter.value,fd=new FormData(f);try{await api(`/api/admin/registration-requests/${f.dataset.id}/decision`,{method:'POST',body:JSON.stringify({status:action==='approve'?'Approved':'Rejected',busId:Number(fd.get('busId')),stopId:Number(fd.get('stopId')),reason:fd.get('reason')})});showMessage(`Request ${action==='approve'?'approved':'rejected'}.`,'success');load();}catch(err){showMessage(err.message,'error');}}));}catch(e){target.innerHTML=`<p class="inline-error">${escapeHtml(e.message)}</p>`;}};byId('request-search').addEventListener('input',()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(load,250);});byId('request-status').addEventListener('change',load);byId('request-role').addEventListener('change',load);load();}
async function renderStudent() {
  workspace.innerHTML='<section class="card">Loading your annual fee account…</section>';
  try {const d=await api('/api/student/me'),s=d.student,due=Number(s.amount_due||0);workspace.innerHTML=`<section class="student-hero card"><div class="eyebrow">ANNUAL TRANSPORT FEE</div><h2>${escapeHtml(s.full_name)}</h2><section class="academic-details"><h3>Academic information</h3><div class="student-details"><div><span>Roll number</span><b>${escapeHtml(s.roll_number)}</b></div><div><span>Department</span><b>${escapeHtml(s.department)}</b></div><div><span>Year of study</span><b>${escapeHtml(s.year_of_study)}</b></div></div></section><div class="student-details"><div><span>Annual fee</span><b>₹${Number(s.annual_fee).toLocaleString('en-IN',{minimumFractionDigits:2})}</b></div><div><span>Paid</span><b>₹${Number(s.amount_paid).toLocaleString('en-IN',{minimumFractionDigits:2})}</b></div><div><span>Outstanding</span><b>₹${due.toLocaleString('en-IN',{minimumFractionDigits:2})}</b></div><div><span>Status</span><b>${escapeHtml(s.fee_status)}</b></div></div><form id="student-payment" class="payment-form"><label>Simulated payment (up to ₹${due.toFixed(2)})<input name="amount" type="number" min="0.01" max="${due}" step="0.01" required ${due<=0?'disabled':''}></label><button class="button primary" ${due<=0?'disabled':''}>Make simulated payment</button><small>Demonstration only. No real money is transferred.</small></form></section>${historyTable('Payment history',d.payments.map(x=>({date:x.created_at,amount:x.amount,reference:`${x.reference} · ${x.status}`})))}`;
    byId('student-payment').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{const p=await api('/api/student/payment',{method:'POST',body:JSON.stringify({amount:Number(f.amount.value),requestKey:crypto.randomUUID()})});showMessage(`Simulated payment recorded. Receipt: ${p.payment.reference}. No real money was transferred.`,'success');renderStudent();}catch(err){showMessage(err.message,'error');b.disabled=false;}});
  }catch(e){workspace.innerHTML=`<section class="card inline-error">${escapeHtml(e.message)}</section>`;}
}
start();
