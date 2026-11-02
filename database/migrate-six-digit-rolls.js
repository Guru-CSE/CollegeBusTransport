const fs = require('fs');
const path = require('path');
const db = require('../db');

const valid = /^\d{6}$/;

async function migrate() {
  const connection = await db.getConnection();
  try {
    const [students] = await connection.query('SELECT * FROM students ORDER BY id');
    const [users] = await connection.query('SELECT id,username,role,student_id,created_at FROM users ORDER BY id');
    const [scans] = await connection.query('SELECT * FROM scan_records ORDER BY id');
    const backupDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `roll-number-before-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ backedUpAt: new Date().toISOString(), students, users, scans }, null, 2), { flag: 'wx' });

    const demoStudentIds = new Map(users.filter(user => ['student-paid', 'student-pending'].includes(user.username)).map(user => [user.student_id, user.username]));
    const toChange = students.filter(student => !valid.test(student.roll_number));
    toChange.sort((a, b) => {
      const priority = id => demoStudentIds.get(id) === 'student-paid' ? 0 : demoStudentIds.get(id) === 'student-pending' ? 1 : 2;
      return priority(a.id) - priority(b.id) || a.id - b.id;
    });
    const reserved = new Set(students.filter(student => valid.test(student.roll_number)).map(student => student.roll_number));
    let candidate = 680377;
    const assignments = toChange.map(student => {
      while (reserved.has(String(candidate)) && candidate <= 999999) candidate++;
      if (candidate > 999999) throw new Error('No unused six-digit roll numbers remain.');
      const roll = String(candidate++);
      reserved.add(roll);
      return { id: student.id, old: student.roll_number, roll };
    });

    await connection.beginTransaction();
    try {
      for (const item of assignments) {
        await connection.execute('UPDATE scan_records SET roll_number=? WHERE student_id=?', [item.roll, item.id]);
        await connection.execute('UPDATE students SET roll_number=? WHERE id=?', [item.roll, item.id]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    await connection.query('ALTER TABLE students MODIFY roll_number CHAR(6) NOT NULL');
    const [[check]] = await connection.execute("SELECT COUNT(*) AS total FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='students' AND constraint_name='chk_students_roll_number_six_digits'");
    if (!Number(check.total)) {
      await connection.query("ALTER TABLE students ADD CONSTRAINT chk_students_roll_number_six_digits CHECK (roll_number REGEXP '^[0-9]{6}$')");
    }

    const [after] = await connection.query('SELECT id,roll_number FROM students ORDER BY id');
    if (after.some(student => !valid.test(student.roll_number)) || new Set(after.map(student => student.roll_number)).size !== after.length) {
      throw new Error('Post-migration roll-number validation failed.');
    }
    console.log(`Backup saved: ${path.relative(process.cwd(), backupPath)}`);
    console.log(`Student rows preserved: ${after.length}; linked scan rows updated: ${assignments.length ? 'for each migrated student' : 'none needed'}`);
    for (const item of assignments) console.log(`Student ID ${item.id}: ${item.old} -> ${item.roll}`);
    console.log('Six-digit roll-number constraint is active.');
  } finally {
    connection.release();
    await db.end();
  }
}

migrate().catch(error => {
  console.error('Roll-number migration failed:', error.code || error.message);
  process.exitCode = 1;
});
