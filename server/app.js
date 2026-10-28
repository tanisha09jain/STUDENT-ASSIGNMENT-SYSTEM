// Express API. Every route checks the logged-in user's role on the SERVER.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const L = require('./logic');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.txt', '.zip', '.png', '.jpg', '.jpeg', '.ppt', '.pptx', '.py', '.java', '.c', '.cpp', '.js'];

function createApp(db, { uploadDir }) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const app = express();
  app.use(express.json());

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : new Error('FILE_TYPE'), ok);
    },
  });

  // ---------- helpers ----------
  const bad = (res, errors, msg = 'Please fix the highlighted fields.') => res.status(400).json({ error: msg, errors });
  const removeFile = (p) => { if (p) fs.unlink(p, () => {}); };

  function auth(req, res, next) {
    const header = req.headers.authorization || '';
    try {
      const payload = jwt.verify(header.startsWith('Bearer ') ? header.slice(7) : '', SECRET);
      const user = db.prepare('SELECT id,name,email,role,must_change_password FROM users WHERE id=?').get(payload.id);
      if (!user) return res.status(401).json({ error: 'Please sign in again.' });
      // A user with a temporary password may only change the password until they have done so.
      if (user.must_change_password && !['/api/me', '/api/me/password'].includes(req.path)) {
        return res.status(403).json({ error: 'Please change your temporary password first.', code: 'MUST_CHANGE_PASSWORD' });
      }
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ error: 'Please sign in.' });
    }
  }
  const requireRole = (...roles) => (req, res, next) =>
    (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission to do this.' }));

  // Helpers used by many routes: write to the activity log and create notifications.
  function logActivity(user, action, details = '') {
    db.prepare('INSERT INTO activity_log (user_id,user_name,action,details) VALUES (?,?,?,?)')
      .run(user ? user.id : null, user ? user.name : 'System', action, details);
  }
  function notify(userId, message, link = '') {
    db.prepare('INSERT INTO notifications (user_id,message,link) VALUES (?,?,?)').run(userId, message, link);
  }
  function notifyCourse(courseId, message, link = '') {
    db.prepare('INSERT INTO notifications (user_id,message,link) SELECT student_id, ?, ? FROM enrollments WHERE course_id=?').run(message, link, courseId);
  }

  function listAssignmentsFor(user) {
    let where = '';
    const params = [];
    if (user.role === 'teacher') { where = 'WHERE c.teacher_id=?'; params.push(user.id); }
    if (user.role === 'student') { where = 'WHERE a.course_id IN (SELECT course_id FROM enrollments WHERE student_id=?)'; params.push(user.id); }
    const rows = db.prepare(`
      SELECT a.*, c.code course_code, c.name course_name, c.teacher_id, t.name teacher_name,
        (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id=a.id) submission_count,
        (SELECT COUNT(*) FROM submissions s JOIN grades g ON g.submission_id=s.id WHERE s.assignment_id=a.id) graded_count
      FROM assignments a JOIN courses c ON c.id=a.course_id JOIN users t ON t.id=c.teacher_id
      ${where} ORDER BY a.deadline`).all(...params);
    if (user.role === 'student') {
      const q = db.prepare(`SELECT s.id submission_id, s.file_name, s.answer_text, s.submitted_at, s.is_late, g.marks, g.feedback, g.graded_at
        FROM submissions s LEFT JOIN grades g ON g.submission_id=s.id WHERE s.assignment_id=? AND s.student_id=?`);
      rows.forEach((r) => { r.my_submission = q.get(r.id, user.id) || null; r.status = L.assignmentStatus(r, r.my_submission); });
    }
    return rows;
  }

  // Returns the assignment if the user may see it; otherwise sends 404/403 and returns null.
  function loadAssignment(req, res) {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM assignments WHERE id=?').get(id)) { res.status(404).json({ error: 'Assignment not found.' }); return null; }
    const a = listAssignmentsFor(req.user).find((x) => x.id === id);
    if (!a) { res.status(403).json({ error: 'You do not have access to this assignment.' }); return null; }
    return a;
  }

  // ---------- auth ----------
  app.post('/api/login', (req, res) => {
    const { email = '', password = '' } = req.body || {};
    const row = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).trim().toLowerCase());
    if (!row || !bcrypt.compareSync(String(password), row.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const token = jwt.sign({ id: row.id }, SECRET, { expiresIn: '8h' });
    logActivity(row, 'Signed in', row.role);
    return res.json({ token, user: { id: row.id, name: row.name, email: row.email, role: row.role, must_change_password: row.must_change_password } });
  });

  // Forgot password: no email service, so the request is queued for an admin to handle.
  // The answer is always the same, so nobody can use this to discover which emails are registered.
  app.post('/api/forgot-password', (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!L.isValidEmail(email)) return bad(res, { email: 'Enter a valid email address.' });
    const u = db.prepare('SELECT id,name FROM users WHERE email=?').get(email);
    if (u && !db.prepare("SELECT 1 FROM password_resets WHERE user_id=? AND status='pending'").get(u.id)) {
      db.prepare('INSERT INTO password_resets (user_id) VALUES (?)').run(u.id);
      logActivity(u, 'Requested password reset');
    }
    return res.json({ ok: true, message: 'If this email is registered, an administrator has been notified and will give you a temporary password.' });
  });
  // Public sign-up. The role is ALWAYS 'student' (never taken from the request).
  app.post('/api/register', (req, res) => {
    const d = req.body || {};
    const errors = L.validateUser({ ...d, role: 'student' });
    if (Object.keys(errors).length) return bad(res, errors);
    try {
      const id = db.transaction(() => {
        const info = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
          .run(d.name.trim(), d.email.trim().toLowerCase(), bcrypt.hashSync(d.password, 8), 'student');
        // Demo convenience: enrol the new student in every existing course.
        db.prepare('INSERT INTO enrollments (student_id,course_id) SELECT ?, id FROM courses').run(info.lastInsertRowid);
        return Number(info.lastInsertRowid);
      })();
      const token = jwt.sign({ id }, SECRET, { expiresIn: '8h' });
      logActivity({ id, name: d.name.trim() }, 'Registered', 'student');
      return res.status(201).json({ token, user: { id, name: d.name.trim(), email: d.email.trim().toLowerCase(), role: 'student' } });
    } catch {
      return bad(res, { email: 'This email is already registered.' });
    }
  });
  app.get('/api/me', auth, (req, res) => res.json(req.user));

  // ---------- admin: stats and users ----------
  app.get('/api/stats', auth, requireRole('admin'), (req, res) => {
    const n = (sql) => db.prepare(sql).get().c;
    res.json({
      students: n("SELECT COUNT(*) c FROM users WHERE role='student'"),
      teachers: n("SELECT COUNT(*) c FROM users WHERE role='teacher'"),
      courses: n('SELECT COUNT(*) c FROM courses'),
      assignments: n('SELECT COUNT(*) c FROM assignments'),
      submissions: n('SELECT COUNT(*) c FROM submissions'),
      graded: n('SELECT COUNT(*) c FROM grades'),
      announcements: n('SELECT COUNT(*) c FROM announcements'),
    });
  });
  app.get('/api/users', auth, requireRole('admin'), (req, res) =>
    res.json(db.prepare('SELECT id,name,email,role FROM users ORDER BY role,name').all()));
  app.post('/api/users', auth, requireRole('admin'), (req, res) => {
    const errors = L.validateUser(req.body || {});
    if (Object.keys(errors).length) return bad(res, errors);
    const { name, email, password, role } = req.body;
    try {
      const info = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
        .run(name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 8), role);
      logActivity(req.user, 'Added user', `${email.trim().toLowerCase()} (${role})`);
      return res.status(201).json({ id: info.lastInsertRowid });
    } catch {
      return bad(res, { email: 'This email is already registered.' });
    }
  });
  // Admin issues a temporary password (the user must change it at next sign-in).
  app.get('/api/password-resets', auth, requireRole('admin'), (req, res) =>
    res.json(db.prepare(`SELECT pr.id, pr.requested_at, u.id user_id, u.name, u.email, u.role FROM password_resets pr
      JOIN users u ON u.id=pr.user_id WHERE pr.status='pending' ORDER BY pr.id`).all()));
  app.post('/api/users/:id/reset-password', auth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'Use your Profile page to change your own password.' });
    const target = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    const temp = L.generateTempPassword();
    db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').run(bcrypt.hashSync(temp, 8), id);
    db.prepare("UPDATE password_resets SET status='done', resolved_at=datetime('now'), resolved_by=? WHERE user_id=? AND status='pending'").run(req.user.id, id);
    logActivity(req.user, 'Reset password', target.email);
    return res.json({ temp_password: temp, name: target.name, email: target.email });
  });
  app.delete('/api/users/:id', auth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    try {
      const files = db.prepare('SELECT file_path FROM submissions WHERE student_id=?').all(id);
      const info = db.prepare('DELETE FROM users WHERE id=?').run(id);
      if (!info.changes) return res.status(404).json({ error: 'User not found.' });
      files.forEach((f) => removeFile(f.file_path));
      logActivity(req.user, 'Deleted user', `id ${id}`);
      return res.json({ ok: true });
    } catch {
      return res.status(409).json({ error: 'This teacher still has courses. Reassign or delete those courses first.' });
    }
  });

  // ---------- courses ----------
  app.get('/api/courses', auth, (req, res) => {
    let where = '';
    const params = [];
    if (req.user.role === 'teacher') { where = 'WHERE c.teacher_id=?'; params.push(req.user.id); }
    if (req.user.role === 'student') { where = 'WHERE c.id IN (SELECT course_id FROM enrollments WHERE student_id=?)'; params.push(req.user.id); }
    res.json(db.prepare(`SELECT c.*, t.name teacher_name,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) student_count,
      (SELECT COUNT(*) FROM assignments a WHERE a.course_id=c.id) assignment_count
      FROM courses c JOIN users t ON t.id=c.teacher_id ${where} ORDER BY c.code`).all(...params));
  });
  app.post('/api/courses', auth, requireRole('admin'), (req, res) => {
    const errors = L.validateCourse(req.body || {});
    const teacher = db.prepare("SELECT id FROM users WHERE id=? AND role='teacher'").get(Number(req.body && req.body.teacher_id));
    if (!errors.teacher_id && !teacher) errors.teacher_id = 'Choose a valid teacher.';
    if (Object.keys(errors).length) return bad(res, errors);
    try {
      const info = db.prepare('INSERT INTO courses (code,name,teacher_id) VALUES (?,?,?)')
        .run(req.body.code.trim().toUpperCase(), req.body.name.trim(), teacher.id);
      logActivity(req.user, 'Added course', req.body.code.trim().toUpperCase());
      return res.status(201).json({ id: info.lastInsertRowid });
    } catch {
      return bad(res, { code: 'This course code already exists.' });
    }
  });
  app.delete('/api/courses/:id', auth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const files = db.prepare('SELECT s.file_path FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.course_id=?').all(id);
    const info = db.prepare('DELETE FROM courses WHERE id=?').run(id);
    if (!info.changes) return res.status(404).json({ error: 'Course not found.' });
    files.forEach((f) => removeFile(f.file_path));
    logActivity(req.user, 'Deleted course', `id ${id}`);
    return res.json({ ok: true });
  });
  app.get('/api/courses/:id/students', auth, requireRole('admin'), (req, res) =>
    res.json(db.prepare(`SELECT u.id,u.name,u.email,
      EXISTS(SELECT 1 FROM enrollments e WHERE e.student_id=u.id AND e.course_id=?) enrolled
      FROM users u WHERE u.role='student' ORDER BY u.name`).all(Number(req.params.id))));
  app.put('/api/courses/:id/students', auth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM courses WHERE id=?').get(id)) return res.status(404).json({ error: 'Course not found.' });
    const ids = Array.isArray(req.body.student_ids) ? req.body.student_ids.map(Number) : [];
    db.transaction(() => {
      db.prepare('DELETE FROM enrollments WHERE course_id=?').run(id);
      const add = db.prepare("INSERT INTO enrollments (student_id,course_id) SELECT id,? FROM users WHERE id=? AND role='student'");
      ids.forEach((sid) => add.run(id, sid));
    })();
    res.json({ ok: true });
  });

  // ---------- assignments ----------
  app.get('/api/assignments', auth, (req, res) => res.json(listAssignmentsFor(req.user)));

  app.get('/api/assignments/:id', auth, (req, res) => {
    const a = loadAssignment(req, res);
    if (a) res.json(a);
  });

  function ownCourse(user, courseId) {
    return db.prepare('SELECT id FROM courses WHERE id=? AND teacher_id=?').get(Number(courseId), user.id);
  }

  app.post('/api/assignments', auth, requireRole('teacher'), (req, res) => {
    const errors = L.validateAssignment(req.body || {});
    if (!errors.course_id && !ownCourse(req.user, req.body.course_id)) errors.course_id = 'You can only add assignments to your own subjects.';
    if (Object.keys(errors).length) return bad(res, errors);
    const d = req.body;
    const info = db.prepare('INSERT INTO assignments (course_id,title,description,deadline,max_marks) VALUES (?,?,?,?,?)')
      .run(Number(d.course_id), d.title.trim(), d.description.trim(), d.deadline, Number(d.max_marks));
    notifyCourse(Number(d.course_id), `New assignment: ${d.title.trim()}`, `#/assignments/${info.lastInsertRowid}`);
    logActivity(req.user, 'Created assignment', d.title.trim());
    return res.status(201).json({ id: info.lastInsertRowid });
  });

  app.put('/api/assignments/:id', auth, requireRole('teacher'), (req, res) => {
    const a = loadAssignment(req, res);
    if (!a) return null;
    const d = req.body || {};
    const errors = L.validateAssignment(d, { requireFutureDeadline: d.deadline !== a.deadline });
    if (!errors.course_id && !ownCourse(req.user, d.course_id)) errors.course_id = 'You can only use your own subjects.';
    if (Object.keys(errors).length) return bad(res, errors);
    db.prepare('UPDATE assignments SET course_id=?,title=?,description=?,deadline=?,max_marks=? WHERE id=?')
      .run(Number(d.course_id), d.title.trim(), d.description.trim(), d.deadline, Number(d.max_marks), a.id);
    logActivity(req.user, 'Edited assignment', d.title.trim());
    return res.json({ ok: true });
  });

  app.delete('/api/assignments/:id', auth, requireRole('teacher'), (req, res) => {
    const a = loadAssignment(req, res);
    if (!a) return null;
    const files = db.prepare('SELECT file_path FROM submissions WHERE assignment_id=?').all(a.id);
    db.prepare('DELETE FROM assignments WHERE id=?').run(a.id);
    files.forEach((f) => removeFile(f.file_path));
    logActivity(req.user, 'Deleted assignment', a.title);
    return res.json({ ok: true });
  });

  // ---------- submissions ----------
  app.post('/api/assignments/:id/submit', auth, requireRole('student'), upload.single('file'), (req, res) => {
    const a = loadAssignment(req, res);
    if (!a) return removeFile(req.file && req.file.path);
    const text = (req.body.answer_text || '').trim();
    if (!req.file && !text) {
      removeFile(req.file && req.file.path);
      return bad(res, { answer_text: 'Attach a file or write an answer.' });
    }
    const existing = db.prepare('SELECT s.*, g.id graded FROM submissions s LEFT JOIN grades g ON g.submission_id=s.id WHERE s.assignment_id=? AND s.student_id=?').get(a.id, req.user.id);
    if (existing && existing.graded) {
      removeFile(req.file && req.file.path);
      return res.status(409).json({ error: 'This submission has already been graded and can no longer be changed.' });
    }
    const late = L.isLate(a.deadline) ? 1 : 0;
    if (existing) {
      if (req.file) removeFile(existing.file_path);
      db.prepare("UPDATE submissions SET file_name=?,file_path=?,answer_text=?,is_late=?,submitted_at=datetime('now') WHERE id=?")
        .run(req.file ? req.file.originalname : existing.file_name, req.file ? req.file.path : existing.file_path, text, late, existing.id);
    } else {
      db.prepare('INSERT INTO submissions (assignment_id,student_id,file_name,file_path,answer_text,is_late) VALUES (?,?,?,?,?,?)')
        .run(a.id, req.user.id, req.file ? req.file.originalname : null, req.file ? req.file.path : null, text, late);
    }
    notify(a.teacher_id, `${req.user.name} submitted "${a.title}"${late ? ' (late)' : ''}`, `#/assignments/${a.id}/submissions`);
    logActivity(req.user, late ? 'Submitted late' : 'Submitted work', a.title);
    return res.status(201).json({ ok: true, late: !!late });
  });

  function submissionRowsFor(a) {
    return db.prepare(`SELECT u.id student_id, u.name student_name, u.email,
        s.id submission_id, s.file_name, s.answer_text, s.submitted_at, s.is_late, g.marks, g.feedback, g.graded_at
      FROM enrollments e JOIN users u ON u.id=e.student_id
      LEFT JOIN submissions s ON s.student_id=u.id AND s.assignment_id=?
      LEFT JOIN grades g ON g.submission_id=s.id
      WHERE e.course_id=? ORDER BY u.name`).all(a.id, a.course_id);
  }

  app.get('/api/assignments/:id/submissions', auth, requireRole('teacher'), (req, res) => {
    const a = loadAssignment(req, res);
    if (!a) return null;
    return res.json({ assignment: a, rows: submissionRowsFor(a) });
  });

  // Download all marks for one assignment as a CSV file (opens in Excel).
  app.get('/api/assignments/:id/export', auth, requireRole('teacher'), (req, res) => {
    const a = loadAssignment(req, res);
    if (!a) return null;
    const rows = submissionRowsFor(a).map((r) => [
      r.student_name, r.email, r.marks != null ? 'Graded' : r.submission_id ? (r.is_late ? 'Submitted late' : 'Submitted') : 'Not submitted',
      r.submitted_at || '', r.file_name || '', r.marks ?? '', a.max_marks, r.feedback || '']);
    logActivity(req.user, 'Exported grades', a.title);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(L.toCsv(['Student', 'Email', 'Status', 'Submitted at (UTC)', 'File', 'Marks', 'Max marks', 'Feedback'], rows));
  });

  app.get('/api/submissions/:id/file', auth, (req, res) => {
    const s = db.prepare(`SELECT s.*, c.teacher_id FROM submissions s JOIN assignments a ON a.id=s.assignment_id
      JOIN courses c ON c.id=a.course_id WHERE s.id=?`).get(Number(req.params.id));
    if (!s || !s.file_path) return res.status(404).json({ error: 'File not found.' });
    const allowed = (req.user.role === 'student' && s.student_id === req.user.id) || (req.user.role === 'teacher' && s.teacher_id === req.user.id);
    if (!allowed) return res.status(403).json({ error: 'You do not have access to this file.' });
    return res.download(s.file_path, s.file_name);
  });

  app.put('/api/submissions/:id/grade', auth, requireRole('teacher'), (req, res) => {
    const s = db.prepare(`SELECT s.id, s.student_id, a.title, a.max_marks, c.teacher_id FROM submissions s JOIN assignments a ON a.id=s.assignment_id
      JOIN courses c ON c.id=a.course_id WHERE s.id=?`).get(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'Submission not found.' });
    if (s.teacher_id !== req.user.id) return res.status(403).json({ error: 'You can only grade submissions for your own subjects.' });
    const errors = L.validateGrade(req.body || {}, s.max_marks);
    if (Object.keys(errors).length) return bad(res, errors);
    db.prepare(`INSERT INTO grades (submission_id,marks,feedback,graded_by) VALUES (?,?,?,?)
      ON CONFLICT(submission_id) DO UPDATE SET marks=excluded.marks, feedback=excluded.feedback, graded_by=excluded.graded_by, graded_at=datetime('now')`)
      .run(s.id, Number(req.body.marks), req.body.feedback.trim(), req.user.id);
    notify(s.student_id, `Your work "${s.title}" was graded: ${Number(req.body.marks)} / ${s.max_marks}`, '#/grades');
    logActivity(req.user, 'Graded submission', `${s.title}: ${Number(req.body.marks)}/${s.max_marks}`);
    return res.json({ ok: true });
  });

  // ---------- announcements ----------
  app.get('/api/announcements', auth, (req, res) => {
    let where = '';
    const params = [];
    if (req.user.role === 'teacher') { where = 'WHERE c.teacher_id=?'; params.push(req.user.id); }
    if (req.user.role === 'student') { where = 'WHERE an.course_id IN (SELECT course_id FROM enrollments WHERE student_id=?)'; params.push(req.user.id); }
    res.json(db.prepare(`SELECT an.*, c.code course_code, u.name author FROM announcements an
      JOIN courses c ON c.id=an.course_id JOIN users u ON u.id=an.created_by ${where} ORDER BY an.id DESC LIMIT 100`).all(...params));
  });
  app.post('/api/announcements', auth, requireRole('teacher'), (req, res) => {
    const d = req.body || {};
    const errors = L.validateAnnouncement(d);
    if (!errors.course_id && !ownCourse(req.user, d.course_id)) errors.course_id = 'You can only post to your own subjects.';
    if (Object.keys(errors).length) return bad(res, errors);
    const info = db.prepare('INSERT INTO announcements (course_id,title,body,created_by) VALUES (?,?,?,?)')
      .run(Number(d.course_id), d.title.trim(), d.body.trim(), req.user.id);
    notifyCourse(Number(d.course_id), `Announcement: ${d.title.trim()}`, '#/announcements');
    logActivity(req.user, 'Posted announcement', d.title.trim());
    return res.status(201).json({ id: info.lastInsertRowid });
  });
  app.delete('/api/announcements/:id', auth, requireRole('teacher'), (req, res) => {
    const row = db.prepare('SELECT an.id, an.title, c.teacher_id FROM announcements an JOIN courses c ON c.id=an.course_id WHERE an.id=?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Announcement not found.' });
    if (row.teacher_id !== req.user.id) return res.status(403).json({ error: 'You can only delete announcements for your own subjects.' });
    db.prepare('DELETE FROM announcements WHERE id=?').run(row.id);
    logActivity(req.user, 'Deleted announcement', row.title);
    return res.json({ ok: true });
  });

  // ---------- notifications (each user sees only their own) ----------
  app.get('/api/notifications', auth, (req, res) => {
    const items = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
    res.json({ unread, items });
  });
  app.post('/api/notifications/read-all', auth, (req, res) => {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
    res.json({ ok: true });
  });

  // ---------- activity log (admin only) and profile ----------
  app.get('/api/activity', auth, requireRole('admin'), (req, res) =>
    res.json(db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 100').all()));

  app.put('/api/me/password', auth, (req, res) => {
    const d = req.body || {};
    const errors = L.validatePasswordChange(d);
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
    if (!errors.current_password && !bcrypt.compareSync(String(d.current_password), row.password_hash)) errors.current_password = 'Current password is incorrect.';
    if (Object.keys(errors).length) return bad(res, errors);
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(bcrypt.hashSync(d.new_password, 8), req.user.id);
    logActivity(req.user, 'Changed password');
    return res.json({ ok: true });
  });

  // ---------- error handling and static files ----------
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.message === 'FILE_TYPE') return bad(res, { file: 'This file type is not allowed.' });
    if (err.code === 'LIMIT_FILE_SIZE') return bad(res, { file: 'File is larger than 5 MB.' });
    return res.status(500).json({ error: 'Unexpected server error.' });
  });
  return app;
}

module.exports = { createApp };
