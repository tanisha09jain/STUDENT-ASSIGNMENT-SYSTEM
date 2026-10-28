// Student Assignment System - frontend (plain JavaScript, no build step).
// Sections: helpers -> api -> views -> router.
(() => {
  const state = { token: localStorage.getItem('sas_token'), user: null };
  const app = document.getElementById('app');

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => (d ? new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const BADGE = { Pending: 'b-pending', Submitted: 'b-submitted', 'Submitted late': 'b-late', Graded: 'b-graded', Overdue: 'b-overdue' };
  const badge = (s) => `<span class="badge ${BADGE[s] || 'b-role'}">${esc(s)}</span>`;
  const empty = (title, text) => `<div class="empty"><b>${esc(title)}</b>${esc(text)}</div>`;

  function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    $('#toast').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function showErrors(form, errors = {}) {
    $$('.err', form).forEach((e) => { e.textContent = ''; });
    Object.entries(errors).forEach(([k, v]) => { const el = $(`[data-err="${k}"]`, form); if (el) el.textContent = v; });
  }
  const field = (name) => `<span class="err" data-err="${name}"></span>`;

  // ---------- API ----------
  async function api(path, { method = 'GET', body, form } = {}) {
    const headers = {};
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    let payload;
    if (form) payload = form;
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(`/api${path}`, { method, headers, body: payload });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { signOut(); throw new Error('Session expired. Please sign in again.'); }
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.errors = data.errors || {}; throw e; }
    return data;
  }

  function signOut() {
    state.token = null; state.user = null;
    localStorage.removeItem('sas_token');
    location.hash = '#/login';
  }

  async function withBusy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }

  // ---------- login ----------
  function loginView() {
    app.innerHTML = `
      <main class="login"><section class="login-card">
        <h1>Student Assignment System</h1>
        <p class="muted">Sign in to manage or submit coursework.</p>
        <form id="login-form" novalidate>
          <label>Email<input id="email" type="email" autocomplete="username"></label>
          <label>Password<input id="password" type="password" autocomplete="current-password"></label>
          <div id="login-error" class="alert error" hidden></div>
          <button id="login-btn" class="btn primary" type="submit">Sign in</button>
        </form>
        <div class="demo"><p class="muted small">Demo accounts (fills the form for you):</p>
          <div class="actions">
            <button class="btn sm" type="button" data-fill="student@college.edu|student123" id="fill-student">Student</button>
            <button class="btn sm" type="button" data-fill="teacher@college.edu|teacher123" id="fill-teacher">Teacher</button>
            <button class="btn sm" type="button" data-fill="admin@college.edu|admin123" id="fill-admin">Admin</button>
          </div>
          <p class="small" style="margin:1rem 0 0">New student? <a href="#/register" id="go-register">Create an account</a></p></div>
      </section></main>`;
    $$('[data-fill]').forEach((b) => b.addEventListener('click', () => {
      const [e, p] = b.dataset.fill.split('|');
      $('#email').value = e; $('#password').value = p;
    }));
    $('#login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = $('#login-error');
      err.hidden = true;
      const email = $('#email').value.trim(); const password = $('#password').value;
      if (!email || !password) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
      await withBusy($('#login-btn'), async () => {
        try {
          const data = await api('/login', { method: 'POST', body: { email, password } });
          state.token = data.token; state.user = data.user;
          localStorage.setItem('sas_token', data.token);
          location.hash = data.user.role === 'admin' ? '#/admin' : '#/dashboard';
          render();
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      });
    });
  }

  // ---------- register (students only) ----------
  function registerView() {
    app.innerHTML = `
      <main class="login"><section class="login-card">
        <h1>Create student account</h1>
        <p class="muted">You will be enrolled in the available courses automatically.</p>
        <form id="register-form" novalidate>
          <label>Full name<input id="reg-name" autocomplete="name">${field('name')}</label>
          <label>Email<input id="reg-email" type="email" autocomplete="username">${field('email')}</label>
          <label>Password (at least 6 characters)<input id="reg-password" type="password" autocomplete="new-password">${field('password')}</label>
          <div id="reg-error" class="alert error" hidden></div>
          <button id="reg-btn" class="btn primary" type="submit">Create account</button>
        </form>
        <p class="small" style="margin-top:1rem">Already have an account? <a href="#/login" id="go-login">Sign in</a></p>
      </section></main>`;
    const form = $('#register-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); showErrors(form); $('#reg-error').hidden = true;
      await withBusy($('#reg-btn'), async () => {
        try {
          const data = await api('/register', { method: 'POST', body: { name: $('#reg-name').value, email: $('#reg-email').value, password: $('#reg-password').value } });
          state.token = data.token; state.user = data.user;
          localStorage.setItem('sas_token', data.token);
          toast('Account created. Welcome!');
          location.hash = '#/dashboard';
          render();
        } catch (e) { showErrors(form, e.errors); if (!Object.keys(e.errors || {}).length) { $('#reg-error').textContent = e.message; $('#reg-error').hidden = false; } }
      });
    });
  }

  // ---------- shell ----------
  const NAV = {
    student: [['dashboard', 'Dashboard'], ['assignments', 'Assignments'], ['grades', 'My grades'], ['announcements', 'Announcements'], ['notifications', 'Notifications'], ['courses', 'My courses'], ['profile', 'Profile']],
    teacher: [['dashboard', 'Dashboard'], ['assignments', 'Assignments'], ['assignments/new', 'New assignment'], ['announcements', 'Announcements'], ['notifications', 'Notifications'], ['courses', 'My subjects'], ['profile', 'Profile']],
    admin: [['admin', 'Overview'], ['courses', 'Courses'], ['assignments', 'Assignments'], ['announcements', 'Announcements'], ['activity', 'Activity log'], ['profile', 'Profile']],
  };

  function shell(current) {
    const links = NAV[state.user.role].map(([to, label]) =>
      `<a id="nav-${to.replace('/', '-')}" href="#/${to}" class="${current === `/${to}` ? 'active' : ''}">${label}${to === 'notifications' ? '<span class="count" id="bell-count" hidden></span>' : ''}</a>`).join('');
    app.innerHTML = `
      <div class="shell">
        <aside class="side">
          <div class="brand">Student Assignment System<span>CSE3132 project</span></div>
          <nav>${links}</nav>
          <div class="me"><strong id="user-name">${esc(state.user.name)}</strong>
            <span><span class="badge b-role" id="user-role">${esc(state.user.role)}</span></span>
            <button class="btn sm" id="logout-btn">Sign out</button></div>
        </aside>
        <main class="main" id="view"></main>
      </div>`;
    $('#logout-btn').addEventListener('click', signOut);
    if (state.user.role !== 'admin') refreshBell();
    return $('#view');
  }

  // Show the number of unread notifications next to "Notifications" in the menu.
  async function refreshBell() {
    try {
      const { unread } = await api('/notifications');
      const el = $('#bell-count');
      if (el) { el.textContent = unread; el.hidden = unread === 0; }
    } catch { /* the bell is optional, ignore errors */ }
  }

  function denied(view) {
    view.innerHTML = `<div class="card">${empty('Access denied', 'Your role does not allow this page.')}</div>`;
  }

  // ---------- dashboards ----------
  async function dashboardView(view) {
    const list = await api('/assignments');
    if (state.user.role === 'student') {
      const by = (s) => list.filter((a) => a.status === s);
      const pending = by('Pending').concat(by('Overdue'));
      const done = list.filter((a) => a.my_submission);
      const graded = by('Graded');
      view.innerHTML = `
        <div class="page-head"><div><h1>Welcome, ${esc(state.user.name)}</h1><p class="muted">Here is where your coursework stands.</p></div></div>
        <div class="stats">
          <div class="stat"><b id="stat-pending">${by('Pending').length}</b><span>Pending</span></div>
          <div class="stat"><b id="stat-overdue">${by('Overdue').length}</b><span>Overdue</span></div>
          <div class="stat"><b id="stat-submitted">${done.length}</b><span>Submitted</span></div>
          <div class="stat"><b id="stat-graded">${graded.length}</b><span>Graded</span></div>
        </div>
        <h2>To do</h2>
        <div class="table-wrap">${pending.length ? `<table><thead><tr><th>Assignment</th><th>Subject</th><th>Deadline</th><th>Status</th><th></th></tr></thead><tbody>
          ${pending.map((a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.course_code)}</td><td>${fmt(a.deadline)}</td><td>${badge(a.status)}</td>
          <td><a class="btn sm primary" href="#/assignments/${a.id}/submit">Submit work</a></td></tr>`).join('')}</tbody></table>`
          : empty('You are all caught up', 'No pending assignments right now.')}</div>
        <h2 style="margin-top:1.5rem">Recent grades</h2>
        <div class="table-wrap">${graded.length ? `<table><tbody>${graded.map((a) => `<tr><td>${esc(a.title)}</td>
          <td><b>${a.my_submission.marks}</b> / ${a.max_marks}</td><td><a href="#/grades">View feedback</a></td></tr>`).join('')}</tbody></table>`
          : empty('No grades yet', 'Grades appear here once your teacher marks your work.')}</div>`;
    } else {
      const toGrade = list.filter((a) => a.submission_count > a.graded_count);
      const sum = (k) => list.reduce((n, a) => n + a[k], 0);
      view.innerHTML = `
        <div class="page-head"><div><h1>Welcome, ${esc(state.user.name)}</h1><p class="muted">Your assignments and submissions at a glance.</p></div>
          <a class="btn primary" id="new-assignment-btn" href="#/assignments/new">New assignment</a></div>
        <div class="stats">
          <div class="stat"><b id="stat-assignments">${list.length}</b><span>Assignments</span></div>
          <div class="stat"><b id="stat-submissions">${sum('submission_count')}</b><span>Submissions</span></div>
          <div class="stat"><b id="stat-to-grade">${sum('submission_count') - sum('graded_count')}</b><span>Waiting for grading</span></div>
          <div class="stat"><b id="stat-graded">${sum('graded_count')}</b><span>Graded</span></div>
        </div>
        <h2>Needs grading</h2>
        <div class="table-wrap">${toGrade.length ? `<table><thead><tr><th>Assignment</th><th>Subject</th><th>Ungraded</th><th></th></tr></thead><tbody>
          ${toGrade.map((a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.course_code)}</td><td>${a.submission_count - a.graded_count}</td>
          <td><a class="btn sm primary" href="#/assignments/${a.id}/submissions">Review</a></td></tr>`).join('')}</tbody></table>`
          : empty('Nothing to grade', 'New submissions will show up here.')}</div>`;
    }
    const latest = (await api('/announcements')).slice(0, 3);
    view.insertAdjacentHTML('beforeend', `<h2 style="margin-top:1.5rem">Latest announcements</h2>${latest.length
      ? latest.map((a) => `<div class="card"><h3>${esc(a.title)}</h3><div class="muted small">${esc(a.course_code)} · ${esc(a.author)} · ${fmt(a.created_at)}</div><p class="desc" style="margin:.4rem 0 0">${esc(a.body)}</p></div>`).join('')
      : `<div class="card">${empty('No announcements', 'Your teachers have not posted anything yet.')}</div>`}`);
  }

  // ---------- assignments ----------
  async function listView(view) {
    const [list, courses] = await Promise.all([api('/assignments'), api('/courses')]);
    const role = state.user.role;
    view.innerHTML = `
      <div class="page-head"><div><h1>Assignments</h1><p class="muted" id="count"></p></div>
        ${role === 'teacher' ? '<a class="btn primary" id="new-assignment-btn" href="#/assignments/new">New assignment</a>' : ''}</div>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search by title">
        <select id="filter-course"><option value="">All subjects</option>${courses.map((c) => `<option value="${esc(c.code)}">${esc(c.code)}</option>`).join('')}</select>
        ${role === 'student' ? `<select id="filter-status"><option value="">All statuses</option>${['Pending', 'Submitted', 'Submitted late', 'Graded', 'Overdue'].map((s) => `<option>${s}</option>`).join('')}</select>` : ''}
      </div>
      <div class="table-wrap" id="table-area"></div>`;

    function draw() {
      const q = $('#search').value.trim().toLowerCase(); const c = $('#filter-course').value;
      const st = $('#filter-status') ? $('#filter-status').value : '';
      const rows = list.filter((a) => a.title.toLowerCase().includes(q) && (!c || a.course_code === c) && (!st || a.status === st));
      $('#count').textContent = `${rows.length} of ${list.length} shown`;
      if (!rows.length) {
        $('#table-area').innerHTML = empty(list.length ? 'No matches' : 'No assignments yet',
          list.length ? 'Try a different search or filter.' : (role === 'teacher' ? 'Create your first assignment to get started.' : 'Your teachers have not posted any assignments.'));
        return;
      }
      $('#table-area').innerHTML = `<table id="assignments-table"><thead><tr><th>Title</th><th>Subject</th><th>Deadline</th><th>Marks</th>
        <th>${role === 'student' ? 'Status' : 'Submissions'}</th><th></th></tr></thead><tbody>
        ${rows.map((a) => `<tr data-title="${esc(a.title)}"><td><a href="#/assignments/${a.id}">${esc(a.title)}</a></td><td>${esc(a.course_code)}</td><td>${fmt(a.deadline)}</td>
          <td>${a.max_marks}</td><td>${role === 'student' ? badge(a.status) : `${a.submission_count} (${a.graded_count} graded)`}</td>
          <td class="actions-cell"><a class="btn sm open-btn" href="#/assignments/${a.id}">Open</a>
          ${role === 'teacher' ? `<a class="btn sm" href="#/assignments/${a.id}/submissions">Submissions</a><a class="btn sm" href="#/assignments/${a.id}/edit">Edit</a>
            <button class="btn sm danger delete-btn" data-id="${a.id}" data-title="${esc(a.title)}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      $$('.delete-btn').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm(`Delete "${b.dataset.title}"? This also removes all submissions and grades for it.`)) return;
        try { await api(`/assignments/${b.dataset.id}`, { method: 'DELETE' }); toast('Assignment deleted.'); render(); } catch (e) { toast(e.message, 'error'); }
      }));
    }
    ['#search', '#filter-course', '#filter-status'].forEach((s) => { const el = $(s); if (el) el.addEventListener('input', draw); });
    draw();
  }

  async function detailView(view, id) {
    const a = await api(`/assignments/${id}`);
    const role = state.user.role;
    const sub = a.my_submission;
    let studentPart = '';
    if (role === 'student') {
      studentPart = `<div class="card"><h2>Your submission</h2>
        <p>Status: ${badge(a.status)}</p>
        ${sub ? `<p class="muted small">Submitted ${fmt(sub.submitted_at)}${sub.file_name ? ` · file: ${esc(sub.file_name)}` : ''}</p>` : ''}
        ${sub && sub.marks != null ? `<div class="grade-box" id="grade-box"><b>${sub.marks} / ${a.max_marks}</b><p class="desc" style="margin:.3rem 0 0">${esc(sub.feedback)}</p></div>` : ''}
        ${!sub || sub.marks == null ? `<p><a class="btn primary" id="submit-link" href="#/assignments/${a.id}/submit">${sub ? 'Update submission' : 'Submit work'}</a></p>` : ''}</div>`;
    }
    view.innerHTML = `
      <p><a href="#/assignments">← All assignments</a></p>
      <div class="page-head"><div><h1 id="detail-title">${esc(a.title)}</h1><p class="muted">${esc(a.course_code)} · ${esc(a.course_name)} · ${esc(a.teacher_name)}</p></div>
        ${role === 'teacher' ? `<div class="actions"><a class="btn" href="#/assignments/${a.id}/submissions" id="review-link">Review submissions</a><a class="btn" href="#/assignments/${a.id}/edit">Edit</a></div>` : ''}</div>
      <div class="card"><div class="meta"><span>Deadline <b>${fmt(a.deadline)}</b></span><span>Maximum marks <b>${a.max_marks}</b></span>
        ${role !== 'student' ? `<span>Submissions <b>${a.submission_count}</b></span>` : ''}</div>
        <h2>Instructions</h2><p class="desc">${esc(a.description)}</p></div>${studentPart}`;
  }

  async function formView(view, id) {
    const courses = await api('/courses');
    const existing = id ? await api(`/assignments/${id}`) : null;
    const defaultDeadline = (() => { const d = new Date(Date.now() + 7 * 86400000); d.setHours(23, 59, 0, 0); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; })();
    const v = existing || { title: '', description: '', course_id: '', deadline: defaultDeadline, max_marks: 100 };
    view.innerHTML = `
      <p><a href="#/assignments">← All assignments</a></p>
      <div class="page-head"><h1>${existing ? 'Edit assignment' : 'New assignment'}</h1></div>
      ${courses.length ? `<form class="card form-card" id="assignment-form" novalidate>
        <label>Title<input id="title" value="${esc(v.title)}">${field('title')}</label>
        <label>Subject<select id="course_id"><option value="">Choose a subject</option>${courses.map((c) => `<option value="${c.id}" ${Number(v.course_id) === c.id ? 'selected' : ''}>${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select>${field('course_id')}</label>
        <label>Description and instructions<textarea id="description">${esc(v.description)}</textarea>${field('description')}</label>
        <div class="row"><label>Deadline<input id="deadline" type="datetime-local" value="${esc(v.deadline)}">${field('deadline')}</label>
          <label>Maximum marks<input id="max_marks" type="number" min="1" value="${esc(v.max_marks)}">${field('max_marks')}</label></div>
        <div class="alert error" id="form-error" hidden></div>
        <div class="actions"><button class="btn primary" id="save-assignment-btn" type="submit">${existing ? 'Save changes' : 'Create assignment'}</button>
          <a class="btn" href="#/assignments">Cancel</a></div></form>`
        : `<div class="card">${empty('No subjects assigned', 'Ask an administrator to assign you a subject before creating assignments.')}</div>`}`;
    const form = $('#assignment-form');
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      showErrors(form); $('#form-error').hidden = true;
      const body = { title: $('#title').value, course_id: $('#course_id').value, description: $('#description').value, deadline: $('#deadline').value, max_marks: $('#max_marks').value };
      await withBusy($('#save-assignment-btn'), async () => {
        try {
          const r = await api(existing ? `/assignments/${id}` : '/assignments', { method: existing ? 'PUT' : 'POST', body });
          toast(existing ? 'Assignment updated.' : 'Assignment created.');
          location.hash = `#/assignments/${existing ? id : r.id}`;
        } catch (e) { showErrors(form, e.errors); $('#form-error').textContent = e.message; $('#form-error').hidden = false; }
      });
    });
  }

  async function submitView(view, id) {
    const a = await api(`/assignments/${id}`);
    const sub = a.my_submission;
    if (sub && sub.marks != null) { location.hash = `#/assignments/${id}`; return; }
    view.innerHTML = `
      <p><a href="#/assignments/${a.id}">← Back to assignment</a></p>
      <div class="page-head"><div><h1>Submit work</h1><p class="muted">${esc(a.title)} · due ${fmt(a.deadline)}</p></div></div>
      ${a.status === 'Overdue' ? '<div class="alert error">The deadline has passed. Your submission will be marked late.</div>' : ''}
      ${sub ? `<div class="alert info">You already submitted on ${fmt(sub.submitted_at)}. Sending again replaces your answer${sub.file_name ? ' (the earlier file is kept unless you attach a new one)' : ''}.</div>` : ''}
      <form class="card form-card" id="submit-form" novalidate>
        <label>Attach a file (PDF, Word, text, zip, image, code · max 5 MB)<input id="file" type="file">${field('file')}</label>
        <label>Answer or notes<textarea id="answer_text">${esc(sub ? sub.answer_text : '')}</textarea>${field('answer_text')}</label>
        <div class="alert error" id="form-error" hidden></div>
        <div class="actions"><button class="btn primary" id="submit-work-btn" type="submit">${sub ? 'Update submission' : 'Submit work'}</button><a class="btn" href="#/assignments/${a.id}">Cancel</a></div>
      </form>`;
    const form = $('#submit-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); showErrors(form); $('#form-error').hidden = true;
      const fd = new FormData();
      const f = $('#file').files[0];
      if (f) fd.append('file', f);
      fd.append('answer_text', $('#answer_text').value);
      await withBusy($('#submit-work-btn'), async () => {
        try { await api(`/assignments/${id}/submit`, { method: 'POST', form: fd }); toast('Submission saved.'); location.hash = `#/assignments/${id}`; }
        catch (e) { showErrors(form, e.errors); $('#form-error').textContent = e.message; $('#form-error').hidden = false; }
      });
    });
  }

  async function download(subId, name) { return downloadUrl(`/api/submissions/${subId}/file`, name); }

  async function downloadUrl(url0, name) {
    const res = await fetch(url0, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) { toast('Could not download this file.', 'error'); return; }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
  }

  async function reviewView(view, id) {
    const { assignment: a, rows } = await api(`/assignments/${id}/submissions`);
    view.innerHTML = `
      <p><a href="#/assignments/${a.id}">← Back to assignment</a></p>
      <div class="page-head"><div><h1>Submissions</h1><p class="muted">${esc(a.title)} · ${esc(a.course_code)} · max ${a.max_marks} marks</p></div>
        <button class="btn" id="export-btn">Export marks (CSV)</button></div>
      ${(() => {
        const submitted = rows.filter((r) => r.submission_id).length;
        const marks = rows.filter((r) => r.marks != null).map((r) => r.marks);
        const avg = marks.length ? (marks.reduce((x, y) => x + y, 0) / marks.length).toFixed(1) : '—';
        return `<div class="stats" id="review-stats">
          <div class="stat"><b>${submitted} / ${rows.length}</b><span>Submitted</span></div>
          <div class="stat"><b>${marks.length}</b><span>Graded</span></div>
          <div class="stat"><b id="avg-marks">${avg}</b><span>Average marks</span></div>
          <div class="stat"><b>${marks.length ? Math.max(...marks) : '—'}</b><span>Highest</span></div>
          <div class="stat"><b>${marks.length ? Math.min(...marks) : '—'}</b><span>Lowest</span></div></div>`;
      })()}
      ${rows.length ? `<div class="grid2">${rows.map((r) => {
        const status = r.marks != null ? 'Graded' : r.submission_id ? (r.is_late ? 'Submitted late' : 'Submitted') : 'Pending';
        return `<div class="card student-card" data-student="${esc(r.student_name)}">
          <div class="head"><h3>${esc(r.student_name)}</h3>${r.submission_id ? badge(status) : '<span class="badge b-pending">Not submitted</span>'}</div>
          <div class="muted small">${esc(r.email)}</div>
          ${r.submission_id ? `<div class="muted small">Submitted ${fmt(r.submitted_at)}</div>
            ${r.answer_text ? `<div class="answer">${esc(r.answer_text)}</div>` : ''}
            ${r.file_name ? `<button class="btn sm download-btn" data-sub="${r.submission_id}" data-name="${esc(r.file_name)}">Download ${esc(r.file_name)}</button>` : ''}
            <form class="grade-form" data-sub="${r.submission_id}" novalidate style="margin-top:.9rem">
              <div class="row"><label>Marks (0–${a.max_marks})<input class="marks-input" type="number" step="0.5" value="${r.marks ?? ''}">${field('marks')}</label><span></span></div>
              <label>Feedback<textarea class="feedback-input">${esc(r.feedback || '')}</textarea>${field('feedback')}</label>
              <div><button class="btn primary save-grade-btn" type="submit">${r.marks != null ? 'Update grade' : 'Save grade'}</button></div>
            </form>` : '<p class="muted">Nothing to grade yet.</p>'}</div>`;
      }).join('')}</div>` : `<div class="card">${empty('No students enrolled', 'Ask an administrator to enrol students in this subject.')}</div>`}`;
    $$('.download-btn').forEach((b) => b.addEventListener('click', () => download(b.dataset.sub, b.dataset.name)));
    $('#export-btn').addEventListener('click', () => downloadUrl(`/api/assignments/${a.id}/export`, `${a.course_code}-${a.title.replace(/[^a-z0-9]+/gi, '_')}-marks.csv`));
    $$('.grade-form').forEach((form) => form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); showErrors(form);
      await withBusy($('.save-grade-btn', form), async () => {
        try {
          await api(`/submissions/${form.dataset.sub}/grade`, { method: 'PUT', body: { marks: $('.marks-input', form).value, feedback: $('.feedback-input', form).value } });
          toast('Grade saved.'); render();
        } catch (e) { showErrors(form, e.errors); if (!Object.keys(e.errors).length) toast(e.message, 'error'); }
      });
    }));
  }

  async function gradesView(view) {
    const list = (await api('/assignments')).filter((a) => a.my_submission);
    const graded = list.filter((a) => a.my_submission.marks != null);
    const total = graded.reduce((n, a) => n + a.my_submission.marks, 0);
    const max = graded.reduce((n, a) => n + a.max_marks, 0);
    view.innerHTML = `
      <div class="page-head"><div><h1>My grades</h1><p class="muted">Marks and feedback from your teachers.</p></div></div>
      ${graded.length ? `<div class="stats"><div class="stat"><b id="overall">${max ? Math.round((total / max) * 100) : 0}%</b><span>Overall (${total} / ${max})</span></div>
        <div class="stat"><b>${graded.length}</b><span>Graded</span></div></div>` : ''}
      <div class="table-wrap">${list.length ? `<table id="grades-table"><thead><tr><th>Assignment</th><th>Status</th><th>Marks</th><th>Feedback</th></tr></thead><tbody>
        ${list.map((a) => `<tr><td><a href="#/assignments/${a.id}">${esc(a.title)}</a><div class="muted small">${esc(a.course_code)}</div></td><td>${badge(a.status)}</td>
          <td>${a.my_submission.marks != null ? `<b>${a.my_submission.marks}</b> / ${a.max_marks}` : '—'}</td>
          <td>${a.my_submission.marks != null ? esc(a.my_submission.feedback) : '<span class="muted">Waiting for your teacher</span>'}</td></tr>`).join('')}</tbody></table>`
        : empty('Nothing submitted yet', 'Submit an assignment to see your marks and feedback here.')}</div>`;
  }

  // ---------- courses ----------
  async function coursesView(view) {
    const role = state.user.role;
    const courses = await api('/courses');
    const teachers = role === 'admin' ? (await api('/users')).filter((u) => u.role === 'teacher') : [];
    view.innerHTML = `
      <div class="page-head"><div><h1>${role === 'admin' ? 'Course management' : 'Subjects'}</h1><p class="muted">${courses.length} subject${courses.length === 1 ? '' : 's'}</p></div></div>
      ${role === 'admin' ? `<form class="card form-card" id="course-form" novalidate><h2>Add a course</h2>
        <div class="row"><label>Code<input id="c-code" placeholder="CSE3132">${field('code')}</label><label>Name<input id="c-name">${field('name')}</label></div>
        <label>Teacher<select id="c-teacher"><option value="">Choose a teacher</option>${teachers.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>${field('teacher_id')}</label>
        <div><button class="btn primary" id="add-course-btn" type="submit">Add course</button></div></form>` : ''}
      <div class="table-wrap">${courses.length ? `<table id="courses-table"><thead><tr><th>Code</th><th>Name</th><th>Teacher</th><th>Students</th><th>Assignments</th>${role === 'admin' ? '<th></th>' : ''}</tr></thead><tbody>
        ${courses.map((c) => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td><td>${esc(c.teacher_name)}</td><td>${c.student_count}</td><td>${c.assignment_count}</td>
        ${role === 'admin' ? `<td class="actions-cell"><button class="btn sm enrol-btn" data-id="${c.id}" data-name="${esc(c.code)}">Manage students</button>
          <button class="btn sm danger del-course" data-id="${c.id}" data-name="${esc(c.code)}">Delete</button></td>` : ''}</tr>`).join('')}</tbody></table>`
        : empty('No subjects', role === 'student' ? 'You are not enrolled in any subject yet.' : 'No subjects are assigned to you yet.')}</div>
      <div id="enrol-panel"></div>`;
    if (role !== 'admin') return;
    const form = $('#course-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); showErrors(form);
      await withBusy($('#add-course-btn'), async () => {
        try { await api('/courses', { method: 'POST', body: { code: $('#c-code').value, name: $('#c-name').value, teacher_id: $('#c-teacher').value } }); toast('Course added.'); render(); }
        catch (e) { showErrors(form, e.errors); if (!Object.keys(e.errors).length) toast(e.message, 'error'); }
      });
    });
    $$('.del-course').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Delete course ${b.dataset.name}? All its assignments, submissions and grades will be removed.`)) return;
      try { await api(`/courses/${b.dataset.id}`, { method: 'DELETE' }); toast('Course deleted.'); render(); } catch (e) { toast(e.message, 'error'); }
    }));
    $$('.enrol-btn').forEach((b) => b.addEventListener('click', async () => {
      const students = await api(`/courses/${b.dataset.id}/students`);
      $('#enrol-panel').innerHTML = `<div class="card form-card" style="margin-top:1rem"><h2>Students in ${esc(b.dataset.name)}</h2>
        <div class="checks">${students.map((s) => `<label><input type="checkbox" value="${s.id}" ${s.enrolled ? 'checked' : ''}> ${esc(s.name)} <span class="muted small">${esc(s.email)}</span></label>`).join('')}</div>
        <div class="actions"><button class="btn primary" id="save-enrol">Save enrolment</button></div></div>`;
      $('#save-enrol').addEventListener('click', async () => {
        const ids = $$('#enrol-panel input:checked').map((i) => Number(i.value));
        try { await api(`/courses/${b.dataset.id}/students`, { method: 'PUT', body: { student_ids: ids } }); toast('Enrolment saved.'); render(); } catch (e) { toast(e.message, 'error'); }
      });
      $('#enrol-panel').scrollIntoView({ behavior: 'smooth' });
    }));
  }

  // ---------- admin ----------
  async function adminView(view) {
    const [stats, users, courses, assignments] = await Promise.all([api('/stats'), api('/users'), api('/courses'), api('/assignments')]);
    view.innerHTML = `
      <div class="page-head"><div><h1>Admin overview</h1><p class="muted">System statistics and user management.</p></div></div>
      <div class="stats">${[['students', 'Students'], ['teachers', 'Teachers'], ['courses', 'Courses'], ['assignments', 'Assignments'], ['submissions', 'Submissions'], ['graded', 'Graded'], ['announcements', 'Announcements']]
        .map(([k, l]) => `<div class="stat"><b id="stat-${k}">${stats[k]}</b><span>${l}</span></div>`).join('')}</div>
      <h2>Users</h2>
      <div class="table-wrap"><table id="users-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="badge b-role">${u.role}</span></td>
        <td>${u.id === state.user.id ? '<span class="muted small">You</span>' : `<button class="btn sm danger del-user" data-id="${u.id}" data-name="${esc(u.name)}">Delete</button>`}</td></tr>`).join('')}</tbody></table></div>
      <form class="card form-card" id="user-form" novalidate style="margin-top:1rem"><h2>Add a demo user</h2>
        <div class="row"><label>Name<input id="u-name">${field('name')}</label><label>Email<input id="u-email" type="email">${field('email')}</label></div>
        <div class="row"><label>Password<input id="u-pass" type="password">${field('password')}</label>
          <label>Role<select id="u-role"><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select>${field('role')}</label></div>
        <div><button class="btn primary" id="add-user-btn" type="submit">Add user</button></div></form>
      <h2 style="margin-top:1.5rem">Courses</h2>
      <div class="table-wrap">${courses.length ? `<table><tbody>${courses.map((c) => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td><td>${esc(c.teacher_name)}</td><td>${c.student_count} students</td></tr>`).join('')}</tbody></table>` : empty('No courses', 'Add one on the Courses page.')}
      </div>
      <h2 style="margin-top:1.5rem">Assignments</h2>
      <div class="table-wrap">${assignments.length ? `<table><tbody>${assignments.map((a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.course_code)}</td><td>${fmt(a.deadline)}</td><td>${a.submission_count} submissions</td></tr>`).join('')}</tbody></table>` : empty('No assignments', 'Teachers have not created any yet.')}
      </div>`;
    const form = $('#user-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); showErrors(form);
      await withBusy($('#add-user-btn'), async () => {
        try { await api('/users', { method: 'POST', body: { name: $('#u-name').value, email: $('#u-email').value, password: $('#u-pass').value, role: $('#u-role').value } }); toast('User added.'); render(); }
        catch (e) { showErrors(form, e.errors); if (!Object.keys(e.errors).length) toast(e.message, 'error'); }
      });
    });
    $$('.del-user').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Delete user ${b.dataset.name}? Their submissions and grades will also be removed.`)) return;
      try { await api(`/users/${b.dataset.id}`, { method: 'DELETE' }); toast('User deleted.'); render(); } catch (e) { toast(e.message, 'error'); }
    }));
  }

  // ---------- announcements ----------
  async function announcementsView(view) {
    const role = state.user.role;
    const [items, courses] = await Promise.all([api('/announcements'), role === 'teacher' ? api('/courses') : Promise.resolve([])]);
    view.innerHTML = `
      <div class="page-head"><div><h1>Announcements</h1><p class="muted">News and reminders from teachers.</p></div></div>
      ${role === 'teacher' ? `<form class="card form-card" id="ann-form" novalidate><h2>Post an announcement</h2>
        <label>Subject<select id="ann-course"><option value="">Choose a subject</option>${courses.map((c) => `<option value="${c.id}">${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select>${field('course_id')}</label>
        <label>Title<input id="ann-title">${field('title')}</label>
        <label>Message<textarea id="ann-body"></textarea>${field('body')}</label>
        <div><button class="btn primary" id="post-ann-btn" type="submit">Post announcement</button></div></form>` : ''}
      ${items.length ? items.map((a) => `<div class="card announcement"><div class="head" style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
          <h3>${esc(a.title)}</h3>${role === 'teacher' ? `<button class="btn sm danger del-ann" data-id="${a.id}" data-title="${esc(a.title)}">Delete</button>` : ''}</div>
          <div class="muted small">${esc(a.course_code)} · ${esc(a.author)} · ${fmt(a.created_at)}</div><p class="desc" style="margin:.5rem 0 0">${esc(a.body)}</p></div>`).join('')
        : `<div class="card">${empty('No announcements yet', role === 'teacher' ? 'Post the first one using the form above.' : 'Your teachers have not posted anything yet.')}</div>`}`;
    const form = $('#ann-form');
    if (form) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault(); showErrors(form);
        await withBusy($('#post-ann-btn'), async () => {
          try { await api('/announcements', { method: 'POST', body: { course_id: $('#ann-course').value, title: $('#ann-title').value, body: $('#ann-body').value } }); toast('Announcement posted.'); render(); }
          catch (e) { showErrors(form, e.errors); if (!Object.keys(e.errors || {}).length) toast(e.message, 'error'); }
        });
      });
    }
    $$('.del-ann').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Delete announcement "${b.dataset.title}"?`)) return;
      try { await api(`/announcements/${b.dataset.id}`, { method: 'DELETE' }); toast('Announcement deleted.'); render(); } catch (e) { toast(e.message, 'error'); }
    }));
  }

  // ---------- notifications ----------
  async function notificationsView(view) {
    const { items } = await api('/notifications');
    view.innerHTML = `
      <div class="page-head"><div><h1>Notifications</h1><p class="muted">Updates about assignments, submissions and grades.</p></div></div>
      <div class="table-wrap" id="notif-list">${items.length ? `<table><tbody>${items.map((n) => `<tr class="${n.is_read ? '' : 'unread'}">
        <td>${n.is_read ? '' : '<span class="dot" title="New"></span>'}</td>
        <td>${n.link ? `<a href="${esc(n.link)}">${esc(n.message)}</a>` : esc(n.message)}</td><td class="muted small">${fmt(n.created_at)}</td></tr>`).join('')}</tbody></table>`
        : empty('No notifications', 'You will be told here when something changes.')}</div>`;
    await api('/notifications/read-all', { method: 'POST' });
    const el = $('#bell-count'); if (el) el.hidden = true;
  }

  // ---------- activity log (admin) ----------
  async function activityView(view) {
    const log = await api('/activity');
    view.innerHTML = `
      <div class="page-head"><div><h1>Activity log</h1><p class="muted">The 100 most recent actions in the system.</p></div></div>
      <div class="table-wrap">${log.length ? `<table id="activity-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
        ${log.map((l) => `<tr><td>${fmt(l.created_at)}</td><td>${esc(l.user_name)}</td><td>${esc(l.action)}</td><td class="muted">${esc(l.details)}</td></tr>`).join('')}</tbody></table>`
        : empty('No activity yet', 'Actions will be recorded here.')}</div>`;
  }

  // ---------- profile ----------
  function profileView(view) {
    const u = state.user;
    view.innerHTML = `
      <div class="page-head"><div><h1>Profile</h1><p class="muted">Your account details and password.</p></div></div>
      <div class="card form-card"><div class="meta"><span>Name <b>${esc(u.name)}</b></span><span>Email <b>${esc(u.email)}</b></span><span>Role <b>${esc(u.role)}</b></span></div></div>
      <form class="card form-card" id="pass-form" novalidate><h2>Change password</h2>
        <label>Current password<input id="cur-pass" type="password" autocomplete="current-password">${field('current_password')}</label>
        <label>New password (at least 6 characters)<input id="new-pass" type="password" autocomplete="new-password">${field('new_password')}</label>
        <div><button class="btn primary" id="change-pass-btn" type="submit">Change password</button></div></form>`;
    const form = $('#pass-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); showErrors(form);
      await withBusy($('#change-pass-btn'), async () => {
        try { await api('/me/password', { method: 'PUT', body: { current_password: $('#cur-pass').value, new_password: $('#new-pass').value } }); toast('Password changed.'); form.reset(); }
        catch (e) { showErrors(form, e.errors); if (!Object.keys(e.errors || {}).length) toast(e.message, 'error'); }
      });
    });
  }

  // ---------- router ----------
  const ALL = ['student', 'teacher', 'admin'];
  const routes = [
    [/^\/dashboard$/, ALL, (v) => (state.user.role === 'admin' ? (location.hash = '#/admin') : dashboardView(v))],
    [/^\/admin$/, ['admin'], adminView],
    [/^\/assignments$/, ALL, listView],
    [/^\/assignments\/new$/, ['teacher'], (v) => formView(v, null)],
    [/^\/assignments\/(\d+)$/, ALL, detailView],
    [/^\/assignments\/(\d+)\/edit$/, ['teacher'], (v, id) => formView(v, id)],
    [/^\/assignments\/(\d+)\/submit$/, ['student'], submitView],
    [/^\/assignments\/(\d+)\/submissions$/, ['teacher'], reviewView],
    [/^\/grades$/, ['student'], gradesView],
    [/^\/courses$/, ALL, coursesView],
    [/^\/announcements$/, ALL, announcementsView],
    [/^\/notifications$/, ['student', 'teacher'], notificationsView],
    [/^\/activity$/, ['admin'], activityView],
    [/^\/profile$/, ALL, profileView],
  ];

  async function render() {
    if (state.token && !state.user) {
      try { state.user = await api('/me'); } catch { state.token = null; }
    }
    if (!state.user) {
      if (location.hash === '#/register') return registerView();
      if (location.hash !== '#/login') location.hash = '#/login';
      return loginView();
    }
    let path = location.hash.slice(1);
    if (!path || path === '/login') { location.hash = state.user.role === 'admin' ? '#/admin' : '#/dashboard'; return null; }
    const view = shell(path.replace(/\/(\d+)(?=\/|$).*/, ''));
    const hit = routes.map(([re, roles, fn]) => [re.exec(path), roles, fn]).find(([m]) => m);
    if (!hit) { view.innerHTML = `<div class="card">${empty('Page not found', 'Use the menu to go somewhere else.')}</div>`; return null; }
    const [match, roles, fn] = hit;
    if (!roles.includes(state.user.role)) return denied(view);
    try { await fn(view, match[1]); } catch (e) {
      view.innerHTML = `<div class="card"><div class="alert error">${esc(e.message)}</div><a class="btn" href="#/assignments">Back</a></div>`;
    }
    return null;
  }

  window.addEventListener('hashchange', render);
  render();
})();
