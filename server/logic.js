// Business rules kept in small, pure functions so they are easy to read and unit test.

const ROLES = ['student', 'teacher', 'admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidDate(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

// Returns an object of { fieldName: message }. Empty object means the data is valid.
function validateAssignment(data, { requireFutureDeadline = true } = {}) {
  const errors = {};
  const title = (data.title || '').trim();
  if (!title) errors.title = 'Title is required.';
  else if (title.length > 120) errors.title = 'Title must be 120 characters or fewer.';

  if (!(data.description || '').trim()) errors.description = 'Description is required.';

  const courseId = Number(data.course_id);
  if (!Number.isInteger(courseId) || courseId <= 0) errors.course_id = 'Choose a subject.';

  if (!data.deadline) errors.deadline = 'Deadline is required.';
  else if (!isValidDate(data.deadline)) errors.deadline = 'Deadline is not a valid date.';
  else if (requireFutureDeadline && new Date(data.deadline) <= new Date()) {
    errors.deadline = 'Deadline must be in the future.';
  }

  const marks = Number(data.max_marks);
  if (data.max_marks === '' || data.max_marks == null) errors.max_marks = 'Maximum marks is required.';
  else if (!Number.isInteger(marks) || marks < 1 || marks > 1000) {
    errors.max_marks = 'Maximum marks must be a whole number from 1 to 1000.';
  }
  return errors;
}

function validateGrade(data, maxMarks) {
  const errors = {};
  const marks = Number(data.marks);
  if (data.marks === '' || data.marks == null || Number.isNaN(marks)) errors.marks = 'Marks are required.';
  else if (marks < 0 || marks > maxMarks) errors.marks = `Marks must be between 0 and ${maxMarks}.`;
  const feedback = (data.feedback || '').trim();
  if (!feedback) errors.feedback = 'Written feedback is required.';
  else if (feedback.length > 2000) errors.feedback = 'Feedback must be 2000 characters or fewer.';
  return errors;
}

function validateUser(data) {
  const errors = {};
  if (!(data.name || '').trim()) errors.name = 'Name is required.';
  if (!EMAIL_RE.test((data.email || '').trim())) errors.email = 'Enter a valid email address.';
  if (!data.password || data.password.length < 6) errors.password = 'Password must be at least 6 characters.';
  if (!ROLES.includes(data.role)) errors.role = 'Choose a role.';
  return errors;
}

function validateCourse(data) {
  const errors = {};
  const code = (data.code || '').trim();
  if (!code) errors.code = 'Course code is required.';
  else if (code.length > 20) errors.code = 'Course code must be 20 characters or fewer.';
  if (!(data.name || '').trim()) errors.name = 'Course name is required.';
  if (!Number.isInteger(Number(data.teacher_id)) || Number(data.teacher_id) <= 0) errors.teacher_id = 'Choose a teacher.';
  return errors;
}

function validateAnnouncement(data) {
  const errors = {};
  const title = (data.title || '').trim();
  if (!title) errors.title = 'Title is required.';
  else if (title.length > 120) errors.title = 'Title must be 120 characters or fewer.';
  const body = (data.body || '').trim();
  if (!body) errors.body = 'Message is required.';
  else if (body.length > 2000) errors.body = 'Message must be 2000 characters or fewer.';
  if (!Number.isInteger(Number(data.course_id)) || Number(data.course_id) <= 0) errors.course_id = 'Choose a subject.';
  return errors;
}

function validatePasswordChange(data) {
  const errors = {};
  if (!data.current_password) errors.current_password = 'Enter your current password.';
  if (!data.new_password || data.new_password.length < 6) errors.new_password = 'New password must be at least 6 characters.';
  else if (data.new_password === data.current_password) errors.new_password = 'New password must be different from the current one.';
  return errors;
}

// CSV export helpers. Cells starting with = + - @ get a leading apostrophe so Excel cannot run them as formulas.
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// Student-facing status of one assignment.
function assignmentStatus(assignment, submission, now = new Date()) {
  if (submission && submission.marks != null) return 'Graded';
  if (submission) return submission.is_late ? 'Submitted late' : 'Submitted';
  return new Date(assignment.deadline) < now ? 'Overdue' : 'Pending';
}

function isLate(deadline, now = new Date()) {
  return now > new Date(deadline);
}

module.exports = {
  ROLES, validateAssignment, validateGrade, validateUser, validateCourse, assignmentStatus, isLate, isValidDate,
  validateAnnouncement, validatePasswordChange, csvCell, toCsv,
};
