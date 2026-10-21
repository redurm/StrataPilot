'use strict';

/*
 * The Settings dialog (#12, step 4): the theme, the language, the model and the server
 * list, in one form. Moved out of app.js without touching a function body.

 * Loaded before app.js. Nothing here may run at load time - test/tree-split.test.js
 * refuses load-time statements in a moved file, and that rule applies here too.
 */

function applyTheme(theme) {
  const wanted = theme === 'light' || theme === 'dark' ? theme : 'system';
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const resolved = wanted === 'system' ? (media.matches ? 'light' : 'dark') : wanted;
  document.documentElement.dataset.theme = resolved;
  state.theme = resolved;
  state.themeMode = wanted;
  try {
    localStorage.setItem('stratapilot_theme', resolved); // read by theme-boot.js on the next start
  } catch {
    // the mirror is a nicety: without it the app simply starts dark and corrects itself
  }
}

/**
 * Everything that used to need a hand edit of
 * `%APPDATA%\StrataPilot\stratapilot_settings.json`. The keys are the same ones the app
 * already reads (cwd / serialQueue / strataUrl / monitorOpen / monitorWidth / sidebarHidden),
 * plus `restoreTabs`, which the app now honours as well.
 *
 * The dialog is deliberately a plain form over `app:settings-set`: no new settings store, so a
 * hand-edited file keeps working and the README's table stays the reference.
 */
function openSettingsModal() {
  return new Promise((resolve) => {
    const s = state.settings || {};
    const backdrop = el('div', 'modal-backdrop settings-backdrop');
    const modal = el('div', 'modal settings-modal');
    modal.appendChild(el('h3', '', tr('Settings')));

    const controls = [];
    const group = (title) => modal.appendChild(el('div', 'set-group', title));
    const textRow = (key, label, hint, options = {}) => {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', '', label));
      const row = el('div', 'field-row');
      const box = el('input');
      box.type = options.number ? 'number' : 'text';
      if (options.number) {
        box.min = String(options.min);
        box.max = String(options.max);
        box.step = '10';
      }
      box.value = s[key] == null ? '' : String(s[key]);
      box.placeholder = options.placeholder || '';
      box.dataset.setting = key;
      row.appendChild(box);
      if (options.folderPicker) {
        const browse = el('button', '', tr('Browse…'));
        browse.addEventListener('click', async () => {
          const picked = await api.chooseFolder();
          if (picked.ok) box.value = picked.path;
        });
        row.appendChild(browse);
      }
      if (options.filePicker) {
        const browse = el('button', '', tr('Browse…'));
        browse.addEventListener('click', async () => {
          const picked = await api.chooseFile({ title: options.fileTitle || 'Choose a file', filters: options.filters });
          if (picked.ok) box.value = picked.path;
        });
        row.appendChild(browse);
      }
      if (options.clear) {
        const clear = el('button', 'ghost', tr('clear'));
        clear.title = tr('remove this key from the settings file');
        clear.addEventListener('click', () => {
          box.value = '';
        });
        row.appendChild(clear);
      }
      wrap.appendChild(row);
      if (hint) wrap.appendChild(el('div', 'set-hint', hint));
      modal.appendChild(wrap);
      controls.push({ key, box, kind: options.number ? 'number' : 'text', emptyMeansUnset: !!options.clear, min: options.min, max: options.max });
    };
    const checkRow = (key, label, hint, options = {}) => {
      const wrap = el('div', 'field');
      const row = el('div', 'field-row set-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = options.defaultTrue ? s[key] !== false : !!s[key];
      box.dataset.setting = key;
      row.appendChild(box);
      row.appendChild(el('label', '', label));
      wrap.appendChild(row);
      if (hint) wrap.appendChild(el('div', 'set-hint', hint));
      modal.appendChild(wrap);
      controls.push({ key, box, kind: 'checkbox', defaultTrue: !!options.defaultTrue });
    };
    const selectRow = (key, label, options, hint, defaults) => {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', '', label));
      const box = document.createElement('select');
      box.dataset.setting = key;
      for (const option of options) {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        const current = s[key] == null ? (defaults && defaults[key]) : s[key];
        if (String(current) === String(option.value)) opt.selected = true;
        box.appendChild(opt);
      }
      wrap.appendChild(box);
      if (hint) wrap.appendChild(el('div', 'set-hint', hint));
      modal.appendChild(wrap);
      controls.push({ key, box, kind: 'select' });
    };
    // D6: a list setting (one entry per line) - the extra Strata servers to watch
    const listRow = (key, label, hint, options = {}) => {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', '', label));
      const box = el('textarea');
      box.dataset.setting = key;
      box.rows = 3;
      box.value = (Array.isArray(s[key]) ? s[key] : []).join(String.fromCharCode(10));
      box.placeholder = options.placeholder || '';
      wrap.appendChild(box);
      if (hint) wrap.appendChild(el('div', 'set-hint', hint));
      modal.appendChild(wrap);
      controls.push({ key, box, kind: 'list' });
    };

    group(tr('Sessions and queue'));
    textRow('cwd', tr('Default working folder for new tabs'), tr('used when a session file records a folder that no longer exists, and for every new tab'), { folderPicker: true });
    checkRow('serialQueue', tr('Serial queue: run one session at a time (Strata is single-flight)'), tr('off = all tabs may call the model at the same time'), { defaultTrue: true });
    checkRow('restoreTabs', tr('Reopen the tabs from the previous run (up to 4)'), tr('off = always start with a single new tab'), { defaultTrue: true });

    group(tr('Scheduled prompts'));
    const jobsRow = el('div', 'field-row');
    const jobsButton = el('button', '', tr('Manage scheduled jobs\u2026'));
    jobsButton.addEventListener('click', async () => {
      finish(false);
      await openJobsModal();
    });
    jobsRow.appendChild(jobsButton);
    jobsRow.appendChild(el('span', 'set-hint', tr('cron runs in the background process; a due prompt is queued into a session, never sent behind the queue\u2019s back')));
    modal.appendChild(jobsRow);

    group(tr('Strata server'));
    textRow('strataUrl', tr('Fixed Strata address (Monitor and diagnostics)'), tr('leave empty to derive it from the active tab model baseUrl, e.g. http://127.0.0.1:8081/v1'), { placeholder: 'http://127.0.0.1:8081/v1', clear: true });
    textRow('strataConfigPath', tr('Strata engine config (only for the diagnostics report)'), tr('e.g. C:\\Strata\\strata-src\\strata-<model>.json \u2014 copied into the report with keys redacted'), { filePicker: true, fileTitle: tr('Strata engine config'), filters: [{ name: 'JSON', extensions: ['json'] }], clear: true });
    listRow('strataUrls', tr('Other Strata servers to watch (one address per line)'), tr('D6: the Monitor gets a button per address, so two servers on two ports can be compared; the first entry is still the one the cards show unless you pick another)'), { placeholder: 'http://127.0.0.1:8082/v1' });

    group(tr('Interface'))
    ;
    checkRow('monitorOpen', tr('Open the Strata Monitor at startup'), '', { defaultTrue: true });
    textRow('monitorWidth', tr('Monitor panel width (px)'), tr('340 \u2013 900; you can also drag the divider in the Monitor'), { number: true, min: 340, max: 900 });
    checkRow('sidebarHidden', tr('Start with the sidebar hidden'), '');
    selectRow('theme', tr('Theme'), [
      { value: 'dark', label: tr('Dark (default)') },
      { value: 'light', label: tr('Light') },
      { value: 'system', label: tr('Follow the system theme') },
    ], tr('applies as soon as you save; only the colours change, nothing is written anywhere else'), { theme: 'dark' });
    // D10: the language names are written in their own script on purpose - that is the one row that
    // works even when the rest of the dialog is in a language the user cannot read
    selectRow('language', tr('Language'), [
      { value: 'auto', label: `${tr('Auto (follow the system)')} (${i18nInfo.systemLocale})` },
      { value: 'en', label: 'English' },
      { value: 'zh-TW', label: '繁體中文' },
      { value: 'zh-CN', label: '简体中文' },
    ], tr('the app\u2019s own words (menus, buttons, dialogs, chips) follow this right away; pi answers in the language you prompt it in, and the log file and the diagnostics report stay English'), { language: 'auto' });

    group(tr('Files'))
    ;
    const paths = el('div', 'set-paths');
    const pathRow = (label, target) => {
      const row = el('div', 'set-path-row');
      row.appendChild(el('span', 'set-path-label', label));
      const value = el('button', 'ghost set-path-value', target || tr('(not available)'));
      value.disabled = !target;
      value.title = target ? tr('open {path}', { path: target }) : '';
      value.addEventListener('click', () => api.openPath(target, false));
      row.appendChild(value);
      paths.appendChild(row);
    };
    pathRow(tr('settings file'), state.info && state.info.settingsPath);
    pathRow(tr('log file'), state.info && state.info.logPath);
    pathRow(tr('sessions folder'), state.info && state.info.sessionsRoot);
    modal.appendChild(paths);
    modal.appendChild(
      el(
        'div',
        'set-hint',
        tr('Deleting the settings file resets everything (open tabs, window size, Monitor state). pi model settings live in ~/.pi/agent/settings.json and are not touched here.'),
      ),
    );

    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'ghost', tr('Cancel'));
    const ok = el('button', 'primary', tr('Save'));
    actions.appendChild(cancel);
    actions.appendChild(ok);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let done = false;
    const finish = (saved) => {
      if (done) return;
      done = true;
      backdrop.remove();
      modalOpen = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(saved);
    };
    modalOpen = { finish, backdrop };

    const collect = () => {
      const patch = {};
      for (const control of controls) {
        if (control.kind === 'list') {
          patch[control.key] = [...new Set(control.box.value.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean))];
        } else if (control.kind === 'checkbox') {
          // write only real changes for the default-true keys, so the file stays close to its old shape
          patch[control.key] = control.box.checked;
        } else if (control.kind === 'number') {
          const value = Number(control.box.value);
          if (!Number.isFinite(value)) continue;
          patch[control.key] = Math.min(Math.max(value, control.min), control.max);
        } else {
          const value = control.box.value.trim();
          if (!value && control.emptyMeansUnset) patch[control.key] = '';
          else if (value) patch[control.key] = value;
        }
      }
      return patch;
    };

    const submit = async () => {
      const patch = collect();
      const merged = await api.settingsSet(patch);
      state.settings = merged || patch;
      applySettings(state.settings);
      // D10: the language is switched before the confirmation, so the toast the user reads after
      // pressing Save is already in the language they just picked
      await setLanguage(merged.language || 'auto');
      toast(tr('settings saved'), 'info', 3000);
      finish(true);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === 'Enter' && event.target && event.target.tagName !== 'TEXTAREA') {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    };
    document.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => finish(false));
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish(false);
    });
    setTimeout(() => {
      const first = modal.querySelector('input');
      if (first) first.focus();
    }, 30);
  });
}

/**
 * Push the saved settings into the live UI. Called after the dialog saves and after a manual
 * edit of the file plus a reload, so "edit the JSON by hand" keeps working too.
 */
function applySettings(settings) {
  state.settings = settings || state.settings || {};
  const s = state.settings;
  applyTheme(s.theme);
  if (s.cwd && s.cwd !== state.cwd) state.cwd = s.cwd;
  scheduler.enabled = s.serialQueue !== false;
  els.serialToggle.checked = scheduler.enabled;
  els.body.classList.toggle('sidebar-hidden', !!s.sidebarHidden);
  applyMonitorWidth();
  if (els.monitorView.classList.contains('hidden') && s.monitorOpen !== false) openMonitor();
  if (s.monitorOpen === false && !els.monitorView.classList.contains('hidden')) closeMonitor();
  if (scheduler.enabled) scheduler.pumpSoon(0);
  // D10: the Settings dialog saves through here, so a language change arrives this way too - including
  // when the file was edited by hand and the app was reloaded
  const pref = s.language || 'auto';
  if (pref !== i18nInfo.pref) setLanguage(pref).catch((err) => console.error('[i18n] language change failed', err));
  renderOpenSessions();
}

/* ------------------------------------------------------------------ */
/* strata server monitor (ported from strata-src serve/web/app.js)     */
/* ------------------------------------------------------------------ */

// the badges are built from MON_STATES, so the words have to be spelled out for the catalogs


