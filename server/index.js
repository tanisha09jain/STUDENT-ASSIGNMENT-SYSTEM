const path = require('path');
const fs = require('fs');
const { openDb, seed } = require('./db');
const { createApp } = require('./app');

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
const db = openDb(process.env.DB_FILE || path.join(root, 'data', 'app.db'));
if (seed(db)) console.log('Demo data created.');

const port = process.env.PORT || 3000;
createApp(db, { uploadDir: path.join(root, 'uploads') }).listen(port, () => {
  console.log(`Student Assignment System running at http://localhost:${port}`);
});
