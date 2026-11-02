// Run with the app server on localhost: node database/verify-implementation.js
const assert = require('node:assert/strict');
const db = require('../db');
const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
async function main() {
  // Remove only the precise recent test signatures left by an interrupted prior run.
  const [stale] = await db.execute("SELECT id,charge_id FROM scan_records WHERE scanned_by=(SELECT id FROM users WHERE username='staff') AND roll_number IN ('680377','680378','999999','STF001') AND result IN ('Eligible','Fee Pending','Unknown/Unable to Verify','Staff boarding recorded','Already charged today') AND created_at>=NOW()-INTERVAL 10 MINUTE");
  if (stale.length) {
    const ids=stale.map(x=>x.id),marks=ids.map(()=>'?').join(',');
    await db.execute(`UPDATE scan_records SET charge_id=NULL WHERE id IN (${marks})`,ids);
    await db.execute(`UPDATE staff_boarding_charges SET scan_record_id=NULL WHERE scan_record_id IN (${marks})`,ids);
    const cids=[...new Set(stale.map(x=>x.charge_id).filter(Boolean))]; if(cids.length) await db.execute(`DELETE FROM staff_boarding_charges WHERE id IN (${cids.map(()=>'?').join(',')})`,cids);
    await db.execute(`DELETE FROM scan_records WHERE id IN (${marks})`,ids);
  }
  const before = await db.query('SELECT COALESCE(MAX(id),0) id FROM scan_records');
  const watermark = Number(before[0][0].id);
  const prior = await db.execute('SELECT id FROM staff_boarding_charges WHERE staff_id=(SELECT id FROM staff WHERE staff_code=? LIMIT 1) AND boarding_date=CURRENT_DATE()', ['STF001']);
  const hadCharge = prior[0].length > 0;
  let cookie, operatorId;
  try {
    const login = await fetch(`${base}/api/login`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username:'staff',password:'staff-demo-123'}) });
    assert.equal(login.status,200,'bus operator login'); cookie=login.headers.get('set-cookie').split(';')[0];
    const me = await fetch(`${base}/api/me`,{headers:{cookie}}).then(r=>r.json()); operatorId=me.user.id;
    const scan = async id => fetch(`${base}/api/verify`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id})});
    let r=await scan('680377'); assert.equal(r.status,200); let d=await r.json(); assert.equal(d.result,'Eligible'); assert.equal(d.student.roll_number,'680377');
    r=await scan('680378'); d=await r.json(); assert.equal(d.result,'Fee Pending');
    r=await scan('999999'); d=await r.json(); assert.equal(d.result,'Unknown/Unable to Verify');
    const results=await Promise.all([scan('STF001'),scan('STF001'),scan('STF001')]); const data=await Promise.all(results.map(x=>x.json()));
    assert(data.every(x=>['Staff boarding recorded','Already charged today'].includes(x.result)));
    assert(data.some(x=>x.staff?.staff_code==='STF001'&&Number(x.charge.daily_rate)===Number(x.staff.daily_transport_rate)));
    const [charges]=await db.execute('SELECT COUNT(*) count FROM staff_boarding_charges WHERE staff_id=(SELECT id FROM staff WHERE staff_code=?) AND boarding_date=CURRENT_DATE()',['STF001']);
    assert.equal(Number(charges[0].count),1,'one daily charge after concurrent scans');
    const denied=await fetch(`${base}/api/verify`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id:'NOT-AN-ID'})});assert.equal(denied.status,400);
    console.log('PASS: student eligibility/pending/unknown scans; staff rate snapshot; concurrent once-per-day charge; invalid ID handling.');
  } finally {
    if (operatorId) {
      const [ids]=await db.execute('SELECT id,charge_id FROM scan_records WHERE id>? AND scanned_by=?',[watermark,operatorId]);
      const scanIds=ids.map(x=>x.id);
      if(scanIds.length){
        const marks=scanIds.map(()=>'?').join(',');
        await db.execute(`UPDATE scan_records SET charge_id=NULL WHERE id IN (${marks})`,scanIds);
        await db.execute(`UPDATE staff_boarding_charges SET scan_record_id=NULL WHERE scan_record_id IN (${marks})`,scanIds);
        const cids=[...new Set(ids.map(x=>x.charge_id).filter(Boolean))]; if(!hadCharge&&cids.length) await db.execute(`DELETE FROM staff_boarding_charges WHERE id IN (${cids.map(()=>'?').join(',')})`,cids);
        await db.execute(`DELETE FROM scan_records WHERE id IN (${marks})`,scanIds);
      }
    }
    await db.end();
  }
}
main().catch(error=>{console.error('FAIL:',error.message);process.exitCode=1;});
