export const colors = {
  light: {
    canvas: "#ebf3f3",
    paper: "#fcfefe",
    ink: "#173c3e",
    muted: "#4b6467",
    line: "#c7dadb",
    control: "#cce7e1",
    focus: "#25685f",
    action: "#25685f",
    actionInk: "#ffffff",
    actionHover: "#205b53",
    folio: "#205550",
    folioLine: "#85bdb0",
    folioInk: "#ddf3ed",
    positive: "#286245",
    warning: "#86500f",
    error: "#a13d30",
  },
  dark: {
    canvas: "#102629",
    paper: "#193638",
    ink: "#e6f4f2",
    muted: "#b6cccd",
    line: "#3a5557",
    control: "#294849",
    focus: "#9ddbcf",
    action: "#9ddbcf",
    actionInk: "#102629",
    actionHover: "#b4e8dd",
    folio: "#204844",
    folioLine: "#79b4a6",
    folioInk: "#daf2ec",
    positive: "#a2d7ad",
    warning: "#efbd7d",
    error: "#ffb2a2",
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
export const shadow = { control: "0 1px 3px #1026291a" } as const;
