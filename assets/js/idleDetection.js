(() => {
  const STORAGE_KEY = 'tt_idle_tracker_v1';
  const DEFAULT_STATE = {
    lockStart: null,
    lockMeta: null,
    pendingAway: null,
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      const parsed = JSON.parse(raw);
      return {
        lockStart: typeof parsed.lockStart === 'number' ? parsed.lockStart : null,
        lockMeta: parsed.lockMeta && typeof parsed.lockMeta === 'object' ? parsed.lockMeta : null,
        pendingAway:
          parsed.pendingAway && typeof parsed.pendingAway === 'object'
            ? {
                lockStart: typeof parsed.pendingAway.lockStart === 'number' ? parsed.pendingAway.lockStart : null,
                unlockTime: typeof parsed.pendingAway.unlockTime === 'number' ? parsed.pendingAway.unlockTime : null,
                durationMs: typeof parsed.pendingAway.durationMs === 'number' ? parsed.pendingAway.durationMs : null,
                projectSuggestion:
                  typeof parsed.pendingAway.projectSuggestion === 'string'
                    ? parsed.pendingAway.projectSuggestion
                    : null,
              }
            : null,
      };
    } catch (error) {
      console.warn('[IdleDetection] Failed to parse stored idle state.', error);
      return { ...DEFAULT_STATE };
    }
  }

  function persistState(state) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          lockStart: state.lockStart,
          lockMeta: state.lockMeta,
          pendingAway: state.pendingAway,
        }),
      );
    } catch (error) {
      console.warn('[IdleDetection] Failed to persist idle state.', error);
    }
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pieces = [];

    if (hours > 0) pieces.push(`${hours}h`);
    if (minutes > 0 || hours > 0) pieces.push(`${minutes}m`);
    pieces.push(`${seconds}s`);

    return pieces.join(' ');
  }

  function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }

  function isSupported() {
    return typeof window !== 'undefined' && 'IdleDetector' in window;
  }

  class IdleLockManager {
    constructor(options = {}) {
      this.options = options;
      this.threshold = options.threshold ?? 60000;
      this.awayThreshold = options.awayThreshold ?? 60000;
      this.state = loadState();
      this.detector = null;
      this.abortController = null;
      this.permissionStatus = 'unknown';

      this.modal = null;
      this.summaryEl = null;
      this.detailEl = null;
      this.baseActions = null;
      this.allocateSection = null;
      this.allocateSelect = null;
      this.allocateNote = null;
      this.allocateBack = null;
      this.allocateConfirm = null;
      this.createSection = null;
      this.createNameInput = null;
      this.createNoteInput = null;
      this.createBack = null;
      this.createConfirm = null;
      this.discardBtn = null;
      this.allocateBtn = null;
      this.createBtn = null;
      this.permissionNotice = null;
      this.permissionButton = null;
    }

    init() {
      if (!isSupported()) {
        console.info('[IdleDetection] IdleDetector API is not available in this browser.');
        this.cacheDom();
        this.updatePermissionNotice('unsupported');
        return;
      }

      this.cacheDom();
      this.bindUi();
      this.restorePendingAway();
      this.startDetector();
    }

    cacheDom() {
      this.modal = document.getElementById('idleModal');
      this.summaryEl = document.getElementById('idleSummary');
      this.detailEl = document.getElementById('idleDetail');
      this.baseActions = document.getElementById('idleBaseActions');
      this.allocateSection = document.getElementById('idleAllocateSection');
      this.allocateSelect = document.getElementById('idleProjectSelect');
      this.allocateNote = document.getElementById('idleEntryNote');
      this.allocateBack = document.getElementById('idleAllocateBack');
      this.allocateConfirm = document.getElementById('idleAllocateConfirm');
      this.createSection = document.getElementById('idleCreateSection');
      this.createNameInput = document.getElementById('idleNewProjectName');
      this.createNoteInput = document.getElementById('idleNewProjectNote');
      this.createBack = document.getElementById('idleCreateBack');
      this.createConfirm = document.getElementById('idleCreateConfirm');
      this.discardBtn = document.getElementById('idleDiscard');
      this.allocateBtn = document.getElementById('idleAllocate');
      this.createBtn = document.getElementById('idleCreate');
      this.permissionNotice = document.getElementById('idlePermissionNotice');
      this.permissionButton = document.getElementById('idlePermissionButton');
    }

    bindUi() {
      if (this.discardBtn) {
        this.discardBtn.addEventListener('click', () => this.handleDiscard());
      }
      if (this.allocateBtn) {
        this.allocateBtn.addEventListener('click', () => this.showAllocateSection());
      }
      if (this.allocateBack) {
        this.allocateBack.addEventListener('click', () => this.showBaseActions());
      }
      if (this.allocateConfirm) {
        this.allocateConfirm.addEventListener('click', () => this.handleAllocate());
      }
      if (this.createBtn) {
        this.createBtn.addEventListener('click', () => this.showCreateSection());
      }
      if (this.createBack) {
        this.createBack.addEventListener('click', () => this.showBaseActions());
      }
      if (this.createConfirm) {
        this.createConfirm.addEventListener('click', () => this.handleCreateProject());
      }
      if (this.permissionButton) {
        this.permissionButton.addEventListener('click', () => this.requestPermission());
      }
    }

    restorePendingAway() {
      const now = Date.now();
      if (this.state.lockStart && (!this.state.pendingAway || !this.state.pendingAway.lockStart)) {
        const duration = now - this.state.lockStart;
        if (duration >= this.awayThreshold) {
          this.state.pendingAway = {
            lockStart: this.state.lockStart,
            unlockTime: now,
            durationMs: duration,
            projectSuggestion: this.state.lockMeta?.projectId ?? null,
          };
        }
        this.state.lockStart = null;
        this.state.lockMeta = null;
        persistState(this.state);
      }

      if (this.state.pendingAway && this.state.pendingAway.lockStart && this.state.pendingAway.unlockTime) {
        this.showAwayModal(this.state.pendingAway);
      }
    }

    async startDetector() {
      try {
        this.abortController?.abort();
        this.abortController = new AbortController();
        this.detector = new IdleDetector();
        this.detector.addEventListener('change', () => this.handleChange());
        await this.detector.start({ threshold: this.threshold, signal: this.abortController.signal });
        this.permissionStatus = 'granted';
        this.updatePermissionNotice('granted');
        console.log('[IdleDetection] IdleDetector started with threshold', this.threshold);
      } catch (error) {
        this.permissionStatus = error?.name === 'NotAllowedError' ? 'denied' : 'error';
        this.updatePermissionNotice(this.permissionStatus);
        console.warn('[IdleDetection] Unable to start idle detection.', error);
      }
    }

    async requestPermission() {
      if (!isSupported()) return;
      try {
        const result = await IdleDetector.requestPermission();
        this.permissionStatus = result;
        if (result === 'granted') {
          await this.startDetector();
        } else {
          this.updatePermissionNotice(result);
          console.info('[IdleDetection] Permission result:', result);
        }
      } catch (error) {
        console.warn('[IdleDetection] Failed to request permission.', error);
        this.updatePermissionNotice('error');
      }
    }

    updatePermissionNotice(status) {
      if (!this.permissionNotice) return;
      if (status === 'granted') {
        this.permissionNotice.classList.add('hidden');
        return;
      }

      let message = '';
      if (status === 'unsupported') {
        message = 'Idle detection is not supported in this browser.';
      } else if (status === 'denied') {
        message =
          'Idle detection is disabled. Enable it to automatically pause the timer when the screen locks.';
      } else if (status === 'prompt' || status === 'unknown') {
        message = 'Idle detection permission is needed to pause the timer when your screen locks.';
      } else {
        message = 'Idle detection is currently unavailable.';
      }

      const messageEl = this.permissionNotice.querySelector('[data-idle-permission-message]');
      if (messageEl) {
        messageEl.textContent = message;
      }
      if (status === 'unsupported') {
        this.permissionNotice.classList.add('is-disabled');
        if (this.permissionButton) {
          this.permissionButton.disabled = true;
        }
      } else {
        this.permissionNotice.classList.remove('is-disabled');
        if (this.permissionButton) {
          this.permissionButton.disabled = false;
        }
      }
      this.permissionNotice.classList.remove('hidden');
    }

    handleChange() {
      if (!this.detector) return;
      const { screenState, userState } = this.detector;
      console.log('[IdleDetection] change event', { screenState, userState });

      if (screenState === 'locked') {
        this.handleLocked();
      } else if (screenState === 'unlocked') {
        this.handleUnlocked();
      }
    }

    handleLocked() {
      if (this.state.lockStart) return;
      const now = Date.now();
      console.log('[IdleDetection] Screen locked at', formatDateTime(now));
      this.state.lockStart = now;
      const meta = typeof this.options.onLock === 'function' ? this.options.onLock() : null;
      if (meta && typeof meta === 'object') {
        this.state.lockMeta = meta;
      } else {
        this.state.lockMeta = null;
      }
      persistState(this.state);
    }

    handleUnlocked() {
      if (!this.state.lockStart) {
        console.log('[IdleDetection] Screen unlocked without recorded lock start.');
        return;
      }

      const unlockTime = Date.now();
      const duration = unlockTime - this.state.lockStart;
      console.log('[IdleDetection] Screen unlocked at', formatDateTime(unlockTime), 'duration', duration);

      const meta = this.state.lockMeta;
      this.state.lockStart = null;
      this.state.lockMeta = null;
      persistState(this.state);

      if (duration < this.awayThreshold) {
        console.log('[IdleDetection] Away duration below threshold, ignoring.');
        if (typeof this.options.onShortAway === 'function') {
          this.options.onShortAway({ unlockTime, duration, meta });
        }
        return;
      }

      this.state.pendingAway = {
        lockStart: unlockTime - duration,
        unlockTime,
        durationMs: duration,
        projectSuggestion: meta?.projectId ?? null,
      };
      persistState(this.state);
      this.showAwayModal(this.state.pendingAway);
    }

    showAwayModal(pending) {
      if (!this.modal || !pending) return;
      this.populateSummary(pending);
      this.populateProjectOptions(pending.projectSuggestion ?? null);
      this.showBaseActions();
      this.modal.classList.remove('hidden');
      this.modal.setAttribute('aria-hidden', 'false');
      if (this.discardBtn) {
        this.discardBtn.focus();
      }
    }

    populateSummary(pending) {
      if (!this.summaryEl) return;
      const duration = formatDuration(pending.durationMs ?? 0);
      this.summaryEl.textContent = `Away for ${duration}`;
      if (this.detailEl) {
        if (pending.lockStart && pending.unlockTime) {
          this.detailEl.textContent = `From ${formatDateTime(pending.lockStart)} to ${formatDateTime(
            pending.unlockTime,
          )}`;
        } else {
          this.detailEl.textContent = '';
        }
      }
    }

    populateProjectOptions(selectedId = null) {
      if (!this.allocateSelect) return;
      const projects = typeof this.options.listProjects === 'function' ? this.options.listProjects() : [];
      this.allocateSelect.innerHTML = '';

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select project...';
      this.allocateSelect.appendChild(placeholder);

      projects.forEach((project) => {
        const option = document.createElement('option');
        option.value = project.id;
        const name = project.name || 'Untitled Project';
        option.textContent = project.archived ? `${name} (Archived)` : name;
        this.allocateSelect.appendChild(option);
      });

      if (selectedId) {
        const match = Array.from(this.allocateSelect.options).find((option) => option.value === selectedId);
        if (match) {
          this.allocateSelect.value = selectedId;
        }
      }
    }

    showBaseActions() {
      if (this.baseActions) this.baseActions.classList.remove('hidden');
      if (this.allocateSection) this.allocateSection.classList.add('hidden');
      if (this.createSection) this.createSection.classList.add('hidden');
    }

    showAllocateSection() {
      this.populateProjectOptions(this.state.pendingAway?.projectSuggestion ?? null);
      if (this.allocateNote) this.allocateNote.value = '';
      if (this.baseActions) this.baseActions.classList.add('hidden');
      if (this.allocateSection) {
        this.allocateSection.classList.remove('hidden');
        const focusTarget = this.allocateSelect || this.allocateSection.querySelector('button, select, input');
        if (focusTarget) focusTarget.focus();
      }
      if (this.createSection) this.createSection.classList.add('hidden');
    }

    showCreateSection() {
      if (this.createNameInput) this.createNameInput.value = '';
      if (this.createNoteInput) this.createNoteInput.value = '';
      if (this.baseActions) this.baseActions.classList.add('hidden');
      if (this.allocateSection) this.allocateSection.classList.add('hidden');
      if (this.createSection) {
        this.createSection.classList.remove('hidden');
        const focusTarget = this.createNameInput || this.createSection.querySelector('input, button');
        if (focusTarget) focusTarget.focus();
      }
    }

    handleDiscard() {
      if (!this.state.pendingAway) {
        this.closeModal();
        return;
      }
      console.log('[IdleDetection] Away duration discarded.');
      this.state.pendingAway = null;
      persistState(this.state);
      this.closeModal();
      if (typeof this.options.onDiscard === 'function') {
        this.options.onDiscard();
      }
    }

    handleAllocate() {
      if (!this.state.pendingAway) return;
      if (!this.allocateSelect) return;
      const projectId = this.allocateSelect.value;
      if (!projectId) {
        alert('Select a project to allocate this time.');
        return;
      }
      const note = this.allocateNote ? this.allocateNote.value.trim() : '';
      this.createSessionForPending(projectId, note);
    }

    handleCreateProject() {
      if (!this.state.pendingAway) return;
      if (!this.createNameInput) return;
      const name = this.createNameInput.value.trim();
      const note = this.createNoteInput ? this.createNoteInput.value.trim() : '';
      if (!name) {
        alert('Provide a project name to continue.');
        return;
      }

      if (typeof this.options.createProject !== 'function') {
        console.warn('[IdleDetection] No createProject callback provided.');
        return;
      }

      const project = this.options.createProject({ name, note });
      if (!project || !project.id) {
        console.warn('[IdleDetection] createProject callback did not return a project with an id.');
        return;
      }

      this.populateProjectOptions(project.id);
      this.createSessionForPending(project.id, '');
    }

    createSessionForPending(projectId, note) {
      if (!this.state.pendingAway) return;
      if (typeof this.options.createSession !== 'function') {
        console.warn('[IdleDetection] No createSession callback provided.');
        return;
      }

      const pending = this.state.pendingAway;
      const seconds = Math.max(1, Math.round((pending.unlockTime - pending.lockStart) / 1000));
      this.options.createSession({
        projectId,
        start: pending.lockStart,
        end: pending.unlockTime,
        seconds,
        note,
        source: 'idle-detection',
      });

      console.log('[IdleDetection] Away duration allocated to project', projectId);
      this.state.pendingAway = null;
      persistState(this.state);
      this.closeModal();
      if (typeof this.options.onAllocate === 'function') {
        this.options.onAllocate({ projectId });
      }
    }

    closeModal() {
      if (this.modal) {
        this.modal.classList.add('hidden');
        this.modal.setAttribute('aria-hidden', 'true');
      }
      this.showBaseActions();
    }
  }

  function createManager(options) {
    const manager = new IdleLockManager(options);
    manager.init();
    return manager;
  }

  window.TimeTrackerIdle = { createManager };
})();
