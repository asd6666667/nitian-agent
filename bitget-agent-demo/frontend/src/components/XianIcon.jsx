/** 简约轻侠风线性国风图标 — 仅视觉替换，语义与位置不变 */

const ICONS = {
  scan: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 12h4M7 8h10M7 16h7" />
    </g>
  ),
  wallet: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      <path d="M17 11h2a1 1 0 011 1v2a1 1 0 01-1 1h-2" />
      <circle cx="16" cy="13" r="0.5" fill="currentColor" />
    </g>
  ),
  list: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </g>
  ),
  link: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <path d="M10 14a4 4 0 010-5.7l1.3-1.3a4 4 0 015.7 5.7l-1.3 1.3" />
      <path d="M14 10a4 4 0 010 5.7l-1.3 1.3a4 4 0 01-5.7-5.7l1.3-1.3" />
    </g>
  ),
  buy: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </g>
  ),
  pin: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v6M8 8h8l-1 8H9L8 8z" />
      <path d="M10 16v4M14 16v4" />
    </g>
  ),
  long: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 16l6-10 4 6 6-8" />
      <path d="M16 4h4v4" />
    </g>
  ),
  "close-long": (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8l6 6 4-4 6 6" />
      <path d="M16 20h4v-4" />
    </g>
  ),
  explode: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </g>
  ),
  sell: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </g>
  ),
  cancel: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </g>
  ),
  brain: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 8a4 4 0 018 0c0 2-1 3-2 4v2H10v-2c-1-1-2-2-2-4z" />
      <path d="M10 14h4M11 17h2" />
      <path d="M6 10a2 2 0 01-1-3M18 10a2 2 0 001-3" />
    </g>
  ),
  play: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="8,5 19,12 8,19" fill="currentColor" stroke="none" opacity="0.85" />
    </g>
  ),
  stop: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </g>
  ),
  bolt: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L6 12h5l-1 10 7-12h-5l1-8z" />
    </g>
  ),
  "chart-down": (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l6 6 4-4 6 6" />
      <path d="M16 8h4v4" />
    </g>
  ),
  help: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 014.5 1.5c0 2-3 2-3 4" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </g>
  ),
  "trend-up": (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 16l5-8 4 5 7-10" />
      <path d="M16 3h4v4" />
    </g>
  ),
  "trend-down": (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l5 8 4-5 7 10" />
      <path d="M16 21h4v-4" />
    </g>
  ),
  neutral: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <path d="M4 12h16" />
    </g>
  ),
  warning: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3L2 19h20L12 3z" />
      <path d="M12 9v5M12 17h.01" />
    </g>
  ),
  news: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h12a2 2 0 012 2v10H6a2 2 0 01-2-2V5z" />
      <path d="M6 9h8M6 13h6" />
    </g>
  ),
  globe: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
    </g>
  ),
  gear: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </g>
  ),
  shield: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
    </g>
  ),
  journal: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h12a1 1 0 011 1v15l-3-2-3 2-3-2-3 2-3-2V5a1 1 0 011-1z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </g>
  ),
  collection: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 7h11a1 1 0 011 1v11H9a1 1 0 01-1-1V7z" />
      <path d="M5 5h11a1 1 0 011 1v11" opacity="0.45" />
      <path d="M9 10h6M9 13h4" />
    </g>
  ),
  check: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </g>
  ),
  cross: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </g>
  ),
  robot: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M9 8V6a3 3 0 016 0v2" />
      <circle cx="9.5" cy="13" r="1" fill="currentColor" />
      <circle cx="14.5" cy="13" r="1" fill="currentColor" />
      <path d="M10 17h4" />
    </g>
  ),
};

export default function XianIcon({ name, size = 16, className = "" }) {
  const content = ICONS[name] || ICONS.neutral;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`inline-block shrink-0 text-bitget ${className}`}
      aria-hidden="true"
    >
      {content}
    </svg>
  );
}

export { ICONS };
