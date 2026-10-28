// End-to-end API tests: they start the real server on a temporary database.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb, seed } = require('../server/db');
const { createApp } = require('../server/app');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sas-'));
const dbFile = path.join(tmp, 'test.db');
let db; let server; let base;
const tokens = {};
const future = (days = 3) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 16);

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  let data = null;
  try { data = await r.clone().json(); } catch { /* file or empty */ }
  return { status: r.status, data, res: r };
}
async function login(email, password) {
  const r = await call('POST', '/api/login', { body: { email, password } });
  return r.data && r.data.token;
}
function start() {
  db = openDb(dbFile); seed(db);
  server = createApp(db, { uploadDir: path.join(tmp, 'uploads') }).listen(0);
  base = `http://localhost:${server.address().port}`;
}
function stop() { server.close(); db.close(); }

test.before(async () => {
  start();
  tokens.teacher = await login('teacher@college.edu', 'teacher123');
  tokens.teacher2 = await login('teacher2@college.edu', 'teacher123');
  tokens.student = await login('student@college.edu', 'student123');
  tokens.admin = await login('admin@college.edu', 'admin123');
});
test.after(() => { try { stop(); } catch { /* already closed */ } });

const state = {};

test('login: wrong password rejected, correct role returned', async () => {
  const bad = await call('POST', '/api/login', { body: { email: 'student@college.edu', password: 'nope' } });
  assert.strictEqual(bad.status, 401);
  const ok = await call('GET', '/api/me', { token: tokens.student });
  assert.strictEqual(ok.data.role, 'student');
});

test('no token: protected route returns 401', async () => {
  assert.strictEqual((await call('GET', '/api/assignments')).status, 401);
});

test('teacher: validation errors on create (required, deadline, marks)', async () => {
  const empty = await call('POST', '/api/assignments', { token: tokens.teacher, body: {} });
  assert.strictEqual(empty.status, 400);
  assert.ok(empty.data.errors.title && empty.data.errors.max_marks);
  const course = (await call('GET', '/api/courses', { token: tokens.teacher })).data[0];
  const past = await call('POST', '/api/assignments', { token: tokens.teacher, body: { title: 'x', description: 'x', course_id: course.id, deadline: '2020-01-01T10:00', max_marks: 10 } });
  assert.ok(past.data.errors.deadline);
  const marks = await call('POST', '/api/assignments', { token: tokens.teacher, body: { title: 'x', description: 'x', course_id: course.id, deadline: future(), max_marks: -3 } });
  assert.ok(marks.data.errors.max_marks);
});

test('teacher: create, edit assignment', async () => {
  const course = (await call('GET', '/api/courses', { token: tokens.teacher })).data.find((c) => c.code === 'CSE3132');
  const created = await call('POST', '/api/assignments', { token: tokens.teacher, body: { title: 'Software Engineering Assignment 1', description: 'Write an SRS.', course_id: course.id, deadline: future(), max_marks: 50 } });
  assert.strictEqual(created.status, 201);
  state.id = created.data.id; state.courseId = course.id;
  const edit = await call('PUT', `/api/assignments/${state.id}`, { token: tokens.teacher, body: { title: 'Software Engineering Assignment 1 (v2)', description: 'Write an SRS.', course_id: course.id, deadline: future(), max_marks: 50 } });
  assert.strictEqual(edit.status, 200);
  const got = await call('GET', `/api/assignments/${state.id}`, { token: tokens.teacher });
  assert.strictEqual(got.data.title, 'Software Engineering Assignment 1 (v2)');
});

test('permissions: student cannot create/edit/delete assignments or grade', async () => {
  const body = { title: 'x', description: 'x', course_id: state.courseId, deadline: future(), max_marks: 10 };
  assert.strictEqual((await call('POST', '/api/assignments', { token: tokens.student, body })).status, 403);
  assert.strictEqual((await call('PUT', `/api/assignments/${state.id}`, { token: tokens.student, body })).status, 403);
  assert.strictEqual((await call('DELETE', `/api/assignments/${state.id}`, { token: tokens.student })).status, 403);
  assert.strictEqual((await call('PUT', '/api/submissions/1/grade', { token: tokens.student, body: { marks: 20, feedback: 'self-grade' } })).status, 403);
});

test('permissions: teacher cannot use admin functions or touch another teacher\'s subject', async () => {
  assert.strictEqual((await call('GET', '/api/stats', { token: tokens.teacher })).status, 403);
  assert.strictEqual((await call('GET', '/api/users', { token: tokens.teacher })).status, 403);
  assert.strictEqual((await call('POST', '/api/courses', { token: tokens.teacher, body: { code: 'X1', name: 'X', teacher_id: 2 } })).status, 403);
  assert.strictEqual((await call('DELETE', `/api/assignments/${state.id}`, { token: tokens.teacher2 })).status, 403);
  assert.strictEqual((await call('GET', `/api/assignments/${state.id}/submissions`, { token: tokens.teacher2 })).status, 403);
});

test('student sees the new assignment as Pending', async () => {
  const list = (await call('GET', '/api/assignments', { token: tokens.student })).data;
  const a = list.find((x) => x.id === state.id);
  assert.ok(a); assert.strictEqual(a.status, 'Pending');
});

test('submission: empty rejected, bad file type rejected, valid file accepted', async () => {
  const empty = await call('POST', `/api/assignments/${state.id}/submit`, { token: tokens.student, form: new FormData() });
  assert.strictEqual(empty.status, 400);
  const exe = new FormData(); exe.append('file', new Blob(['x']), 'virus.exe');
  assert.strictEqual((await call('POST', `/api/assignments/${state.id}/submit`, { token: tokens.student, form: exe })).status, 400);
  const ok = new FormData(); ok.append('file', new Blob(['My SRS document']), 'srs.txt'); ok.append('answer_text', 'See attached.');
  const r = await call('POST', `/api/assignments/${state.id}/submit`, { token: tokens.student, form: ok });
  assert.strictEqual(r.status, 201);
});

test('teacher sees submission and can download the file; other teacher cannot', async () => {
  const { rows } = (await call('GET', `/api/assignments/${state.id}/submissions`, { token: tokens.teacher })).data;
  const mine = rows.find((r) => r.email === 'student@college.edu');
  assert.ok(mine.submission_id); assert.strictEqual(mine.file_name, 'srs.txt');
  state.subId = mine.submission_id;
  const file = await call('GET', `/api/submissions/${state.subId}/file`, { token: tokens.teacher });
  assert.strictEqual(file.status, 200);
  assert.strictEqual(await file.res.text(), 'My SRS document');
  assert.strictEqual((await call('GET', `/api/submissions/${state.subId}/file`, { token: tokens.teacher2 })).status, 403);
});

test('grading: invalid marks/feedback rejected, valid grade saved', async () => {
  const over = await call('PUT', `/api/submissions/${state.subId}/grade`, { token: tokens.teacher, body: { marks: 51, feedback: 'x' } });
  assert.ok(over.data.errors.marks);
  const nofb = await call('PUT', `/api/submissions/${state.subId}/grade`, { token: tokens.teacher, body: { marks: 40, feedback: '' } });
  assert.ok(nofb.data.errors.feedback);
  assert.strictEqual((await call('PUT', `/api/submissions/${state.subId}/grade`, { token: tokens.teacher2, body: { marks: 40, feedback: 'x' } })).status, 403);
  const ok = await call('PUT', `/api/submissions/${state.subId}/grade`, { token: tokens.teacher, body: { marks: 42, feedback: 'Good SRS, add more use cases.' } });
  assert.strictEqual(ok.status, 200);
});

test('student sees grade and feedback; resubmitting a graded item is blocked', async () => {
  const a = (await call('GET', '/api/assignments', { token: tokens.student })).data.find((x) => x.id === state.id);
  assert.strictEqual(a.status, 'Graded');
  assert.strictEqual(a.my_submission.marks, 42);
  assert.strictEqual(a.my_submission.feedback, 'Good SRS, add more use cases.');
  const f = new FormData(); f.append('answer_text', 'changed');
  assert.strictEqual((await call('POST', `/api/assignments/${state.id}/submit`, { token: tokens.student, form: f })).status, 409);
});

test('persistence: data survives closing and reopening the database', async () => {
  stop(); start();
  tokens.student = await login('student@college.edu', 'student123');
  const a = (await call('GET', '/api/assignments', { token: tokens.student })).data.find((x) => x.id === state.id);
  assert.strictEqual(a.my_submission.marks, 42);
});

test('admin: stats, users, course creation, duplicate protection', async () => {
  const stats = (await call('GET', '/api/stats', { token: tokens.admin })).data;
  assert.ok(stats.students >= 3 && stats.teachers >= 2 && stats.submissions >= 2);
  const users = (await call('GET', '/api/users', { token: tokens.admin })).data;
  assert.ok(users.every((u) => !('password_hash' in u)));
  const t = users.find((u) => u.role === 'teacher');
  const mk = await call('POST', '/api/courses', { token: tokens.admin, body: { code: 'cse9999', name: 'Test Course', teacher_id: t.id } });
  assert.strictEqual(mk.status, 201);
  assert.strictEqual((await call('POST', '/api/courses', { token: tokens.admin, body: { code: 'CSE9999', name: 'Dup', teacher_id: t.id } })).status, 400);
  assert.strictEqual((await call('POST', '/api/users', { token: tokens.admin, body: { name: 'N', email: 'student@college.edu', password: '123456', role: 'student' } })).status, 400);
});

test('admin cannot grade; teacher delete assignment removes it', async () => {
  assert.strictEqual((await call('PUT', `/api/submissions/${state.subId}/grade`, { token: tokens.admin, body: { marks: 1, feedback: 'x' } })).status, 403);
  assert.strictEqual((await call('DELETE', `/api/assignments/${state.id}`, { token: tokens.teacher })).status, 200);
  assert.strictEqual((await call('GET', `/api/assignments/${state.id}`, { token: tokens.teacher })).status, 404);
});

test('register: creates a STUDENT only (role in request is ignored), auto-enrolled, duplicate email rejected', async () => {
  const bad = await call('POST', '/api/register', { body: { name: '', email: 'x', password: '1' } });
  assert.strictEqual(bad.status, 400); assert.ok(bad.data.errors.name && bad.data.errors.email && bad.data.errors.password);
  const ok = await call('POST', '/api/register', { body: { name: 'New Kid', email: 'Newkid@College.edu', password: 'secret1', role: 'admin' } });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.data.user.role, 'student');
  assert.strictEqual((await call('GET', '/api/stats', { token: ok.data.token })).status, 403);
  assert.ok((await call('GET', '/api/courses', { token: ok.data.token })).data.length >= 2);
  assert.ok(await login('newkid@college.edu', 'secret1'));
  assert.strictEqual((await call('POST', '/api/register', { body: { name: 'Dup', email: 'newkid@college.edu', password: 'secret1' } })).status, 400);
});

test('announcements: teacher posts, enrolled student sees, validation + permissions', async () => {
  const course = (await call('GET', '/api/courses', { token: tokens.teacher })).data.find((c) => c.code === 'CSE3132');
  assert.ok((await call('POST', '/api/announcements', { token: tokens.teacher, body: {} })).data.errors.title);
  assert.strictEqual((await call('POST', '/api/announcements', { token: tokens.student, body: { course_id: course.id, title: 'x', body: 'y' } })).status, 403);
  assert.strictEqual((await call('POST', '/api/announcements', { token: tokens.teacher2, body: { course_id: course.id, title: 'x', body: 'y' } })).status, 400);
  const ok = await call('POST', '/api/announcements', { token: tokens.teacher, body: { course_id: course.id, title: 'Quiz on Friday', body: 'Revise UML.' } });
  assert.strictEqual(ok.status, 201);
  const seen = (await call('GET', '/api/announcements', { token: tokens.student })).data;
  assert.ok(seen.some((a) => a.title === 'Quiz on Friday'));
  const other = (await call('GET', '/api/announcements', { token: tokens.teacher2 })).data;
  assert.ok(!other.some((a) => a.title === 'Quiz on Friday'));
  assert.strictEqual((await call('DELETE', `/api/announcements/${ok.data.id}`, { token: tokens.teacher2 })).status, 403);
  assert.strictEqual((await call('DELETE', `/api/announcements/${ok.data.id}`, { token: tokens.teacher })).status, 200);
});

test('notifications: created on events, private to each user, read-all works', async () => {
  const n = (await call('GET', '/api/notifications', { token: tokens.student })).data;
  assert.ok(n.unread > 0);
  assert.ok(n.items.some((i) => /graded/.test(i.message)), 'student was told about the grade');
  assert.ok(n.items.some((i) => /New assignment/.test(i.message)));
  const t = (await call('GET', '/api/notifications', { token: tokens.teacher })).data;
  assert.ok(t.items.some((i) => /submitted/.test(i.message)), 'teacher was told about the submission');
  assert.ok(!t.items.some((i) => /graded/.test(i.message)));
  await call('POST', '/api/notifications/read-all', { token: tokens.student });
  assert.strictEqual((await call('GET', '/api/notifications', { token: tokens.student })).data.unread, 0);
});

test('activity log: admin only, records actions', async () => {
  assert.strictEqual((await call('GET', '/api/activity', { token: tokens.student })).status, 403);
  assert.strictEqual((await call('GET', '/api/activity', { token: tokens.teacher })).status, 403);
  const log = (await call('GET', '/api/activity', { token: tokens.admin })).data;
  assert.ok(log.some((l) => l.action === 'Created assignment'));
  assert.ok(log.some((l) => l.action === 'Graded submission'));
  assert.ok(log.some((l) => l.action === 'Signed in'));
});

test('change password: wrong current rejected, success lets user log in with new one', async () => {
  const reg = await call('POST', '/api/register', { body: { name: 'Pass Tester', email: 'pt@college.edu', password: 'oldpass1' } });
  const token = reg.data.token;
  assert.ok((await call('PUT', '/api/me/password', { token, body: { current_password: 'wrong', new_password: 'newpass1' } })).data.errors.current_password);
  assert.ok((await call('PUT', '/api/me/password', { token, body: { current_password: 'oldpass1', new_password: '12' } })).data.errors.new_password);
  assert.strictEqual((await call('PUT', '/api/me/password', { token, body: { current_password: 'oldpass1', new_password: 'newpass1' } })).status, 200);
  assert.strictEqual(await login('pt@college.edu', 'oldpass1'), undefined);
  assert.ok(await login('pt@college.edu', 'newpass1'));
});

test('CSV export: teacher gets file, student and other teacher are refused', async () => {
  const a = (await call('GET', '/api/assignments', { token: tokens.teacher })).data.find((x) => x.title === 'Agile Process Selection Memo');
  const r = await call('GET', `/api/assignments/${a.id}/export`, { token: tokens.teacher });
  assert.strictEqual(r.status, 200);
  const text = await r.res.text();
  assert.ok(text.startsWith('Student,Email,Status'));
  assert.ok(text.includes('Priya Nair') && text.includes('17'));
  assert.strictEqual((await call('GET', `/api/assignments/${a.id}/export`, { token: tokens.student })).status, 403);
  assert.strictEqual((await call('GET', `/api/assignments/${a.id}/export`, { token: tokens.teacher2 })).status, 403);
});

test('forgot password: same answer for known and unknown emails, admin issues temporary password, user must change it', async () => {
  const reg = await call('POST', '/api/register', { body: { name: 'Forgetful', email: 'forget@college.edu', password: 'oldpass1' } });
  const userId = reg.data.user.id;
  assert.ok((await call('POST', '/api/forgot-password', { body: { email: 'not-an-email' } })).data.errors.email);
  const unknown = await call('POST', '/api/forgot-password', { body: { email: 'nobody@college.edu' } });
  const known = await call('POST', '/api/forgot-password', { body: { email: 'forget@college.edu' } });
  assert.strictEqual(unknown.status, 200); assert.strictEqual(known.status, 200);
  assert.strictEqual(unknown.data.message, known.data.message, 'must not reveal whether the email exists');
  await call('POST', '/api/forgot-password', { body: { email: 'forget@college.edu' } }); // duplicate request

  assert.strictEqual((await call('GET', '/api/password-resets', { token: tokens.student })).status, 403);
  assert.strictEqual((await call('GET', '/api/password-resets', { token: tokens.teacher })).status, 403);
  assert.strictEqual((await call('POST', `/api/users/${userId}/reset-password`, { token: tokens.teacher })).status, 403);
  const pending = (await call('GET', '/api/password-resets', { token: tokens.admin })).data.filter((r) => r.email === 'forget@college.edu');
  assert.strictEqual(pending.length, 1, 'duplicate requests are not queued twice');

  const adminId = (await call('GET', '/api/me', { token: tokens.admin })).data.id;
  assert.strictEqual((await call('POST', `/api/users/${adminId}/reset-password`, { token: tokens.admin })).status, 400);
  assert.strictEqual((await call('POST', '/api/users/99999/reset-password', { token: tokens.admin })).status, 404);

  const reset = await call('POST', `/api/users/${userId}/reset-password`, { token: tokens.admin });
  assert.strictEqual(reset.status, 200);
  const temp = reset.data.temp_password;
  assert.strictEqual(await login('forget@college.edu', 'oldpass1'), undefined, 'old password stops working');
  assert.ok(!(await call('GET', '/api/password-resets', { token: tokens.admin })).data.some((r) => r.email === 'forget@college.edu'), 'request marked done');

  const t = await login('forget@college.edu', temp);
  assert.ok(t, 'temporary password works');
  const blocked = await call('GET', '/api/assignments', { token: t });
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.data.code, 'MUST_CHANGE_PASSWORD');
  assert.strictEqual((await call('GET', '/api/me', { token: t })).data.must_change_password, 1);
  assert.strictEqual((await call('PUT', '/api/me/password', { token: t, body: { current_password: temp, new_password: 'brandnew1' } })).status, 200);
  assert.strictEqual((await call('GET', '/api/assignments', { token: t })).status, 200, 'normal access after changing password');
  assert.ok(await login('forget@college.edu', 'brandnew1'));
});
