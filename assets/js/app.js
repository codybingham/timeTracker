(() => {
  const storageKey = 'tt_v1';
  const defaultState = { projects: [], sessions: [], activeTimer: null };

  const state = loadState();
  let persistTimer;
  let activeTick = null;
  let pendingNoteId = null;
  let editingSessionId = null;
  let view = 'daily';
  let anchor = today();

  const $ = (id) => document.getElementById(id);

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(defaultState));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return cloneDefaultState();
      const parsed = JSON.parse(raw);
      return {
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        activeTimer: parsed.activeTimer ?? null,
      };
    } catch (error) {
      console.warn('Failed to parse saved data, resetting state.', error);
      return cloneDefaultState();
    }
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(state));
    }, 200);
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function today() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }

  function startOfWeek(date) {
    const clone = new Date(date);
    const day = (clone.getDay() + 6) % 7;
    clone.setDate(clone.getDate() - day);
    clone.setHours(0, 0, 0, 0);
    return clone;
  }

  function endOfWeek(date) {
    const start = startOfWeek(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return end;
  }

  function formatHM(seconds) {
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const pieces = [];

    if (hours > 0) pieces.push(`${hours}h`);
    if (minutes > 0 || hours > 0) pieces.push(`${minutes}m`);
    pieces.push(`${secs}s`);

    return pieces.join(' ');
  }

  function fmtDT(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  function toLocalDateTimeInputValue(timestamp) {
    if (typeof timestamp !== 'number') return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function parseDateTimeLocal(value) {
    if (!value) return null;
    const date = new Date(value);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
  }

  function openProjectModal(mode = 'add', id = null) {
    const title = $('projectModalTitle');
    const editingIdEl = $('editingProjectId');
    const project = id ? state.projects.find((item) => item.id === id) : null;

    title.textContent = mode === 'edit' ? 'Edit Project' : 'New Project';
    editingIdEl.value = mode === 'edit' && project ? project.id : '';

    const now = new Date();
    const todayLocal = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);

    $('projNo').value = project?.projectNo ?? '';
    $('taskNo').value = project?.taskNo ?? '';
    $('projName').value = project?.name ?? '';
    $('startDate').value = project?.startDate ?? todayLocal;
    $('endDate').value = project?.endDate ?? '';
    $('statusSel').value = project?.status ?? 'In Queue';
    $('projNote').value = project?.note ?? '';

    const modal = $('projectModal');
    modal.classList.remove('hidden');

    setTimeout(() => $('projNo').focus(), 0);

    ['startDate', 'endDate'].forEach((inputId) => {
      const input = $(inputId);
      input.addEventListener(
        'click',
        (event) => {
          try {
            event.target.showPicker();
          } catch (error) {
            // Ignore lack of support
          }
        },
        { once: true },
      );
    });
  }

  function closeProjectModal() {
    $('projectModal').classList.add('hidden');
  }

  function saveProjectFromModal() {
    const projectNo = $('projNo').value.trim();
    const taskNo = $('taskNo').value.trim();
    const name = $('projName').value.trim();
    const startDate = $('startDate').value;
    const endDate = $('endDate').value;
    const status = $('statusSel').value;
    const note = $('projNote').value.trim();
    const editingId = $('editingProjectId').value;

    if (!projectNo) {
      alert('Project Number is required.');
      return;
    }

    if (!name) {
      alert('Project Name is required.');
      return;
    }

    if (!startDate) {
      alert('Start Date is required.');
      return;
    }

    if (editingId) {
      const project = state.projects.find((item) => item.id === editingId);
      if (!project) return;
      Object.assign(project, { projectNo, taskNo, name, startDate, endDate, status, note });
    } else {
      state.projects.push({
        id: uid(),
        projectNo,
        taskNo,
        name,
        startDate,
        endDate,
        status,
        note,
        archived: false,
      });
    }

    schedulePersist();
    closeProjectModal();
    render();
  }

  function populateSessionProjectOptions(selectedId) {
    const select = $('sessionProject');
    if (!select) return;
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select project...';
    select.appendChild(placeholder);

    state.projects.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      const baseName = project.name ? project.name : '(Unnamed Project)';
      option.textContent = project.archived ? `${baseName} (Archived)` : baseName;
      select.appendChild(option);
    });

    if (selectedId) {
      const exists = Array.from(select.options).some((option) => option.value === selectedId);
      if (!exists) {
        const fallback = document.createElement('option');
        fallback.value = selectedId;
        fallback.textContent = 'Unknown Project';
        select.appendChild(fallback);
      }
      select.value = selectedId;
    } else {
      select.value = '';
    }
  }

  function updateSessionDurationDisplay() {
    const durationEl = $('sessionDuration');
    if (!durationEl) return;

    const startValue = $('sessionStart')?.value;
    const endValue = $('sessionEnd')?.value;

    if (!startValue || !endValue) {
      durationEl.textContent = '—';
      return;
    }

    const start = parseDateTimeLocal(startValue);
    const end = parseDateTimeLocal(endValue);

    if (start === null || end === null) {
      durationEl.textContent = '—';
      return;
    }

    const diff = end - start;
    if (diff <= 0) {
      durationEl.textContent = 'End must be after start';
      return;
    }

    durationEl.textContent = formatHM(Math.round(diff / 1000));
  }

  function openSessionModal(id) {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;

    editingSessionId = id;
    populateSessionProjectOptions(session.projectId);

    $('sessionStart').value = toLocalDateTimeInputValue(session.start);
    $('sessionEnd').value = toLocalDateTimeInputValue(session.end);
    $('sessionNote').value = session.note ?? '';
    $('editingSessionId').value = session.id;
    $('sessionModalTitle').textContent = 'Edit Session';

    updateSessionDurationDisplay();

    const modal = $('sessionModal');
    modal.classList.remove('hidden');

    setTimeout(() => $('sessionStart').focus(), 0);
  }

  function closeSessionModal() {
    editingSessionId = null;
    const modal = $('sessionModal');
    if (modal) modal.classList.add('hidden');
    const hiddenId = $('editingSessionId');
    if (hiddenId) hiddenId.value = '';
    const durationEl = $('sessionDuration');
    if (durationEl) durationEl.textContent = '—';
  }

  function saveSessionFromModal() {
    if (!editingSessionId) return;

    const session = state.sessions.find((item) => item.id === editingSessionId);
    if (!session) return;

    const projectId = $('sessionProject').value;
    if (!projectId) {
      alert('Select a project for this session.');
      return;
    }

    const startValue = $('sessionStart').value;
    const endValue = $('sessionEnd').value;
    const start = parseDateTimeLocal(startValue);
    const end = parseDateTimeLocal(endValue);

    if (start === null) {
      alert('Provide a valid start date and time.');
      return;
    }
    if (end === null) {
      alert('Provide a valid end date and time.');
      return;
    }
    if (end <= start) {
      alert('End time must be after the start time.');
      return;
    }

    const note = $('sessionNote').value.trim();
    const seconds = Math.max(1, Math.round((end - start) / 1000));

    Object.assign(session, { projectId, start, end, seconds, note });

    schedulePersist();
    closeSessionModal();
    render();
  }

  function toggleArchive(id) {
    const project = state.projects.find((item) => item.id === id);
    if (!project) return;
    project.archived = !project.archived;
    schedulePersist();
    render();
  }

  function deleteProject(id) {
    const project = state.projects.find((item) => item.id === id);
    if (!project) return;
    const confirmed = confirm(
      `⚠️ This will permanently delete "${project.name}" and all related sessions.\n\nContinue?`,
    );
    if (!confirmed) return;

    state.projects = state.projects.filter((item) => item.id !== id);
    state.sessions = state.sessions.filter((session) => session.projectId !== id);
    schedulePersist();
    render();
  }

  function renderProjects(containerId, archived) {
    const wrapper = $(containerId);
    wrapper.innerHTML = '';

    state.projects
      .filter((project) => project.archived === archived)
      .forEach((project) => {
        const details = document.createElement('details');

        const summary = document.createElement('summary');
        summary.className = 'project-summary';

        const metaLeft = document.createElement('div');
        metaLeft.style.flex = '1';
        const projectName = project.name ? sanitize(project.name) : '(Unnamed Project)';
        const projectNo = project.projectNo ? `Project ${sanitize(project.projectNo)}` : 'No Project #';
        const taskNo = project.taskNo ? ` · Task ${sanitize(project.taskNo)}` : '';
        const status = sanitize(project.status || 'In Queue');
        metaLeft.innerHTML = `
          <div class="project-title">${projectName}</div>
          <div class="project-sub">
            ${projectNo}${taskNo} · ${status}
          </div>
        `;

        const actions = document.createElement('div');
        actions.className = 'project-actions';

        const editButton = document.createElement('button');
        editButton.className = 'btn-ghost';
        editButton.textContent = 'Edit';
        editButton.onclick = (event) => {
          event.stopPropagation();
          openProjectModal('edit', project.id);
        };

        const archiveButton = document.createElement('button');
        archiveButton.className = 'btn-ghost';
        archiveButton.textContent = archived ? 'Unarchive' : 'Archive';
        archiveButton.onclick = (event) => {
          event.stopPropagation();
          toggleArchive(project.id);
        };

        actions.append(editButton, archiveButton);

        if (archived) {
          const deleteButton = document.createElement('button');
          deleteButton.className = 'btn-ghost';
          deleteButton.textContent = 'Delete';
          deleteButton.onclick = (event) => {
            event.stopPropagation();
            deleteProject(project.id);
          };
          actions.append(deleteButton);
        }

        summary.append(metaLeft, actions);

        const expanded = document.createElement('div');
        const notes = document.createElement('div');
        notes.className = 'project-notes';
        notes.innerHTML = project.note?.trim() ? sanitize(project.note) : '<i>No notes</i>';
        expanded.appendChild(notes);

        if (archived) {
          expanded.appendChild(buildArchivedSessions(project.id));
        }

        details.append(summary, expanded);
        wrapper.appendChild(details);
      });
  }

  function sanitize(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return char;
      }
    });
  }

  function createSessionRow(session, { includeProjectName = false } = {}) {
    const row = document.createElement('div');
    row.className = 'entry-row';

    const text = document.createElement('div');
    text.className = 'entry-text';
    const project = state.projects.find((item) => item.id === session.projectId);
    const projectName = project ? project.name || '(Unnamed Project)' : 'Unknown Project';
    const notePart = session.note ? ` — <i>${sanitize(session.note)}</i>` : '';
    const base = `• ${fmtDT(session.start)} — ${formatHM(session.seconds)}`;
    text.innerHTML = `${includeProjectName ? `${sanitize(projectName)} ${base}` : base}${notePart}`;

    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const editButton = document.createElement('button');
    editButton.className = 'btn-ghost';
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.onclick = () => openSessionModal(session.id);
    actions.appendChild(editButton);

    row.append(text, actions);
    return row;
  }

  function buildArchivedSessions(projectId) {
    const wrapper = document.createElement('div');
    wrapper.className = 'sessions-wrap';

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Sessions';
    details.appendChild(summary);

    const sessions = state.sessions.filter((session) => session.projectId === projectId);
    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'session-line';
      empty.innerHTML = '<i>No recorded sessions</i>';
      details.appendChild(empty);
    } else {
      sessions.forEach((session) => {
        const row = createSessionRow(session);
        details.appendChild(row);
      });
    }

    wrapper.appendChild(details);
    return wrapper;
  }

  function startTimer() {
    const projectId = $('projectSelect').value;
    if (!projectId) {
      alert('Select project');
      return;
    }
    if (state.activeTimer) {
      alert('Timer running');
      return;
    }

    state.activeTimer = { projectId, start: Date.now() };
    schedulePersist();
    hideNoteBar();

    if (activeTick) clearInterval(activeTick);
    updateTimerDisplay();
    activeTick = setInterval(updateTimerDisplay, 200);
  }

  function stopTimer() {
    if (!state.activeTimer) {
      alert('No active timer');
      return;
    }

    const { projectId, start } = state.activeTimer;
    const now = Date.now();
    const seconds = Math.max(1, Math.round((now - start) / 1000));

    const session = {
      id: uid(),
      projectId,
      start,
      end: now,
      seconds,
      note: '',
      source: 'timer',
    };

    state.sessions.push(session);
    pendingNoteId = session.id;

    clearInterval(activeTick);
    activeTick = null;
    state.activeTimer = null;

    schedulePersist();
    render();
    showNoteBar();
  }

  function resumeActiveTimer() {
    if (!state.activeTimer) return;
    $('projectSelect').value = state.activeTimer.projectId;
    hideNoteBar();
    if (activeTick) clearInterval(activeTick);
    updateTimerDisplay();
    activeTick = setInterval(updateTimerDisplay, 200);
  }

  function updateTimerDisplay() {
    if (!state.activeTimer) return;
    const seconds = (Date.now() - state.activeTimer.start) / 1000;
    $('timeDisplay').textContent = new Date(seconds * 1000).toISOString().substr(11, 8);
  }

  function showNoteBar() {
    const bar = $('noteBar');
    const input = $('noteInput');
    bar.style.display = 'block';
    input.value = '';
    input.focus();
  }

  function hideNoteBar() {
    $('noteBar').style.display = 'none';
  }

  function savePendingNote() {
    if (!pendingNoteId) return;
    const session = state.sessions.find((item) => item.id === pendingNoteId);
    if (session) {
      session.note = $('noteInput').value.trim();
      schedulePersist();
      render();
    }
    pendingNoteId = null;
    hideNoteBar();
  }

  function cancelPendingNote() {
    pendingNoteId = null;
    hideNoteBar();
  }

  function currentRange() {
    if (view === 'daily') {
      const start = new Date(anchor);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return [start, end];
    }

    if (view === 'weekly') {
      const start = startOfWeek(anchor);
      return [start, endOfWeek(anchor)];
    }

    return [new Date(0), new Date(8640000000000000)];
  }

  function renderTotals() {
    const [start, end] = currentRange();
    const rangeLabel = $('rangeLabel');

    if (view === 'daily') {
      rangeLabel.textContent = start.toLocaleDateString();
    } else if (view === 'weekly') {
      rangeLabel.textContent = `${start.toLocaleDateString()} – ${new Date(end - 1).toLocaleDateString()}`;
    } else {
      rangeLabel.textContent = 'All-Time';
    }

    const tbody = $('totalsBody');
    tbody.innerHTML = '';

    state.projects
      .filter((project) => !project.archived)
      .forEach((project) => {
        const sessions = state.sessions.filter((session) => {
          const startDate = new Date(session.start);
          return startDate >= start && startDate < end && session.projectId === project.id;
        });
        const seconds = sessions.reduce((total, session) => total + session.seconds, 0);

        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = project.name;
        const entriesCell = document.createElement('td');
        entriesCell.textContent = sessions.length.toString();
        const totalCell = document.createElement('td');
        totalCell.textContent = formatHM(seconds);

        row.append(nameCell, entriesCell, totalCell);
        tbody.appendChild(row);
      });
  }

  function renderEntries(containerId, archivedFlag) {
    const wrapper = $(containerId);
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const relevantProjects = state.projects.filter((project) => project.archived === archivedFlag);
    if (relevantProjects.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = archivedFlag
        ? 'No archived projects yet.'
        : 'Create a project to start tracking time.';
      wrapper.appendChild(empty);
      return;
    }

    relevantProjects.forEach((project) => {
      const entries = state.sessions.filter((session) => session.projectId === project.id);
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${project.name} (${entries.length})`;
      details.appendChild(summary);

      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'project-notes';
        empty.innerHTML = '<i>No recorded sessions</i>';
        details.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.className = 'project-notes';
        entries.forEach((entry) => {
          const row = createSessionRow(entry);
          list.appendChild(row);
        });
        details.appendChild(list);
      }

      wrapper.appendChild(details);
    });
  }

  function render() {
    renderProjects('projectList', false);
    renderProjects('archivedProjects', true);

    const select = $('projectSelect');
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select project...';
    select.appendChild(placeholder);

    state.projects
      .filter((project) => !project.archived)
      .forEach((project) => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        select.appendChild(option);
      });

    if (state.activeTimer) {
      const option = Array.from(select.options).find(
        (item) => item.value === state.activeTimer.projectId,
      );
      if (option) {
        select.value = option.value;
      }
    }

    renderTotals();
    renderEntries('activeEntries', false);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const anchorEl = document.createElement('a');
    anchorEl.href = URL.createObjectURL(blob);
    anchorEl.download = 'time-tracker.json';
    anchorEl.click();
  }

  function exportCsv() {
    const rows = [['Project', 'Start', 'End', 'Seconds', 'Note', 'Source']];
    state.sessions.forEach((session) => {
      const project = state.projects.find((item) => item.id === session.projectId);
      rows.push([
        project ? project.name : 'Unknown',
        fmtDT(session.start),
        fmtDT(session.end),
        session.seconds,
        session.note || '',
        session.source || '',
      ]);
    });

    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const anchorEl = document.createElement('a');
    anchorEl.href = URL.createObjectURL(blob);
    anchorEl.download = 'time-tracker.csv';
    anchorEl.click();
  }

  function triggerImport() {
    $('importFile').click();
  }

  function handleImport(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        Object.assign(state, {
          projects: Array.isArray(imported.projects) ? imported.projects : [],
          sessions: Array.isArray(imported.sessions) ? imported.sessions : [],
          activeTimer: imported.activeTimer ?? null,
        });
        schedulePersist();
        render();
      } catch (error) {
        alert('Invalid JSON');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  function clearAll() {
    const confirmed = confirm('Clear all data?');
    if (!confirmed) return;
    localStorage.removeItem(storageKey);
    location.reload();
  }

  function registerTabs() {
    $('tabDaily').onclick = () => {
      view = 'daily';
      anchor = today();
      renderTotals();
    };

    $('tabWeekly').onclick = () => {
      view = 'weekly';
      anchor = today();
      renderTotals();
    };

    $('tabAll').onclick = () => {
      view = 'all';
      renderTotals();
    };

    $('prevRange').onclick = () => {
      if (view === 'daily') {
        anchor.setDate(anchor.getDate() - 1);
      } else if (view === 'weekly') {
        anchor.setDate(anchor.getDate() - 7);
      }
      renderTotals();
    };

    $('nextRange').onclick = () => {
      if (view === 'daily') {
        anchor.setDate(anchor.getDate() + 1);
      } else if (view === 'weekly') {
        anchor.setDate(anchor.getDate() + 7);
      }
      renderTotals();
    };

    $('tabActiveProjects').onclick = () => {
      $('activeSection').classList.remove('hidden');
      $('archivedSection').classList.add('hidden');
      $('tabActiveProjects').setAttribute('aria-selected', true);
      $('tabArchivedProjects').setAttribute('aria-selected', false);
    };

    $('tabArchivedProjects').onclick = () => {
      $('archivedSection').classList.remove('hidden');
      $('activeSection').classList.add('hidden');
      $('tabArchivedProjects').setAttribute('aria-selected', true);
      $('tabActiveProjects').setAttribute('aria-selected', false);
    };
  }

  function registerEvents() {
    registerTabs();

    $('openProjectModal').onclick = () => openProjectModal('add');
    $('closeProject').onclick = closeProjectModal;
    $('projectModal').onclick = (event) => {
      if (event.target.id === 'projectModal') closeProjectModal();
    };
    $('saveProject').onclick = saveProjectFromModal;

    $('closeSessionModal').onclick = closeSessionModal;
    $('sessionModal').onclick = (event) => {
      if (event.target.id === 'sessionModal') closeSessionModal();
    };
    $('saveSession').onclick = saveSessionFromModal;
    $('sessionStart').addEventListener('input', updateSessionDurationDisplay);
    $('sessionEnd').addEventListener('input', updateSessionDurationDisplay);

    $('startBtn').onclick = startTimer;
    $('stopBtn').onclick = stopTimer;

    $('saveNoteBtn').onclick = savePendingNote;
    $('cancelNoteBtn').onclick = cancelPendingNote;

    $('btnExport').onclick = exportJson;
    $('btnCsv').onclick = exportCsv;
    $('btnImport').onclick = triggerImport;
    $('importFile').onchange = handleImport;
    $('btnClear').onclick = clearAll;
  }

  document.addEventListener('DOMContentLoaded', () => {
    registerEvents();
    render();

    if (state.activeTimer) {
      resumeActiveTimer();
    }
  });
})();
