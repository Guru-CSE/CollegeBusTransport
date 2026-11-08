const db = require('../db');

async function has(sql, values) {
  const [[row]] = await db.execute(sql, values);
  return Number(row.total) > 0;
}

async function migrate() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(150) NOT NULL,
      message TEXT NOT NULL,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      audience ENUM('everyone','students','staff') NOT NULL DEFAULT 'everyone',
      expires_at DATETIME(3) NOT NULL DEFAULT '2099-12-31 23:59:59.999',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_announcement_visibility (is_published,audience,expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const columns = [
      ['audience', "ALTER TABLE announcements ADD COLUMN audience ENUM('everyone','students','staff') NOT NULL DEFAULT 'everyone'"],
      ['expires_at', "ALTER TABLE announcements ADD COLUMN expires_at DATETIME(3) NOT NULL DEFAULT '2099-12-31 23:59:59.999'"],
      ['updated_at', 'ALTER TABLE announcements ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP']
    ];
    for (const [name, alter] of columns) {
      if (!(await has('SELECT COUNT(*) total FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?', ['announcements', name]))) {
        await db.query(alter);
      }
    }
    if (!(await has('SELECT COUNT(*) total FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?', ['announcements', 'idx_announcement_visibility']))) {
      await db.query('CREATE INDEX idx_announcement_visibility ON announcements (is_published,audience,expires_at)');
    }
    console.log('Announcement management schema ready.');
  } finally {
    await db.end();
  }
}

migrate().catch(error => {
  console.error('Announcement migration failed:', error.code || error.message);
  process.exitCode = 1;
});
