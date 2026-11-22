export const colors = {
  light: {
    canvas: "#eef1eb",
    paper: "#fafbf7",
    ink: "#182f29",
    muted: "#4b6159",
    line: "#cdd8cf",
    control: "#e3eae2",
    focus: "#266750",
    folio: "#193b32",
    folioLine: "#6f9688",
    folioInk: "#dceada",
    positive: "#236148",
    warning: "#8a521d",
  },
  dark: {
    canvas: "#101b18",
    paper: "#192722",
    ink: "#edf3ea",
    muted: "#bdcec1",
    line: "#435b51",
    control: "#2d433a",
    focus: "#a9d9bd",
    folio: "#203e34",
    folioLine: "#709988",
    folioInk: "#e0efdf",
    positive: "#a2d8b6",
    warning: "#efbc88",
  },
} as const;

export type Palette = (typeof colors)[keyof typeof colors];

export const space = {
  hairline: 1,
  focus: 2,
  tight: 4,
  compact: 8,
  inline: 12,
  regular: 16,
  inset: 24,
  block: 32,
  section: 48,
  spread: 64,
  wide: 80,
} as const;

export const radius = { control: 8, surface: 16, round: 999 } as const;

export const typography = {
  caption: 14,
  body: 17,
  wordmark: 24,
  displayCompact: 52,
  displayWide: 88,
} as const;

export const size = { touch: 48, brandMark: 24, statusDot: 8 } as const;
export const shadow = { control: "0 1px 3px #0d24171a" } as const;
