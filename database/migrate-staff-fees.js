const db = require('../db');
const backupDatabase = require('./backup-database');

async function exists(query, values) {
  const [[row]] = await db.execute(query, values);
  return Number(row.total) > 0;
}

async function migrate() {
  const connection = await db.getConnection();
  try {
    const backup = await backupDatabase(connection, 'full-db-before-staff-fees-migration');
    console.log(`Pre-migration backup saved: ${require('path').relative(process.cwd(), backup.file)}`);

    await connection.query(`CREATE TABLE IF NOT EXISTS staff (
      id INT AUTO_INCREMENT PRIMARY KEY,
      staff_code VARCHAR(20) NOT NULL UNIQUE,
      full_name VARCHAR(120) NOT NULL,
      department VARCHAR(80) NOT NULL,
      daily_transport_rate DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_staff_daily_transport_rate CHECK (daily_transport_rate >= 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    if (!(await exists("SELECT COUNT(*) AS total FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='students' AND column_name='annual_fee'", []))) {
      await connection.query('ALTER TABLE students ADD COLUMN annual_fee DECIMAL(10,2) NOT NULL DEFAULT 12000.00 AFTER amount_due');
    }
    if (!(await exists("SELECT COUNT(*) AS total FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='students' AND column_name='amount_paid'", []))) {
      await connection.query('ALTER TABLE students ADD COLUMN amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER annual_fee');
    }
    if (!(await exists("SELECT COUNT(*) AS total FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name='staff_id'", []))) {
      await connection.query('ALTER TABLE users ADD COLUMN staff_id INT NULL AFTER student_id');
    }

    await connection.query("ALTER TABLE users MODIFY role ENUM('admin','bus_staff','student','staff_passenger') NOT NULL");

    if (!(await exists("SELECT COUNT(*) AS total FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='users' AND index_name='uq_users_staff_id'", []))) {
      await connection.query('ALTER TABLE users ADD UNIQUE KEY uq_users_staff_id (staff_id)');
    }
    if (!(await exists("SELECT COUNT(*) AS total FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='users' AND constraint_name='fk_user_staff'", []))) {
      await connection.query('ALTER TABLE users ADD CONSTRAINT fk_user_staff FOREIGN KEY (staff_id) REFERENCES staff(id)');
    }
    if (!(await exists("SELECT COUNT(*) AS total FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='users' AND constraint_name='chk_user_staff_link'", []))) {
      await connection.query("ALTER TABLE users ADD CONSTRAINT chk_user_staff_link CHECK ((role='staff_passenger' AND staff_id IS NOT NULL AND student_id IS NULL) OR (role<>'staff_passenger' AND staff_id IS NULL))");
    }

    console.log('Staff and student fee columns are ready; existing tables and records were preserved.');
  } finally {
    connection.release();
    await db.end();
  }
}

migrate().catch(error => {
  console.error('Staff/fee migration failed:', error.code || error.message);
  process.exitCode = 1;
});
