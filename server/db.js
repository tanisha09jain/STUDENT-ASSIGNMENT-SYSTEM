// Database setup (SQLite) and demo data.
const { DatabaseSync } = require('node:sqlite'); // built into Node 22, nothing to compile
const bcrypt = require('bcryptjs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
  must_change_password INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  teacher_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS enrollments (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, course_id)
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  deadline TEXT NOT NULL,
  max_marks INTEGER NOT NULL CHECK (max_marks > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT,
  file_path TEXT,
  answer_text TEXT,
  is_late INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assignment_id, student_id)
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  marks REAL NOT NULL,
  feedback TEXT NOT NULL,
  graded_by INTEGER NOT NULL REFERENCES users(id),
  graded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // Upgrade older database files that were created before this column existed.
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userColumns.includes('must_change_password')) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }
  // Small helper: run fn() inside a database transaction.
  db.transaction = (fn) => () => {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return db;
}

function localInput(daysFromNow) {
  const d = new Date(Date.now() + daysFromNow * 86400000);
  d.setHours(23, 59, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function seed(db) {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return false;
  const addUser = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)');
  const u = (name, email, pw, role) => addUser.run(name, email, bcrypt.hashSync(pw, 8), role).lastInsertRowid;
  u('System Admin', 'admin@college.edu', 'admin123', 'admin');
  const t1 = u('Dr. Anita Sharma', 'teacher@college.edu', 'teacher123', 'teacher');
  const t2 = u('Prof. Rohan Mehta', 'teacher2@college.edu', 'teacher123', 'teacher');
  const s1 = u('Rahul Verma', 'student@college.edu', 'student123', 'student');
  const s2 = u('Priya Nair', 'priya@college.edu', 'student123', 'student');
  const s3 = u('Aman Gupta', 'aman@college.edu', 'student123', 'student');

  const addCourse = db.prepare('INSERT INTO courses (code,name,teacher_id) VALUES (?,?,?)');
  const c1 = addCourse.run('CSE3132', 'Software Engineering Lab', t1).lastInsertRowid;
  const c2 = addCourse.run('CSE3101', 'Database Systems', t2).lastInsertRowid;
  const enroll = db.prepare('INSERT INTO enrollments (student_id,course_id) VALUES (?,?)');
  [[s1, c1], [s2, c1], [s3, c1], [s1, c2], [s2, c2]].forEach((r) => enroll.run(...r));

  const addA = db.prepare('INSERT INTO assignments (course_id,title,description,deadline,max_marks) VALUES (?,?,?,?,?)');
  addA.run(c1, 'Requirements Analysis Report', 'Identify functional and non-functional requirements for a library management system. Submit a 2-3 page report.', localInput(5), 20);
  addA.run(c1, 'UML Diagrams for Library System', 'Draw a use case diagram and a class diagram for the library system.', localInput(12), 25);
  addA.run(c2, 'ER Model for a Hospital', 'Design an ER diagram with entities, attributes, keys and relationships for a hospital.', localInput(3), 30);
  const past = addA.run(c1, 'Agile Process Selection Memo', 'Recommend Scrum or Kanban for a small team project and justify your choice.', localInput(-2), 20).lastInsertRowid;

  const sub = db.prepare('INSERT INTO submissions (assignment_id,student_id,answer_text,is_late) VALUES (?,?,?,0)')
    .run(past, s2, 'Scrum is the better fit because the team needs fixed-length sprints and regular reviews.').lastInsertRowid;
  db.prepare('INSERT INTO grades (submission_id,marks,feedback,graded_by) VALUES (?,?,?,?)')
    .run(sub, 17, 'Clear justification. Add a comparison table next time.', t1);
  db.prepare('INSERT INTO announcements (course_id,title,body,created_by) VALUES (?,?,?,?)')
    .run(c1, 'Welcome to the Software Engineering Lab', 'Submit all assignments through this system before the deadline. Ask questions in the lab session.', t1);
  const note = db.prepare('INSERT INTO notifications (user_id,message,link) VALUES (?,?,?)');
  [s1, s2, s3].forEach((sid) => note.run(sid, 'New assignment: Requirements Analysis Report', '#/assignments/1'));
  db.prepare('INSERT INTO activity_log (user_id,user_name,action,details) VALUES (NULL,?,?,?)').run('System', 'Created demo data', '3 students, 2 teachers, 2 courses');
  return true;
}

module.exports = { openDb, seed };
