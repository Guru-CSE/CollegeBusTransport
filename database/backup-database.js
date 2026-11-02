const fs = require('fs');
const path = require('path');

async function backupDatabase(connection, label = 'database-backup') {
  const [[meta]] = await connection.query('SELECT DATABASE() AS databaseName, VERSION() AS mysqlVersion');
  const [tableRows] = await connection.query('SHOW TABLES');
  const tableNames = tableRows.map(row => Object.values(row)[0]);
  const tables = {};
  for (const name of tableNames) {
    const escapedName = `\`${String(name).replace(/`/g, '``')}\``;
    const [structureRows] = await connection.query(`SHOW CREATE TABLE ${escapedName}`);
    const [rows] = await connection.query(`SELECT * FROM ${escapedName}`);
    tables[name] = { createTable: Object.values(structureRows[0])[1], rows };
  }

  const backupDir = path.join(__dirname, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `${label}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ backedUpAt: new Date().toISOString(), ...meta, tables }, null, 2), { flag: 'wx' });
  return { file, tableNames, counts: Object.fromEntries(Object.entries(tables).map(([name, data]) => [name, data.rows.length])) };
}

module.exports = backupDatabase;

if (require.main === module) {
  const db = require('../db');
  (async () => {
    try {
      const backup = await backupDatabase(db, 'full-db-before-portals');
      console.log(`Backup saved: ${path.relative(process.cwd(), backup.file)}`);
      console.log(`Tables backed up: ${backup.tableNames.length}`);
    } catch (error) {
      console.error('Database backup failed:', error.code || error.message);
      process.exitCode = 1;
    } finally {
      await db.end();
    }
  })();
}
