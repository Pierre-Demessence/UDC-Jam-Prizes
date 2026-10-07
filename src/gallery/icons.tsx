import type { ReactNode } from 'react';

/** Stroke icons, drawn in `currentColor` so they follow the text colour of their button. */

interface IconProps {
  size?: number;
  strokeWidth?: number;
}

function Icon({ children, size = 16, strokeWidth = 2 }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return <Icon strokeWidth={3} {...props}><path d="M5 12l5 5 9-10" /></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon strokeWidth={2.4} {...props}><path d="M6 9l6 6 6-6" /></Icon>;
}

export function ChevronRightIcon(props: IconProps) {
  return <Icon strokeWidth={2.6} {...props}><path d="M9 6l6 6-6 6" /></Icon>;
}

export function CloseIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
}

export function MonitorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="12" rx="2" width="18" x="3" y="4" />
      <path d="M8 20h8M12 16v4" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return <Icon {...props}><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" /></Icon>;
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </Icon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  );
}
