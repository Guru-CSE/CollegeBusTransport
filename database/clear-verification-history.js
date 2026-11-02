const fs = require('fs');
const path = require('path');
const db = require('../db');

async function clearHistory() {
  if (!process.argv.includes('--confirm-clear')) {
    throw new Error('This operation requires the explicit --confirm-clear flag.');
  }
  const connection = await db.getConnection();
  try {
    const [tableRows] = await connection.query('SHOW TABLES');
    const historyTables = tableRows.map(row => Object.values(row)[0]).filter(name => /scan|verification/i.test(name));
    if (historyTables.length !== 1 || historyTables[0] !== 'scan_records') {
      throw new Error(`Expected only scan_records as verification history; found: ${historyTables.join(', ') || 'none'}. No history was deleted.`);
    }
    const [children] = await connection.execute("SELECT table_name FROM information_schema.key_column_usage WHERE referenced_table_schema=DATABASE() AND referenced_table_name='scan_records'");
    if (children.length) throw new Error('Another table references scan_records; inspect dependent records before clearing. No history was deleted.');

    const [[database]] = await connection.query('SELECT DATABASE() AS name');
    const [structureRows] = await connection.query('SHOW CREATE TABLE scan_records');
    const [history] = await connection.query('SELECT * FROM scan_records ORDER BY id');
    const [[paymentsBefore]] = await connection.query('SELECT COUNT(*) AS total FROM payments');
    const backupDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `scan-history-before-clear-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({ backedUpAt:new Date().toISOString(), databaseName:database.name, table:'scan_records', createTable:Object.values(structureRows[0])[1], count:history.length, rows:history }, null, 2), { flag:'wx' });

    await connection.beginTransaction();
    let deleted;
    try {
      const [result] = await connection.query('DELETE FROM scan_records');
      deleted = result.affectedRows;
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const [[remaining]] = await connection.query('SELECT COUNT(*) AS total FROM scan_records');
    const [[paymentsAfter]] = await connection.query('SELECT COUNT(*) AS total FROM payments');
    if (Number(remaining.total) !== 0 || Number(paymentsAfter.total) !== Number(paymentsBefore.total)) {
      throw new Error('Post-clear verification failed: history or payment counts do not match expectations.');
    }
    console.log(`Scan history backup saved: ${path.relative(process.cwd(), backupFile)}`);
    console.log(`Verification rows deleted: ${deleted}; scan_records now has ${remaining.total} rows.`);
    console.log(`Payment rows preserved: ${paymentsAfter.total}. Auto-increment was not reset.`);
  } finally {
    connection.release();
    await db.end();
  }
}

clearHistory().catch(error => {
  console.error('Verification-history clear failed:', error.code || error.message);
  process.exitCode = 1;
});
