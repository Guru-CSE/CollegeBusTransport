const db = require('../db');
const backupDatabase = require('./backup-database');

async function has(connection, sql, values) {
  const [[row]] = await connection.execute(sql, values);
  return Number(row.total) > 0;
}

async function migrate() {
  const c = await db.getConnection();
  try {
    const backup = await backupDatabase(c, 'full-db-before-complete-migration');
    console.log(`Pre-migration backup: ${require('path').relative(process.cwd(), backup.file)}`);
    await c.query(`CREATE TABLE IF NOT EXISTS staff_boarding_charges (
      id BIGINT AUTO_INCREMENT PRIMARY KEY, staff_id INT NOT NULL, boarding_date DATE NOT NULL,
      daily_rate DECIMAL(10,2) NOT NULL, amount DECIMAL(10,2) NOT NULL,
      scan_record_id BIGINT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_staff_charge_day (staff_id, boarding_date),
      INDEX idx_staff_charge_date (boarding_date),
      CONSTRAINT fk_charge_staff FOREIGN KEY (staff_id) REFERENCES staff(id),
      CONSTRAINT fk_charge_scan FOREIGN KEY (scan_record_id) REFERENCES scan_records(id),
      CONSTRAINT chk_charge_amount CHECK (amount >= 0 AND daily_rate >= 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await c.query(`CREATE TABLE IF NOT EXISTS staff_payments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY, staff_id INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL, status ENUM('Simulated','Failed') NOT NULL DEFAULT 'Simulated',
      reference VARCHAR(48) NOT NULL UNIQUE, request_key VARCHAR(100) NOT NULL UNIQUE,
      method VARCHAR(32) NOT NULL DEFAULT 'SIMULATED', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_staff_payment (staff_id, created_at),
      CONSTRAINT fk_staff_payment_staff FOREIGN KEY (staff_id) REFERENCES staff(id),
      CONSTRAINT chk_staff_payment_amount CHECK (amount > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const paymentCols = [
      ['reference', 'ALTER TABLE payments ADD COLUMN reference VARCHAR(48) NULL'],
      ['request_key', 'ALTER TABLE payments ADD COLUMN request_key VARCHAR(100) NULL'],
      ['method', "ALTER TABLE payments ADD COLUMN method VARCHAR(32) NOT NULL DEFAULT 'SIMULATED'"]
    ];
    for (const [name, alter] of paymentCols) if (!(await has(c, 'SELECT COUNT(*) total FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=\'payments\' AND column_name=?', [name]))) await c.query(alter);
    const [legacyPayments] = await c.query('SELECT id FROM payments WHERE reference IS NULL OR request_key IS NULL');
    for (const p of legacyPayments) await c.execute('UPDATE payments SET reference=COALESCE(reference,?),request_key=COALESCE(request_key,?) WHERE id=?', [`LEGACY-${p.id}`, `LEGACY-${p.id}`, p.id]);
    await c.query('ALTER TABLE payments MODIFY reference VARCHAR(48) NOT NULL, MODIFY request_key VARCHAR(100) NOT NULL');
    if (!(await has(c, "SELECT COUNT(*) total FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='payments' AND index_name='uq_student_payment_reference'", []))) await c.query('ALTER TABLE payments ADD UNIQUE KEY uq_student_payment_reference (reference)');
    if (!(await has(c, "SELECT COUNT(*) total FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='payments' AND index_name='uq_student_payment_request'", []))) await c.query('ALTER TABLE payments ADD UNIQUE KEY uq_student_payment_request (student_id,request_key)');
    const scanCols = [
      ['scan_type', "ALTER TABLE scan_records ADD COLUMN scan_type ENUM('student','staff','unknown') NOT NULL DEFAULT 'student'"],
      ['staff_id', 'ALTER TABLE scan_records ADD COLUMN staff_id INT NULL'],
      ['charge_id', 'ALTER TABLE scan_records ADD COLUMN charge_id BIGINT NULL']
    ];
    for (const [name, alter] of scanCols) {
      if (!(await has(c, 'SELECT COUNT(*) total FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=\'scan_records\' AND column_name=?', [name]))) await c.query(alter);
    }
    await c.query("ALTER TABLE scan_records MODIFY result ENUM('Eligible','Fee Pending','Unknown/Unable to Verify','Error','Staff boarding recorded','Already charged today') NOT NULL");
    if (!(await has(c, "SELECT COUNT(*) total FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='scan_records' AND constraint_name='fk_scan_staff'", []))) await c.query('ALTER TABLE scan_records ADD CONSTRAINT fk_scan_staff FOREIGN KEY (staff_id) REFERENCES staff(id)');
    if (!(await has(c, "SELECT COUNT(*) total FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='scan_records' AND constraint_name='fk_scan_charge'", []))) await c.query('ALTER TABLE scan_records ADD CONSTRAINT fk_scan_charge FOREIGN KEY (charge_id) REFERENCES staff_boarding_charges(id)');
    const [[orphans]] = await c.query('SELECT COUNT(*) total FROM users u LEFT JOIN students s ON s.id=u.student_id WHERE u.role=\'student\' AND u.student_id IS NOT NULL AND s.id IS NULL');
    if (!Number(orphans.total) && !(await has(c, "SELECT COUNT(*) total FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='users' AND constraint_name='fk_user_student'", []))) await c.query('ALTER TABLE users ADD CONSTRAINT fk_user_student FOREIGN KEY (student_id) REFERENCES students(id)');
    else if (Number(orphans.total)) console.warn(`Student profile FK skipped: ${orphans.total} existing orphan account links.`);
    const [[dupes]] = await c.query('SELECT COUNT(*) total FROM (SELECT staff_id,boarding_date FROM staff_boarding_charges GROUP BY staff_id,boarding_date HAVING COUNT(*)>1) d');
    if (Number(dupes.total)) throw new Error('Duplicate staff/day charges prevent unique constraint; preserved data for manual review.');
    console.log('Staff charge/payment ledgers and scan relationships ready.');
  } finally { c.release(); await db.end(); }
}
migrate().catch(error => { console.error('Complete migration failed:', error.code || error.message); process.exitCode = 1; });
