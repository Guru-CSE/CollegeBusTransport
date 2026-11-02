const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const db = require('./db');

const annualFee = 12000;
const students = [
  { roll: '680377', name: 'Aarav Demo', department: 'CSE', year: 2, paid: 12000 },
  { roll: '680378', name: 'Mira Sample', department: 'ECE', year: 3, paid: 6000 },
  { roll: '680379', name: 'Arjun Kumar', department: 'CSE', year: 1, paid: 0 },
  { roll: '680380', name: 'Priya Nair', department: 'ECE', year: 2, paid: 12000 },
  { roll: '680381', name: 'Rahul Das', department: 'Mechanical', year: 3, paid: 8000 },
  { roll: '680382', name: 'Divya Raj', department: 'IT', year: 1, paid: 0 },
  { roll: '680383', name: 'Sanjay Kumar', department: 'Civil', year: 4, paid: 12000 },
  { roll: '680384', name: 'Nila Thomas', department: 'CSE', year: 2, paid: 4000 },
  { roll: '680385', name: 'Kavin Raj', department: 'EEE', year: 3, paid: 12000 },
  { roll: '680386', name: 'Ananya S', department: 'IT', year: 1, paid: 6000 }
];
const staff = [
  { code: 'STF001', name: 'Meena Demo', department: 'CSE', rate: 30 },
  { code: 'STF002', name: 'Ravi Sample', department: 'ECE', rate: 30 },
  { code: 'STF003', name: 'Lakshmi Raj', department: 'Mathematics', rate: 25 },
  { code: 'STF004', name: 'Karthik Demo', department: 'Mechanical', rate: 30 },
  { code: 'STF005', name: 'Divya Sample', department: 'Administration', rate: 25 }
];

async function requireOrInsertSharedRecord(conn, sql, values, expected, label) {
  const [rows] = await conn.execute(sql, values);
  if (rows[0]) {
    if (!expected(rows[0])) throw new Error(`Existing ${label} conflicts with the demo seed; no records were changed.`);
    return rows[0];
  }
  return null;
}

async function ensureAccount(conn, { username, password, role, studentId = null, staffId = null }) {
  const [rows] = await conn.execute('SELECT id,role,student_id,staff_id FROM users WHERE username=?', [username]);
  if (rows[0]) {
    const account = rows[0];
    const existingStudentId = account.student_id === null ? null : Number(account.student_id);
    const existingStaffId = account.staff_id === null ? null : Number(account.staff_id);
    if (account.role !== role || existingStudentId !== (studentId === null ? null : Number(studentId)) || existingStaffId !== (staffId === null ? null : Number(staffId))) {
      throw new Error(`Existing demo username ${username} is linked to a different role or record; no account was overwritten.`);
    }
    return account.id;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const [inserted] = await conn.execute('INSERT INTO users (username,password_hash,role,student_id,staff_id) VALUES (?,?,?,?,?)', [username,passwordHash,role,studentId,staffId]);
  return inserted.insertId;
}

async function seed() {
  const conn = await db.getConnection();
  try {
    const route = await requireOrInsertSharedRecord(conn, 'SELECT id,route_name FROM routes WHERE id=1', [], row => row.route_name === 'North Campus', 'demo route');
    if (!route) await conn.query("INSERT INTO routes (id,route_name) VALUES (1,'North Campus')");
    const bus = await requireOrInsertSharedRecord(conn, 'SELECT id,bus_name,registration_no FROM buses WHERE id=1 OR registration_no=? LIMIT 1', ['DEMO-001'], row => row.id === 1 && row.bus_name === 'Demo Bus 1' && row.registration_no === 'DEMO-001', 'demo bus');
    if (!bus) await conn.query("INSERT INTO buses (id,bus_name,registration_no) VALUES (1,'Demo Bus 1','DEMO-001')");
    const stop = await requireOrInsertSharedRecord(conn, 'SELECT id,route_id,stop_name FROM stops WHERE id=1', [], row => row.route_id === 1 && row.stop_name === 'Library Gate', 'demo stop');
    if (!stop) await conn.query("INSERT INTO stops (id,route_id,stop_name) VALUES (1,1,'Library Gate')");

    await conn.beginTransaction();
    try {
      const studentIds = new Map();
      for (const student of students) {
        const due = annualFee - student.paid;
        const status = due === 0 ? 'Paid' : 'Pending';
        const [rows] = await conn.execute('SELECT id,full_name FROM students WHERE roll_number=?', [student.roll]);
        let id;
        if (rows[0]) {
          if (rows[0].full_name !== student.name) throw new Error(`Roll ${student.roll} already belongs to a different name; no demo student was overwritten.`);
          id = rows[0].id;
          await conn.execute('UPDATE students SET department=?,year_of_study=?,fee_status=?,amount_due=?,annual_fee=?,amount_paid=? WHERE id=?', [student.department,student.year,status,due,annualFee,student.paid,id]);
        } else {
          const [inserted] = await conn.execute('INSERT INTO students (roll_number,full_name,department,year_of_study,bus_id,stop_id,fee_status,amount_due,annual_fee,amount_paid) VALUES (?,?,?,?,1,1,?,?,?,?)', [student.roll,student.name,student.department,student.year,status,due,annualFee,student.paid]);
          id = inserted.insertId;
        }
        studentIds.set(student.roll, id);
      }

      const staffIds = new Map();
      for (const person of staff) {
        const [rows] = await conn.execute('SELECT id,full_name,department,daily_transport_rate FROM staff WHERE staff_code=?', [person.code]);
        let id;
        if (rows[0]) {
          const existing = rows[0];
          if (existing.full_name !== person.name || existing.department !== person.department || Number(existing.daily_transport_rate) !== person.rate) {
            throw new Error(`Staff ID ${person.code} conflicts with existing data; no staff record was overwritten.`);
          }
          id = existing.id;
        } else {
          const [inserted] = await conn.execute('INSERT INTO staff (staff_code,full_name,department,daily_transport_rate) VALUES (?,?,?,?)', [person.code,person.name,person.department,person.rate]);
          id = inserted.insertId;
        }
        staffIds.set(person.code, id);
      }

      await ensureAccount(conn, { username:'admin', password:'admin-demo-123', role:'admin' });
      await ensureAccount(conn, { username:'staff', password:'staff-demo-123', role:'bus_staff' });
      await ensureAccount(conn, { username:'student-paid', password:'student-demo-123', role:'student', studentId:studentIds.get('680377') });
      await ensureAccount(conn, { username:'student-pending', password:'student-demo-123', role:'student', studentId:studentIds.get('680378') });
      for (const student of students.slice(2)) {
        await ensureAccount(conn, { username:`student-${student.roll}`, password:'student-demo-123', role:'student', studentId:studentIds.get(student.roll) });
      }
      for (const person of staff) {
        await ensureAccount(conn, { username:`staff-${person.code.toLowerCase()}`, password:'staff-demo-123', role:'staff_passenger', staffId:staffIds.get(person.code) });
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    }

    const [constraints] = await conn.execute("SELECT constraint_name AS constraint_name FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='students' AND constraint_name IN ('chk_students_fee_balance','chk_students_fee_status')");
    const existingConstraints = new Set(constraints.map(row => row.constraint_name));
    if (!existingConstraints.has('chk_students_fee_balance')) await conn.query("ALTER TABLE students ADD CONSTRAINT chk_students_fee_balance CHECK (annual_fee >= 0 AND amount_paid >= 0 AND amount_paid <= annual_fee AND amount_due = annual_fee - amount_paid)");
    if (!existingConstraints.has('chk_students_fee_status')) await conn.query("ALTER TABLE students ADD CONSTRAINT chk_students_fee_status CHECK ((amount_due = 0 AND fee_status = 'Paid') OR (amount_due > 0 AND fee_status = 'Pending'))");
    console.log('Demo student/staff records and hashed accounts are present; existing matching IDs and accounts were preserved.');
  } finally {
    conn.release();
    await db.end();
  }
}

seed().catch(error => {
  console.error('Demo seed failed:', error.code || error.message);
  process.exitCode = 1;
});
