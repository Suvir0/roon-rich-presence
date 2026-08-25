import type { ThemeMode } from '../shared/contracts';

/** Light and dark first, so the explicit choices are one press apart. */
const THEME_ORDER: readonly ThemeMode[] = ['light', 'dark', 'system'];

export const THEME_LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match display'
};

export function nextThemeMode(current: ThemeMode): ThemeMode {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'light';
}
