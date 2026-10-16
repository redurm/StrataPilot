// D2 (theme): the real setting lives in the settings file, which the renderer only learns about
// after an IPC round trip to the main process. Mirror the last applied theme here so the very first
// paint is already correct instead of flashing dark for a light-theme user. app.js re-applies the
// real setting (including "system") as soon as app:settings arrives.
try {
  if (localStorage.getItem('stratapilot_theme') === 'light') {
    document.documentElement.dataset.theme = 'light';
  }
} catch {
  // no localStorage: stay on the dark default, corrected a moment later by applyTheme()
}
