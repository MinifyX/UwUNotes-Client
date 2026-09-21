/**
 * The line icons the chrome is built from, drawn on a 16 × 16 grid.
 *
 * Inline SVG, one path per icon, `currentColor` only — so an icon takes the
 * colour of whatever it sits in and needs no theme-aware variant. No icon font:
 * a font is a network request in the best case and a flash of nothing in the
 * worst, and neither belongs in a window that must be usable a frame after it
 * opens.
 *
 * The grid is 16 rather than the suite's usual 24 because these sit next to
 * 13 px text in a 26 px toolbar button, and half-pixel strokes on a scaled-down
 * 24 px path are how a toolbar starts looking blurry.
 *
 * It knows nothing about what an icon means. `name` is a shape, not an action:
 * the same `close` cross ends a tab, a dialog and a toast.
 */

const PATHS = {
  file: 'M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z M9 1.5V5h3.5',
  filePlus:
    'M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z M9 1.5V5h3.5 M8 8.2v3.6 M6.2 10h3.6',
  folder: 'M1.5 4a1 1 0 0 1 1-1h3L7 4.5h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z',
  folderOpen:
    'M1.5 12.5V4a1 1 0 0 1 1-1h3L7 4.5h6.5a1 1 0 0 1 1 1V7 M1.5 12.5 3.6 7.5h11.4l-2.1 5Z',
  folderPlus:
    'M1.5 4a1 1 0 0 1 1-1h3L7 4.5h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z M8 6.6v3.6 M6.2 8.4h3.6',
  save: 'M2.5 3.5a1 1 0 0 1 1-1h6.6l2.4 2.4v7.6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z M5 2.5v3.5h4.5V2.5 M4.5 9.5h7v4.5h-7Z',
  // Two disks, the back one peeking out: "all of them".
  saveAll:
    'M4.5 5.5a1 1 0 0 1 1-1h5.4l2.1 2.1v6.9a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1Z M6.8 4.5v2.6h3.6V4.5 M6.5 10.5h4.5v3.5H6.5Z M2.5 11V3a1 1 0 0 1 1-1h6',
  fileClose:
    'M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z M9 1.5V5h3.5 M6.3 8.3l3.4 3.4 M9.7 8.3l-3.4 3.4',
  // Two sheets, the front one crossed out.
  closeAll:
    'M5.5 3.5h4.8l3.2 3.2v7.3a.5.5 0 0 1-.5.5H5.5a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5Z M2.5 12V2a.5.5 0 0 1 .5-.5h5 M7.6 9.1l3.3 3.3 M10.9 9.1l-3.3 3.3',
  print:
    'M4.5 5.5v-4h7v4 M4.5 11.5h-2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2 M4.5 9.5h7v5h-7Z M12 7.5h.01',
  // Two columns with a changed line marked across both.
  diff: 'M1.5 2.5h5.5v11H1.5z M9 2.5h5.5v11H9z M3 6h2.5 M10.5 6H13 M3 9h2.5 M10.5 9H13',
  search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M10.6 10.6 14.5 14.5',
  replace: 'M2.5 4.5h8 M8.5 2.5 10.5 4.5 8.5 6.5 M13.5 11.5h-8 M7.5 9.5 5.5 11.5 7.5 13.5',
  splitH: 'M1.5 2.5h13v11h-13z M8 2.5v11',
  splitV: 'M1.5 2.5h13v11h-13z M1.5 8h13',
  close: 'M3.5 3.5 12.5 12.5 M12.5 3.5 3.5 12.5',
  chevronRight: 'M6 3.5 10.5 8 6 12.5',
  chevronDown: 'M3.5 6 8 10.5 12.5 6',
  // Two chevrons converging: fold everything back in.
  collapse: 'M4.5 2.5 8 6l3.5-3.5 M4.5 13.5 8 10l3.5 3.5',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9 M13.5 2.4v3.4h-3.4',
  external:
    'M9.5 2.5h4v4 M13.5 2.5 7.8 8.2 M12 9.8v2.7a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2.7',
  gear: 'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M8 1.5v1.7 M8 12.8v1.7 M1.5 8h1.7 M12.8 8h1.7 M3.4 3.4 4.6 4.6 M11.4 11.4l1.2 1.2 M12.6 3.4l-1.2 1.2 M4.6 11.4l-1.2 1.2',
  palette: 'M1.5 2.5h13v11h-13z M4.5 6 6.8 8.2 4.5 10.4 M8.3 10.5h3.4',
  plus: 'M8 3.5v9 M3.5 8h9',
  minus: 'M3.5 8h9',
  check: 'M3 8.5 6.5 12 13 4.5',
  warning: 'M8 2.2 14.5 13.5h-13Z M8 6.4v3.4 M8 12.1h.01',
  gitBranch:
    'M4.5 4.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z M4.5 14.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z M11.5 6.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z M4.5 4.6v6.8 M11.5 6.6v.9a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 0-2.5 2.5',
  minimap:
    'M1.5 2.5h13v11h-13z M10.5 2.5v11 M11.8 5h1.5 M11.8 7.4h1.5 M11.8 9.8h1 M3.2 5.4h5 M3.2 8h4 M3.2 10.6h5.5',
  wrap: 'M2 3.5h12 M2 8h8.25a2.25 2.25 0 0 1 0 4.5H6 M7.8 10.7 6 12.5l1.8 1.8 M2 12.5h1.6',
  sidebar: 'M1.5 2.5h13v11h-13z M6 2.5v11',
  dots: 'M3.2 8h.01 M8 8h.01 M12.8 8h.01',
} as const;

export type IconName = keyof typeof PATHS;

type IconProps = {
  name: IconName;
  size?: number;
  /**
   * Only for an icon that is the *whole* label of something. A button with
   * text beside it leaves this off, so a screen reader hears the word once.
   */
  title?: string;
  className?: string;
};

export function Icon({ name, size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className ? `icon ${className}` : 'icon'}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      // On the element rather than in the stylesheet, so an icon still reads as
      // an icon in the seconds before a stylesheet lands — and so nothing here
      // names a colour that is not the one it was put next to.
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
