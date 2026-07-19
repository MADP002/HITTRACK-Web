// ════════════════════════════════════════════════════════════════
//  HITTRACK — Web theme (light / dark)
//
//  Panel request (Jocelyn + Renz): "light and dark mode for members"
//  and a "user interface option".
//
//  HOW IT WORKS: the palette lives in CSS custom properties defined in
//  index.css (`:root` = dark, `:root[data-theme="light"]` = light).
//  Components reference them from their inline styles as var(--t-*),
//  so flipping the `data-theme` attribute on <html> re-themes the whole
//  member area INSTANTLY — no reload, unlike the mobile app where
//  StyleSheet.create() caches colors at module load.
//
//  Accent colors (red/gold/blue/green/purple) deliberately stay the
//  same in both themes; only surfaces and text flip.
// ════════════════════════════════════════════════════════════════

const KEY = 'hittrack_theme'

/** 'light' | 'dark' — defaults to dark. */
export function getTheme() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' ? 'light' : 'dark'
  } catch (_) {
    return 'dark'
  }
}

/** Apply a theme to the document (does not persist). */
export function applyTheme(name) {
  const theme = name === 'light' ? 'light' : 'dark'
  const root = document.documentElement
  if (theme === 'light') root.setAttribute('data-theme', 'light')
  else root.removeAttribute('data-theme')
  // Keep the browser UI (form controls, scrollbars) in step.
  root.style.colorScheme = theme
  return theme
}

/** Persist + apply. Returns the applied theme. */
export function setTheme(name) {
  const theme = applyTheme(name)
  try { localStorage.setItem(KEY, theme) } catch (_) {}
  return theme
}

/** Flip between light and dark. Returns the new theme. */
export function toggleTheme() {
  return setTheme(getTheme() === 'light' ? 'dark' : 'light')
}

/**
 * Apply the saved theme. Call once at app startup (main.jsx) BEFORE
 * React renders so there's no flash of the wrong theme.
 */
export function initTheme() {
  return applyTheme(getTheme())
}

/**
 * Wipe app state on logout WITHOUT losing the user's theme choice.
 *
 * The app clears localStorage on logout and on the login screen (it caches
 * the profile/stats there). A plain localStorage.clear() would also drop the
 * theme preference, so the UI would snap back to dark on every logout.
 * Use this everywhere instead of localStorage.clear().
 */
export function clearAppStorageKeepTheme() {
  const theme = getTheme()
  try { localStorage.clear() } catch (_) {}
  try { localStorage.setItem(KEY, theme) } catch (_) {}
  applyTheme(theme)
}
