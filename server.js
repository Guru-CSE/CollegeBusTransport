const path = require('path');
const fs = require('fs');
const https = require('https');
const net = require('net');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const httpsMode = process.argv.includes('--https');

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'local-demo-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: httpsMode, maxAge: 8 * 60 * 60 * 1000 }
}));

app.get('/api/health', async (_req, res) => {
  const missing = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].filter(key => !process.env[key]);
  if (missing.length) return res.status(503).json({ ok:false, database:'unavailable', stage:'configuration', missing });
  try {
    await db.query('SELECT 1');
  } catch (error) {
    return res.status(503).json({ ok:false, database:'unavailable', stage:'connection', code:error.code || 'DB_CONNECTION_ERROR' });
  }
  try {
    const [tables] = await db.query('SHOW TABLES');
    const tableNames = new Set(tables.map(row => Object.values(row)[0]));
    const required = ['users','buses','routes','stops','students','staff','payments','scan_records','announcements','change_requests','registration_requests'];
    const missingTables = required.filter(name => !tableNames.has(name));
    if (missingTables.length) return res.status(503).json({ ok:false, database:'connected', stage:'schema', missingTables });
    const [[counts]] = await db.query("SELECT (SELECT COUNT(*) FROM students WHERE roll_number BETWEEN '680377' AND '680386' AND annual_fee=12000 AND amount_due=annual_fee-amount_paid) AS sample_students, (SELECT COUNT(*) FROM staff WHERE staff_code IN ('STF001','STF002','STF003','STF004','STF005')) AS sample_staff, (SELECT COUNT(*) FROM users WHERE username IN ('admin','staff','student-paid','student-pending','student-680379','student-680380','student-680381','student-680382','student-680383','student-680384','student-680385','student-680386','staff-stf001','staff-stf002','staff-stf003','staff-stf004','staff-stf005')) AS demo_users");
    const missingSeed = [];
    if (Number(counts.sample_students) < 10) missingSeed.push('sample students');
    if (Number(counts.sample_staff) < 5) missingSeed.push('sample staff');
    if (Number(counts.demo_users) < 17) missingSeed.push('demo accounts');
    if (missingSeed.length) return res.status(503).json({ ok:false, database:'connected', stage:'seed', missingSeed });
    res.json({ ok:true, database:'connected', schema:'ready', seed:'ready' });
  } catch (error) {
    res.status(503).json({ ok:false, database:'connected', stage:'schema', code:error.code || 'DB_SCHEMA_ERROR' });
  }
});
const requireRole = (...roles) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'You do not have access to this action.' });
  next();
};
const announcementAudiences = ['everyone','students','staff'];
function announcementInput(body, creating) {
  const title=String(body?.title||'').trim(),message=String(body?.message||'').trim();
  const audience=String(body?.audience||''),expiry=String(body?.expiresAt||'');
  if(!title||title.length>150||!message||message.length>10000||!announcementAudiences.includes(audience)) return {error:'Enter a title, message, and valid audience.'};
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiry)) return {error:'Choose a valid expiry date and time.'};
  const expiresAt=Date.parse(expiry);
  if(!Number.isFinite(expiresAt)||new Date(expiresAt).toISOString()!==expiry) return {error:'Choose a valid expiry date and time.'};
  if(creating&&expiresAt<=Date.now()) return {error:'Expiry must be in the future.'};
  return {title,message,audience,expiresAt:new Date(expiresAt).toISOString().slice(0,23).replace('T',' ')};
}
app.get('/api/announcements',requireRole('student','staff_passenger'),async(req,res)=>{
  res.set('Cache-Control','no-store');
  const audience=req.session.user.role==='student'?'students':'staff';
  try {const [announcements]=await db.execute("SELECT id,title,message,created_at,DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%s.%fZ') expires_at FROM announcements WHERE is_published=TRUE AND expires_at>UTC_TIMESTAMP(3) AND audience IN ('everyone',?) ORDER BY created_at DESC,id DESC",[audience]);res.json({announcements});}
  catch{res.status(503).json({error:'Announcements are unavailable.'});}
});
app.get('/api/admin/announcements',requireRole('admin'),async(_req,res)=>{
  res.set('Cache-Control','no-store');
  try {const [announcements]=await db.execute("SELECT id,title,message,audience,is_published,created_at,DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%s.%fZ') expires_at,DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') updated_at,expires_at<=UTC_TIMESTAMP(3) expired FROM announcements ORDER BY created_at DESC,id DESC");res.json({announcements});}
  catch{res.status(503).json({error:'Announcement history is unavailable.'});}
});
app.post('/api/admin/announcements',requireRole('admin'),async(req,res)=>{
  const input=announcementInput(req.body,true);if(input.error)return res.status(400).json({error:input.error});
  try {const [saved]=await db.execute('INSERT INTO announcements (title,message,is_published,audience,expires_at) VALUES (?,?,TRUE,?,?)',[input.title,input.message,input.audience,input.expiresAt]);res.status(201).json({ok:true,id:saved.insertId});}
  catch{res.status(503).json({error:'Announcement was not published.'});}
});
app.patch('/api/admin/announcements/:id',requireRole('admin'),async(req,res)=>{
  const input=announcementInput(req.body,false);if(input.error)return res.status(400).json({error:input.error});
  if(!/^\d+$/.test(String(req.params.id)))return res.status(400).json({error:'Invalid announcement ID.'});
  try {const [saved]=await db.execute('UPDATE announcements SET title=?,message=?,audience=?,expires_at=?,is_published=TRUE WHERE id=?',[input.title,input.message,input.audience,input.expiresAt,req.params.id]);if(!saved.affectedRows){const [[existing]]=await db.execute('SELECT id FROM announcements WHERE id=?',[req.params.id]);if(!existing)return res.status(404).json({error:'Announcement not found.'});}res.json({ok:true});}
  catch{res.status(503).json({error:'Announcement was not updated.'});}
});
app.delete('/api/admin/announcements/:id',requireRole('admin'),async(req,res)=>{
  if(!/^\d+$/.test(String(req.params.id)))return res.status(400).json({error:'Invalid announcement ID.'});
  try {const [removed]=await db.execute('DELETE FROM announcements WHERE id=?',[req.params.id]);if(!removed.affectedRows)return res.status(404).json({error:'Announcement not found.'});res.json({ok:true});}
  catch{res.status(503).json({error:'Announcement was not deleted.'});}
});
app.post('/api/register', async (req,res) => {
  const b=req.body||{}, role=String(b.role||'').toLowerCase(), username=String(b.username||'').trim(), password=String(b.password||'');
  const fullName=String(b.fullName||'').trim(), department=String(b.department||'').trim(), phone=String(b.phone||'').trim(), address=String(b.address||'').trim();
  const year=Number(b.yearOfStudy), routeId=Number(b.routeId);
  if(!['student','staff_passenger'].includes(role)) return res.status(400).json({error:'Choose Student or Staff.'});
  if(!username||username.length>20||!fullName||fullName.length>120||!department||department.length>80||!phone||phone.length>24||!address||address.length>500||!password||password.length<8||password.length>72||!Number.isInteger(routeId)) return res.status(400).json({error:'Complete all required fields. Password must be 8–72 characters.'});
  if(!/^[+()\d\s.-]{7,20}$/.test(phone)) return res.status(400).json({error:'Enter a valid phone number.'});
  if(role==='student'&&(!/^\d{6}$/.test(username)||!Number.isInteger(year)||year<1||year>8)) return res.status(400).json({error:'Enter a six-digit roll number and a valid year of study.'});
  if(role==='staff_passenger'&&!/^STF[A-Z0-9-]{1,17}$/i.test(username)) return res.status(400).json({error:'Enter a valid staff ID.'});
  try {
    const [[route]]=await db.execute('SELECT id FROM routes WHERE id=?',[routeId]); if(!route) return res.status(400).json({error:'Choose an available route.'});
    const [exists]=await db.execute(role==='student'?'SELECT id FROM students WHERE roll_number=?':'SELECT id FROM staff WHERE staff_code=?',[username]);
    if(exists.length) return res.status(409).json({error:'That ID already exists in the transport records. Contact an administrator.'});
    const [pending]=await db.execute("SELECT id FROM registration_requests WHERE username=? AND status IN ('Pending','Approved')",[username]);
    if(pending.length) return res.status(409).json({error:'A registration request or account already exists for this ID.'});
    const hash=await bcrypt.hash(password,12);
    await db.execute("INSERT INTO registration_requests (role,username,password_hash,full_name,department,phone,address,year_of_study,preferred_route_id,status) VALUES (?,?,?,?,?,?,?,?,?,'Pending')",[role,username,hash,fullName,department,phone,address,role==='student'?year:null,routeId]);
    res.status(201).json({ok:true,username,message:'Registration received. Your request is awaiting admin approval.'});
  } catch(e) { console.error(e); res.status(503).json({error:'Registration service unavailable. Run the database migration and try again.'}); }
});
app.get('/api/registration/status/:username', async (req,res)=>{try{const [rows]=await db.execute('SELECT username,role,status,rejection_reason,created_at FROM registration_requests WHERE username=? ORDER BY id DESC LIMIT 1',[String(req.params.username).trim()]);if(!rows[0])return res.status(404).json({error:'No registration request was found.'});res.json({request:rows[0]});}catch{res.status(503).json({error:'Status service unavailable.'});}});
app.get('/api/registration/routes', async (_req,res)=>{try{const [rows]=await db.query('SELECT id,route_name FROM routes ORDER BY route_name');res.json({routes:rows});}catch{res.status(503).json({error:'Routes unavailable.'});}});
app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().slice(0,80);
  const password = String(req.body?.password || '').slice(0,200);
  const selectedRole=String(req.body?.role||'').toLowerCase();
  if(!['admin','student','staff_passenger'].includes(selectedRole)) return res.status(400).json({error:'Select Admin, Student, or Staff.'});
  if (!username || !password) return res.status(400).json({ error: 'Enter username and password.' });
  try {
    let [rows] = await db.execute('SELECT id,username,password_hash,role,student_id,staff_id FROM users WHERE username=?', [username]);
    if(!rows[0]&&selectedRole==='student'){const [[s]]=await db.execute('SELECT id FROM students WHERE roll_number=?',[username]);if(s)[rows]=await db.execute("SELECT id,username,password_hash,role,student_id,staff_id FROM users WHERE student_id=? AND role='student'",[s.id]);}
    if(!rows[0]&&selectedRole==='staff_passenger'){const [[s]]=await db.execute('SELECT id FROM staff WHERE staff_code=?',[username]);if(s)[rows]=await db.execute("SELECT id,username,password_hash,role,student_id,staff_id FROM users WHERE staff_id=? AND role='staff_passenger'",[s.id]);}
    if (!rows[0]) {const [[request]]=await db.execute('SELECT status,rejection_reason FROM registration_requests WHERE username=? ORDER BY id DESC LIMIT 1',[username]);if(request?.status==='Pending')return res.status(403).json({error:'Your account is awaiting admin approval.'});if(request?.status==='Rejected')return res.status(403).json({error:`Your registration was rejected.${request.rejection_reason?` ${request.rejection_reason}`:''}`});return res.status(401).json({ error: 'Incorrect username or password.' });}
    if (!await bcrypt.compare(password, rows[0].password_hash)) return res.status(401).json({ error: 'Incorrect username or password.' });
    if (selectedRole && selectedRole!==rows[0].role) return res.status(403).json({ error: 'The selected role does not match this account.' });
    if (!['admin','student','staff_passenger'].includes(rows[0].role)) return res.status(403).json({error:'This account type cannot sign in here.'});
    const authenticatedUser = { id: rows[0].id, username: rows[0].username, role: rows[0].role, studentId: rows[0].student_id, staffId: rows[0].staff_id };
    req.session.regenerate(error=>{if(error)return res.status(503).json({error:'Could not start a secure sign-in session.'});req.session.user=authenticatedUser;req.session.save(saveError=>{if(saveError)return res.status(503).json({error:'Could not save the sign-in session.'});res.json({user:authenticatedUser});});});
  } catch { res.status(503).json({ error: 'Sign-in service unavailable. Ask an admin to check the database.' }); }
});
app.get('/api/admin/registration-requests',requireRole('admin'),async(req,res)=>{try{const search=`%${String(req.query.search||'').slice(0,80)}%`,status=String(req.query.status||'all'),role=String(req.query.role||'all');const allowed=['all','Pending','Approved','Rejected'];if(!allowed.includes(status)||!['all','student','staff_passenger'].includes(role))return res.status(400).json({error:'Invalid request filter.'});const [requests]=await db.execute(`SELECT rr.id,rr.role,rr.username,rr.full_name,rr.department,rr.phone,rr.address,rr.year_of_study,rr.preferred_route_id,rr.status,rr.rejection_reason,rr.created_at,r.route_name FROM registration_requests rr LEFT JOIN routes r ON r.id=rr.preferred_route_id WHERE (rr.username LIKE ? OR rr.full_name LIKE ?) AND (?='all' OR rr.status=?) AND (?='all' OR rr.role=?) ORDER BY rr.created_at DESC`,[search,search,status,status,role,role]);for(const r of requests){if(r.role==='student'){const [matches]=await db.execute('SELECT roll_number id,full_name,department,year_of_study details FROM students WHERE roll_number=? OR full_name LIKE ? LIMIT 5',[r.username,`%${r.full_name}%`]);r.existing_records=matches;}else{const [matches]=await db.execute('SELECT staff_code id,full_name,department,daily_transport_rate details FROM staff WHERE staff_code=? OR full_name LIKE ? LIMIT 5',[r.username,`%${r.full_name}%`]);r.existing_records=matches;}}const [routes]=await db.query('SELECT id,route_name FROM routes ORDER BY route_name');const [buses]=await db.query('SELECT id,bus_name,registration_no FROM buses ORDER BY bus_name');const [stops]=await db.query('SELECT id,route_id,stop_name FROM stops ORDER BY stop_name');res.json({requests,routes,buses,stops});}catch(e){console.error(e);res.status(503).json({error:'Registration requests unavailable.'});}});
app.post('/api/admin/registration-requests/:id/decision',requireRole('admin'),async(req,res)=>{const status=String(req.body?.status||'');const reason=String(req.body?.reason||'').trim().slice(0,500);if(!['Approved','Rejected'].includes(status))return res.status(400).json({error:'Choose approve or reject.'});if(status==='Rejected'&&!reason)return res.status(400).json({error:'Enter a rejection reason.'});const c=await db.getConnection();try{await c.beginTransaction();const [[r]]=await c.execute("SELECT * FROM registration_requests WHERE id=? FOR UPDATE",[req.params.id]);if(!r){await c.rollback();return res.status(404).json({error:'Request not found.'});}if(r.status!=='Pending'){await c.rollback();return res.status(409).json({error:'This request has already been reviewed.'});}if(status==='Rejected'){await c.execute("UPDATE registration_requests SET status='Rejected',rejection_reason=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?",[reason,req.session.user.id,r.id]);await c.commit();return res.json({ok:true});}
 const busId=Number(req.body?.busId),stopId=Number(req.body?.stopId);if(!busId||!stopId){await c.rollback();return res.status(400).json({error:'Assign a bus and stop before approval.'});}const [[stop]]=await c.execute('SELECT id,route_id FROM stops WHERE id=?',[stopId]);const [[bus]]=await c.execute('SELECT id FROM buses WHERE id=?',[busId]);if(!stop||!bus||Number(stop.route_id)!==Number(r.preferred_route_id)){await c.rollback();return res.status(400).json({error:'Choose a valid bus and a stop on the requested route.'});}
 if(r.role==='student'){const [[existing]]=await c.execute('SELECT id FROM students WHERE roll_number=? FOR UPDATE',[r.username]);if(existing){await c.rollback();return res.status(409).json({error:'A student record already exists for this roll number.'});}await c.execute("INSERT INTO students (roll_number,full_name,department,year_of_study,bus_id,stop_id,fee_status,amount_due,annual_fee,amount_paid,phone,address) SELECT ?,?,?,?,?,?,IF(COALESCE(AVG(annual_fee),0)=0,'Paid','Pending'),COALESCE(AVG(annual_fee),0),COALESCE(AVG(annual_fee),0),0,?,? FROM students",[r.username,r.full_name,r.department,r.year_of_study,busId,stopId,r.phone,r.address]);const [[student]]=await c.execute('SELECT id FROM students WHERE roll_number=?',[r.username]);await c.execute("INSERT INTO users (username,password_hash,role,student_id) VALUES (?,?, 'student',?)",[r.username,r.password_hash,student.id]);}
 else {const [[existing]]=await c.execute('SELECT id FROM staff WHERE staff_code=? FOR UPDATE',[r.username]);if(existing){await c.rollback();return res.status(409).json({error:'A staff record already exists for this ID.'});}const [ins]=await c.execute('INSERT INTO staff (staff_code,full_name,department,daily_transport_rate,phone,address,bus_id,stop_id) SELECT ?,?,?,COALESCE(AVG(daily_transport_rate),0),?,?,?,? FROM staff',[r.username,r.full_name,r.department,r.phone,r.address,busId,stopId]);await c.execute("INSERT INTO users (username,password_hash,role,staff_id) VALUES (?,?, 'staff_passenger',?)",[r.username,r.password_hash,ins.insertId]);}
 await c.execute("UPDATE registration_requests SET status='Approved',rejection_reason=NULL,reviewed_by=?,reviewed_at=NOW() WHERE id=?",[req.session.user.id,r.id]);await c.commit();res.json({ok:true});}catch(e){await c.rollback();console.error(e);res.status(503).json({error:'Approval failed; no partial changes were saved.'});}finally{c.release();}});
app.post('/api/logout', (req,res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req,res) => res.json({ user: req.session.user || null }));
app.post('/api/verify-old', requireRole('admin','bus_staff'), async (req,res) => {
  const roll = String(req.body?.rollNumber || '').trim();
  if (!/^\d{6}$/.test(roll)) return res.status(400).json({ error: 'Enter a six-digit numeric roll number.' });
  try {
    const [rows] = await db.execute('SELECT s.id,s.roll_number,s.full_name,s.fee_status,s.amount_due,b.bus_name,st.stop_name FROM students s LEFT JOIN buses b ON b.id=s.bus_id LEFT JOIN stops st ON st.id=s.stop_id WHERE s.roll_number=?', [roll]);
    const student = rows[0] || null;
    const result = !student ? 'Unknown/Unable to Verify' : student.fee_status === 'Paid' ? 'Eligible' : 'Fee Pending';
    const [saved] = await db.execute('INSERT INTO scan_records (roll_number,student_id,result,scanned_by,bus_id) VALUES (?,?,?,?,?)', [roll,student?.id || null,result,req.session.user.id,null]);
    const [[scan]] = await db.execute('SELECT created_at FROM scan_records WHERE id=?', [saved.insertId]);
    res.json({ result, student, createdAt:scan.created_at });
  } catch { res.status(503).json({ result:'Unknown/Unable to Verify', error:'Unable to Verify — Manual Review Required.' }); }
});
app.post('/api/verify', requireRole('admin','bus_staff'), async (req,res) => {
  const idValue=String(req.body?.id||req.body?.rollNumber||'').trim().toUpperCase();
  if (!/^\d{6}$/.test(idValue)&&!/^STF\d{3,17}$/.test(idValue)) return res.status(400).json({error:'Enter a six-digit student roll number or staff ID such as STF001.'});
  const c=await db.getConnection();
  try {
    await c.beginTransaction(); let payload;
    if (idValue.startsWith('STF')) {
      const [[staff]]=await c.execute('SELECT id,staff_code,full_name,department,daily_transport_rate FROM staff WHERE staff_code=? FOR UPDATE',[idValue]);
      const [[today]]=await c.query('SELECT CURRENT_DATE() boarding_date');
      if (!staff) { await c.execute("INSERT INTO scan_records (roll_number,scan_type,result,scanned_by) VALUES (?,'unknown','Unknown/Unable to Verify',?)",[idValue,req.session.user.id]); payload={result:'Unknown/Unable to Verify',staff:null,createdAt:today.boarding_date}; }
      else {
        const [saved]=await c.execute("INSERT INTO scan_records (roll_number,staff_id,scan_type,result,scanned_by) VALUES (?,?,'staff','Error',?)",[idValue,staff.id,req.session.user.id]);
        const [ins]=await c.execute('INSERT INTO staff_boarding_charges (staff_id,boarding_date,daily_rate,amount,scan_record_id) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[staff.id,today.boarding_date,staff.daily_transport_rate,staff.daily_transport_rate,saved.insertId]);
        const duplicate=ins.affectedRows===0; const [[charge]]=await c.execute('SELECT id,boarding_date,daily_rate,amount,created_at FROM staff_boarding_charges WHERE staff_id=? AND boarding_date=?',[staff.id,today.boarding_date]);
        const result=duplicate?'Already charged today':'Staff boarding recorded'; await c.execute('UPDATE scan_records SET result=?,charge_id=? WHERE id=?',[result,charge.id,saved.insertId]); payload={result,staff,charge,duplicate,createdAt:today.boarding_date};
      }
    } else {
      const [rows]=await c.execute('SELECT s.id,s.roll_number,s.full_name,s.department,s.annual_fee,s.amount_paid,s.fee_status,s.amount_due,b.bus_name,st.stop_name FROM students s LEFT JOIN buses b ON b.id=s.bus_id LEFT JOIN stops st ON st.id=s.stop_id WHERE s.roll_number=?',[idValue]);
      const student=rows[0]||null; const result=!student?'Unknown/Unable to Verify':student.fee_status==='Paid'?'Eligible':'Fee Pending';
      const [saved]=await c.execute("INSERT INTO scan_records (roll_number,student_id,scan_type,result,scanned_by,bus_id) VALUES (?,?,'student',?,?,NULL)",[idValue,student?.id||null,result,req.session.user.id]); const [[scan]]=await c.execute('SELECT created_at FROM scan_records WHERE id=?',[saved.insertId]); payload={result,student,createdAt:scan.created_at};
    }
    await c.commit(); res.json(payload);
  } catch { await c.rollback().catch(()=>{}); res.status(503).json({result:'Unknown/Unable to Verify',error:'Unable to Verify — Try Again.'}); } finally {c.release();}
});
app.get('/api/staff/scans', requireRole('admin','bus_staff'), async (_req,res) => {
  try { const [rows]=await db.query('SELECT sr.id,sr.roll_number,sr.scan_type,s.full_name student_name,stf.full_name staff_name,sr.result,b.bus_name,sr.created_at FROM scan_records sr LEFT JOIN students s ON s.id=sr.student_id LEFT JOIN staff stf ON stf.id=sr.staff_id LEFT JOIN buses b ON b.id=sr.bus_id ORDER BY sr.created_at DESC LIMIT 50'); res.json({scans:rows}); } catch {res.status(503).json({error:'Verification history unavailable.'});}
});
app.get('/api/staff/scans', requireRole('bus_staff'), async (_req,res) => {
  try {
    const [rows] = await db.query('SELECT sr.id,sr.roll_number,s.full_name,sr.result,b.bus_name,sr.created_at FROM scan_records sr LEFT JOIN students s ON s.id=sr.student_id LEFT JOIN buses b ON b.id=sr.bus_id ORDER BY sr.created_at DESC LIMIT 50');
    res.json({scans:rows});
  } catch { res.status(503).json({error:'Verification history unavailable.'}); }
});
app.get('/api/student/me', requireRole('student'), async (req,res) => {
  try {
    const [rows] = await db.execute('SELECT s.id,s.roll_number,s.full_name,s.department,s.year_of_study,s.annual_fee,s.amount_paid,s.fee_status,s.amount_due,b.bus_name,st.stop_name FROM students s LEFT JOIN buses b ON b.id=s.bus_id LEFT JOIN stops st ON st.id=s.stop_id WHERE s.id=?', [req.session.user.studentId]);
    if (!rows[0]) return res.status(404).json({error:'Student record not found.'});
    const [payments]=await db.execute('SELECT id,amount,status,reference,created_at FROM payments WHERE student_id=? ORDER BY created_at DESC',[req.session.user.studentId]);
    res.json({student:rows[0],payments});
  } catch { res.status(503).json({error:'Student details unavailable.'}); }
});
app.get('/api/student/me', requireRole('student'), async (req,res) => {
  try { const sid=req.session.user.studentId; const [rows]=await db.execute('SELECT s.id,s.roll_number,s.full_name,s.department,s.year_of_study,s.annual_fee,s.amount_paid,s.fee_status,s.amount_due,b.bus_name,st.stop_name FROM students s LEFT JOIN buses b ON b.id=s.bus_id LEFT JOIN stops st ON st.id=s.stop_id WHERE s.id=?',[sid]); if(!rows[0])return res.status(404).json({error:'Student record not found.'}); const [payments]=await db.execute('SELECT id,amount,status,reference,created_at FROM payments WHERE student_id=? ORDER BY created_at DESC',[sid]).catch(()=>[[]]); res.json({student:rows[0],payments}); } catch {res.status(503).json({error:'Student details unavailable.'});}
});
app.post('/api/student/payment', requireRole('student'), async (req,res) => {
  const amountValue=String(req.body?.amount??''),key=String(req.body?.requestKey||'');
  if(!/^\d+(?:\.\d{1,2})?$/.test(amountValue)||!/^[-\w]{8,100}$/.test(key))return res.status(400).json({error:'Enter a valid payment amount and request reference.'});
  const [whole,fraction='']=amountValue.split('.'),amountCents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(amountCents)||amountCents<=0)return res.status(400).json({error:'Enter a valid payment amount and request reference.'});
  const amount=amountCents/100;
  const c=await db.getConnection(); try { await c.beginTransaction(); const sid=req.session.user.studentId; const [[s]]=await c.execute('SELECT id,annual_fee,amount_paid FROM students WHERE id=? FOR UPDATE',[sid]); if(!s){await c.rollback();return res.status(404).json({error:'Student record not found.'});}
    const [[prior]]=await c.execute('SELECT id,amount,status,reference FROM payments WHERE student_id=? AND request_key=?',[sid,key]); if(prior){await c.commit();return res.json({payment:prior,repeated:true});}
    const dueCents=Math.round(Number(s.annual_fee)*100)-Math.round(Number(s.amount_paid)*100); if(amountCents>dueCents){const ref=`STU-${require('crypto').randomUUID()}`;await c.execute("INSERT INTO payments (student_id,amount,status,reference,request_key,method) VALUES (?,?,'Failed',?,?,'SIMULATED')",[sid,amount,ref,key]);await c.commit();return res.status(400).json({error:'Payment failed: amount exceeds your outstanding balance.',reference:ref});}
    const ref=`STU-${require('crypto').randomUUID()}`;const [saved]=await c.execute("INSERT INTO payments (student_id,amount,status,reference,request_key,method) VALUES (?,?,'Simulated',?,?,'SIMULATED')",[sid,amount,ref,key]);
    const paidCents=Math.round(Number(s.amount_paid)*100)+amountCents,remainingCents=dueCents-amountCents;
    await c.execute('UPDATE students SET amount_paid=?,amount_due=?,fee_status=? WHERE id=?',[paidCents/100,remainingCents/100,remainingCents===0?'Paid':'Pending',sid]);await c.commit();res.json({payment:{id:saved.insertId,amount,status:'Simulated',reference:ref},simulated:true});
  }catch{await c.rollback().catch(()=>{});res.status(503).json({error:'Payment was not completed. Try again.'});}finally{c.release();}
});
app.get('/api/staff-passenger/me', requireRole('staff_passenger'), async (req,res) => {
  try {const sid=req.session.user.staffId;const [[staff]]=await db.execute('SELECT st.id,st.staff_code,st.full_name,st.department,st.daily_transport_rate,b.bus_name,sp.stop_name,r.route_name FROM staff st LEFT JOIN buses b ON b.id=st.bus_id LEFT JOIN stops sp ON sp.id=st.stop_id LEFT JOIN routes r ON r.id=sp.route_id WHERE st.id=?',[sid]);if(!staff)return res.status(404).json({error:'Staff transport record not found.'});
    const [charges]=await db.execute('SELECT boarding_date,daily_rate,amount,created_at FROM staff_boarding_charges WHERE staff_id=? ORDER BY boarding_date DESC LIMIT 500',[sid]);const [payments]=await db.execute("SELECT amount,status,reference,created_at FROM staff_payments WHERE staff_id=? ORDER BY created_at DESC LIMIT 500",[sid]);
    const [monthly]=await db.execute("SELECT DATE_FORMAT(boarding_date,'%Y-%m') month,COUNT(*) chargeable_days,SUM(amount) charges FROM staff_boarding_charges WHERE staff_id=? GROUP BY DATE_FORMAT(boarding_date,'%Y-%m') ORDER BY month DESC",[sid]);const [[totals]]=await db.execute("SELECT COALESCE((SELECT SUM(amount) FROM staff_boarding_charges WHERE staff_id=?),0) charges,COALESCE((SELECT SUM(amount) FROM staff_payments WHERE staff_id=? AND status='Simulated'),0) payments",[sid,sid]);res.json({staff,charges,payments,monthly,totals});
  }catch{res.status(503).json({error:'Staff fee details unavailable.'});}
});
app.post('/api/staff-passenger/payment', requireRole('staff_passenger'), async (req,res) => {
  const amount=Number(req.body?.amount),key=String(req.body?.requestKey||'');if(!Number.isFinite(amount)||amount<=0||!/^[-\w]{8,100}$/.test(key))return res.status(400).json({error:'Enter a valid payment amount and request reference.'});
  const c=await db.getConnection(),sid=req.session.user.staffId;try{await c.beginTransaction();const [[prior]]=await c.execute('SELECT id,amount,status,reference FROM staff_payments WHERE staff_id=? AND request_key=?',[sid,key]);if(prior){await c.commit();return res.json({payment:prior,repeated:true});}
    const [[t]]=await c.execute("SELECT COALESCE((SELECT SUM(amount) FROM staff_boarding_charges WHERE staff_id=?),0) charges,COALESCE((SELECT SUM(amount) FROM staff_payments WHERE staff_id=? AND status='Simulated'),0) payments",[sid,sid]);if(amount>Number(t.charges)-Number(t.payments)){const ref=`STF-${require('crypto').randomUUID()}`;await c.execute("INSERT INTO staff_payments (staff_id,amount,status,reference,request_key,method) VALUES (?,?,'Failed',?,?,'SIMULATED')",[sid,amount,ref,key]);await c.commit();return res.status(400).json({error:'Payment failed: amount exceeds your outstanding balance.',reference:ref});}
    const ref=`STF-${require('crypto').randomUUID()}`;const [saved]=await c.execute("INSERT INTO staff_payments (staff_id,amount,status,reference,request_key,method) VALUES (?,?,'Simulated',?,?,'SIMULATED')",[sid,amount,ref,key]);await c.commit();res.json({payment:{id:saved.insertId,amount,status:'Simulated',reference:ref},simulated:true});
  }catch{await c.rollback().catch(()=>{});res.status(503).json({error:'Payment was not completed. Try again.'});}finally{c.release();}
});
app.get('/api/admin/staff', requireRole('admin'), async (req,res) => {try{const q=`%${String(req.query.search||'').slice(0,80)}%`;const [rows]=await db.execute("SELECT st.id,st.staff_code,st.full_name,st.department,st.daily_transport_rate,COALESCE(ch.days,0) chargeable_days,COALESCE(ch.charges,0) total_charges,COALESCE(pm.payments,0) total_payments,COALESCE(ch.charges,0)-COALESCE(pm.payments,0) balance FROM staff st LEFT JOIN (SELECT staff_id,COUNT(*) days,SUM(amount) charges FROM staff_boarding_charges GROUP BY staff_id) ch ON ch.staff_id=st.id LEFT JOIN (SELECT staff_id,SUM(amount) payments FROM staff_payments WHERE status='Simulated' GROUP BY staff_id) pm ON pm.staff_id=st.id WHERE st.staff_code LIKE ? OR st.full_name LIKE ? ORDER BY st.staff_code",[q,q]);res.json({staff:rows});}catch{res.status(503).json({error:'Staff list unavailable.'});}});
app.get('/api/admin/students/:id/history', requireRole('admin'), async (req,res) => {try{const [payments]=await db.execute('SELECT id,amount,status,reference,created_at FROM payments WHERE student_id=? ORDER BY created_at DESC',[req.params.id]);const [scans]=await db.execute("SELECT id,roll_number,scan_type,result,created_at FROM scan_records WHERE student_id=? ORDER BY created_at DESC LIMIT 100",[req.params.id]);res.json({payments,scans});}catch{res.status(503).json({error:'Student history unavailable.'});}});
app.get('/api/admin/staff/:id/history', requireRole('admin'), async (req,res) => {try{const [charges]=await db.execute('SELECT id,boarding_date,daily_rate,amount,created_at FROM staff_boarding_charges WHERE staff_id=? ORDER BY boarding_date DESC LIMIT 500',[req.params.id]);const [payments]=await db.execute("SELECT id,amount,status,reference,created_at FROM staff_payments WHERE staff_id=? ORDER BY created_at DESC LIMIT 500",[req.params.id]);const [scans]=await db.execute("SELECT id,roll_number,result,created_at FROM scan_records WHERE staff_id=? ORDER BY created_at DESC LIMIT 100",[req.params.id]);res.json({charges,payments,scans});}catch{res.status(503).json({error:'Staff history unavailable.'});}});
app.patch('/api/admin/staff/:id/rate', requireRole('admin'), async (req,res) => {const rate=Number(req.body?.dailyRate);if(!Number.isFinite(rate)||rate<0||rate>100000)return res.status(400).json({error:'Enter a daily rate from 0 to 100000.'});try{const [r]=await db.execute('UPDATE staff SET daily_transport_rate=? WHERE id=?',[rate,req.params.id]);if(!r.affectedRows)return res.status(404).json({error:'Staff record not found.'});res.json({ok:true});}catch{res.status(503).json({error:'Staff rate was not updated.'});}});
app.get('/api/admin/summary', requireRole('admin'), async (_req,res) => {
  try {
    const [[students]] = await db.query('SELECT COUNT(*) total, SUM(fee_status="Pending") pending FROM students');
    const [[scans]] = await db.query('SELECT COUNT(*) total FROM scan_records WHERE DATE(created_at)=CURRENT_DATE()');
    const [recent] = await db.query('SELECT sr.id,sr.roll_number,sr.scan_type,s.full_name student_name,stf.full_name staff_name,sr.result,b.bus_name,sr.created_at FROM scan_records sr LEFT JOIN students s ON s.id=sr.student_id LEFT JOIN staff stf ON stf.id=sr.staff_id LEFT JOIN buses b ON b.id=sr.bus_id ORDER BY sr.created_at DESC LIMIT 30');
    res.json({students,pending:Number(students.pending)||0,todayScans:scans.total,recent});
  } catch { res.status(503).json({error:'Dashboard unavailable.'}); }
});
app.get('/api/admin/students', requireRole('admin'), async (req,res) => {
  const rawSearch = String(req.query.search || '').trim().slice(0,80);
  if (/^\d+$/.test(rawSearch) && rawSearch.length > 6) return res.status(400).json({error:'Roll-number searches can contain at most six digits.'});
  const search = `%${rawSearch}%`;
  try { const [rows] = await db.execute('SELECT s.id,s.roll_number,s.full_name,s.department,s.year_of_study,s.annual_fee,s.amount_paid,s.fee_status,s.amount_due,b.bus_name,st.stop_name FROM students s LEFT JOIN buses b ON b.id=s.bus_id LEFT JOIN stops st ON st.id=s.stop_id WHERE s.roll_number LIKE ? OR s.full_name LIKE ? ORDER BY s.full_name LIMIT 100',[search,search]); res.json({students:rows}); }
  catch { res.status(503).json({error:'Student list unavailable.'}); }
});
app.use('/vendor/zxing', express.static(path.join(__dirname, 'node_modules/@zxing/browser/umd')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = Number(process.env.PORT) || 3000;
if (httpsMode) {
  const certDir = path.join(__dirname, '.local-https');
  const certFile = process.env.HTTPS_CERT_FILE || path.join(certDir, 'server-cert.pem');
  const keyFile = process.env.HTTPS_KEY_FILE || path.join(certDir, 'server-key.pem');
  const hostFile = path.join(certDir, 'host.txt');
  try {
    const host = process.env.HTTPS_HOST || fs.readFileSync(hostFile, 'utf8').trim();
    if (!net.isIPv4(host)) throw new Error('The selected HTTPS host is not a valid IPv4 address.');
    const server = https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, app);
    server.listen(port, host, () => console.log(`College Bus demo listening on https://${host}:${port}`));
  } catch (error) {
    console.error(`HTTPS startup failed: ${error.message}. Run npm.cmd run cert:dev first.`);
    process.exitCode = 1;
  }
} else {
  app.listen(port, '0.0.0.0', () => console.log(`College Bus demo listening on http://0.0.0.0:${port}`));
}
