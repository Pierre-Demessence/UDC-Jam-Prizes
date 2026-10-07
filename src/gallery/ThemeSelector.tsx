import type { Theme } from '@/gallery/theme';

import { MonitorIcon, MoonIcon, SunIcon } from '@/gallery/icons';
import { THEMES } from '@/gallery/theme';

const OPTIONS: Record<Theme, { icon: React.ReactNode; label: string }> = {
  dark: { icon: <MoonIcon size={15} />, label: 'Dark' },
  light: { icon: <SunIcon size={15} />, label: 'Light' },
  system: { icon: <MonitorIcon size={15} />, label: 'System' },
};

interface ThemeSelectorProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

/** The text label hides on narrow screens; the aria-label keeps each button named. */
export function ThemeSelector({ onChange, theme }: ThemeSelectorProps) {
  return (
    <div aria-label="Theme" className="segmented" role="group">
      {THEMES.map(option => (
        <button
          aria-label={`${OPTIONS[option].label} theme`}
          aria-pressed={theme === option}
          className="segment"
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {OPTIONS[option].icon}
          <span className="segment-text">{OPTIONS[option].label}</span>
        </button>
      ))}
    </div>
  );
}
