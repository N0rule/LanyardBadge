// Runs in <head> before CSS/paint. Storage may be disabled in private contexts.
(() => {
  const system = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';
  try {
    mode = localStorage.getItem('badge-theme') || mode;
  } catch {}
  if (!['light', 'dark', 'system'].includes(mode)) mode = 'system';
  function apply() {
    document.documentElement.dataset.theme =
      mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
  }
  globalThis.BadgeTheme = {
    get mode() {
      return mode;
    },
    set(value) {
      mode = ['light', 'dark', 'system'].includes(value) ? value : 'system';
      try {
        localStorage.setItem('badge-theme', mode);
      } catch {}
      apply();
    },
  };
  system.addEventListener('change', apply);
  apply();
})();
