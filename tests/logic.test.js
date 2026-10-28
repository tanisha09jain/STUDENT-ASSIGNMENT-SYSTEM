const test = require('node:test');
const assert = require('node:assert');
const L = require('../server/logic');

const future = () => new Date(Date.now() + 86400000).toISOString().slice(0, 16);
const valid = () => ({ title: 'A1', description: 'Do it', course_id: 1, deadline: future(), max_marks: 20 });

test('assignment: valid data has no errors', () => assert.deepStrictEqual(L.validateAssignment(valid()), {}));
test('assignment: required fields', () => {
  const e = L.validateAssignment({});
  ['title', 'description', 'course_id', 'deadline', 'max_marks'].forEach((f) => assert.ok(e[f], f));
});
test('assignment: past deadline rejected on create, allowed when not required', () => {
  const d = { ...valid(), deadline: '2020-01-01T10:00' };
  assert.ok(L.validateAssignment(d).deadline);
  assert.strictEqual(L.validateAssignment(d, { requireFutureDeadline: false }).deadline, undefined);
});
test('assignment: invalid date and marks', () => {
  assert.ok(L.validateAssignment({ ...valid(), deadline: 'not-a-date' }).deadline);
  [0, -5, 1.5, 1001, 'abc'].forEach((m) => assert.ok(L.validateAssignment({ ...valid(), max_marks: m }).max_marks, String(m)));
});
test('grade: range and feedback', () => {
  assert.deepStrictEqual(L.validateGrade({ marks: 15, feedback: 'ok' }, 20), {});
  assert.ok(L.validateGrade({ marks: 21, feedback: 'ok' }, 20).marks);
  assert.ok(L.validateGrade({ marks: -1, feedback: 'ok' }, 20).marks);
  assert.ok(L.validateGrade({ marks: '', feedback: 'ok' }, 20).marks);
  assert.ok(L.validateGrade({ marks: 5, feedback: '  ' }, 20).feedback);
});
test('user and course validation', () => {
  assert.ok(L.validateUser({ name: '', email: 'x', password: '1', role: 'boss' }).role);
  assert.deepStrictEqual(L.validateUser({ name: 'A', email: 'a@b.co', password: '123456', role: 'student' }), {});
  assert.ok(L.validateCourse({}).code);
});
test('assignmentStatus', () => {
  const now = new Date('2026-01-10T00:00');
  const open = { deadline: '2026-01-20T00:00' };
  const closed = { deadline: '2026-01-01T00:00' };
  assert.strictEqual(L.assignmentStatus(open, null, now), 'Pending');
  assert.strictEqual(L.assignmentStatus(closed, null, now), 'Overdue');
  assert.strictEqual(L.assignmentStatus(open, { is_late: 0, marks: null }, now), 'Submitted');
  assert.strictEqual(L.assignmentStatus(open, { is_late: 1, marks: null }, now), 'Submitted late');
  assert.strictEqual(L.assignmentStatus(open, { marks: 5 }, now), 'Graded');
});

test('announcement validation', () => {
  assert.deepStrictEqual(L.validateAnnouncement({ title: 'Hi', body: 'Text', course_id: 1 }), {});
  const e = L.validateAnnouncement({});
  assert.ok(e.title && e.body && e.course_id);
  assert.ok(L.validateAnnouncement({ title: 'x', body: 'y'.repeat(2001), course_id: 1 }).body);
});
test('password change validation', () => {
  assert.deepStrictEqual(L.validatePasswordChange({ current_password: 'old', new_password: 'newpass' }), {});
  assert.ok(L.validatePasswordChange({ current_password: '', new_password: 'newpass' }).current_password);
  assert.ok(L.validatePasswordChange({ current_password: 'old', new_password: '123' }).new_password);
  assert.ok(L.validatePasswordChange({ current_password: 'samepass', new_password: 'samepass' }).new_password);
});
test('csv export escapes commas, quotes and formula injection', () => {
  assert.strictEqual(L.csvCell('a,b'), '"a,b"');
  assert.strictEqual(L.csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(L.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.strictEqual(L.csvCell(null), '');
  assert.strictEqual(L.toCsv(['a', 'b'], [[1, 'x']]), 'a,b\r\n1,x');
});
