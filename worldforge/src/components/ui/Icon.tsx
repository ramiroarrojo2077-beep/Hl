import type { SVGProps } from "react";

/** Íconos de línea propios (24x24, trazo 1.8). */
const PATHS: Record<string, string> = {
  cursor: "M5 3l13 7-6 2-2 6z",
  move: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
  rotate: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  scale: "M4 20h7v-7H4zM14 4h6v6M20 4l-8 8",
  mountain: "M3 20l6-10 4 6 2-3 6 7z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  unlock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2",
  folder: "M3 6h6l2 2h10v11H3z",
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  save: "M5 3h11l3 3v15H5zM8 3v6h8M8 21v-7h8v7",
  play: "M7 4l13 8-13 8z",
  pause: "M7 4h4v16H7zM13 4h4v16h-4z",
  stop: "M6 6h12v12H6z",
  camera: "M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  sparkles: "M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-1.9.2 1.7 1.7 0 0 0-.8 1.5V22h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1-2-3.4.2-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14.5H2.9v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 1.9-.3A1.7 1.7 0 0 0 9 2.6V2h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.8-.3l.1-.1 2 3.4-.2.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H19a1.7 1.7 0 0 0-1.6 1.3z",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  upload: "M12 21V9M7 14l5-5 5 5M4 3h16",
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  rain: "M20 15a4 4 0 0 0-4-7 6 6 0 0 0-11.6 2A4 4 0 0 0 6 18M8 19l-1 2M12 19l-1 2M16 19l-1 2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  car: "M5 11l2-5h10l2 5M3 11h18v6H3zM7 17v2M17 17v2M7 14h.01M17 14h.01",
  tree: "M12 22v-6M7 16h10l-5-6zM8 11h8l-4-6z",
  building: "M4 21V5l8-3v19M12 21h8V9l-8-2M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.6 1 2.5h6c0-.9.2-1.7 1-2.5A6 6 0 0 0 12 3z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 12l5 5 9-10",
  menu: "M4 6h16M4 12h16M4 18h16",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  gamepad: "M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7A4.7 4.7 0 0 0 2 9.7V15a3 3 0 0 0 5.2 2l1.7-2h6.2l1.7 2A3 3 0 0 0 22 15V9.7A4.7 4.7 0 0 0 17.3 5z",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4",
  terminal: "M4 5h16v14H4zM7 9l3 3-3 3M12 15h5",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  home: "M3 11l9-7 9 7M5 10v10h14V10",
  focus: "M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  group: "M3 3h8v8H3zM13 13h8v8h-8zM7 11v6h6M17 13V7h-6",
  magnet: "M6 3v8a6 6 0 0 0 12 0V3M6 3h4v8a2 2 0 0 0 4 0V3h4M6 7h4M14 7h4",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  arrowLeft: "M15 6l-6 6 6 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  key: "M15 7a4 4 0 1 1-4.5 4L3 18.5V21h3v-2h2v-2h2l1.5-1.5A4 4 0 0 1 15 7z",
  diamond: "M12 3l8 9-8 9-8-9z",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
  brush: "M18 3l3 3-9 9-3-3zM9 12l-4 4a2.5 2.5 0 0 0 0 3.5c1 1 2.5 1 3.5 0l4-4",
  water: "M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z",
  run: "M13 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM7 21l3-6 3 2v5M10 15l1-5 4 3h4M11 10l-4 1-2 4",
  cube: "M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5",
  stats: "M4 20V10M10 20V4M16 20v-7M22 20H2",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
