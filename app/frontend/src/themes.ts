// ── Types ────────────────────────────────────────────────────────────────────

export type ThemePalette = {
  foreground: string;
  background: string;
  cursorColor: string;
  cursorText: string;
  selectionBackground: string;
  selectionForeground: string;
  /** ANSI 0-15: black, red, green, yellow, blue, magenta, cyan, white,
   *  brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite */
  ansi: readonly [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
};

export type UIColors = {
  bgPrimary: string;
  bgCard: string;
  bgInset: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
  accentGreen: string;
};

export type Theme = {
  id: string;
  name: string;
  category: "dark" | "light";
  palette: ThemePalette;
};

// ── CSS property mapping (retained for applyThemeToDOM) ──────────────────────

/** Maps UIColors keys to CSS custom property names. */
export const COLOR_CSS_MAP: Record<keyof UIColors, string> = {
  bgPrimary: "--color-bg-primary",
  bgCard: "--color-bg-card",
  bgInset: "--color-bg-inset",
  textPrimary: "--color-text-primary",
  textSecondary: "--color-text-secondary",
  border: "--color-border",
  accent: "--color-accent",
  accentGreen: "--color-accent-green",
};

// ── Color helpers (module-private) ───────────────────────────────────────────

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHex(rgb: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    clamp(rgb.r).toString(16).padStart(2, "0") +
    clamp(rgb.g).toString(16).padStart(2, "0") +
    clamp(rgb.b).toString(16).padStart(2, "0")
  );
}

function lightenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  const factor = amount / 100;
  return rgbToHex({
    r: rgb.r + (255 - rgb.r) * factor,
    g: rgb.g + (255 - rgb.g) * factor,
    b: rgb.b + (255 - rgb.b) * factor,
  });
}

function darkenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  const factor = amount / 100;
  return rgbToHex({
    r: rgb.r * (1 - factor),
    g: rgb.g * (1 - factor),
    b: rgb.b * (1 - factor),
  });
}

function blendHex(fg: string, bg: string, ratio: number): string {
  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  return rgbToHex({
    r: fgRgb.r * ratio + bgRgb.r * (1 - ratio),
    g: fgRgb.g * ratio + bgRgb.g * (1 - ratio),
    b: fgRgb.b * ratio + bgRgb.b * (1 - ratio),
  });
}

// ── Derivation functions ─────────────────────────────────────────────────────

/** Derive the 8 UI CSS colors from a full theme palette. */
export function deriveUIColors(palette: ThemePalette, category: "dark" | "light"): UIColors {
  const isDark = category === "dark";
  return {
    bgPrimary: palette.background,
    bgCard: isDark ? lightenHex(palette.background, 8) : darkenHex(palette.background, 3),
    bgInset: isDark ? darkenHex(palette.background, 5) : darkenHex(palette.background, 6),
    textPrimary: palette.foreground,
    textSecondary: palette.ansi[8],
    border: blendHex(palette.foreground, palette.background, 0.25),
    accent: palette.ansi[4],
    accentGreen: palette.ansi[2],
  };
}

/** Derive an xterm.js ITheme from a full theme palette. */
export function deriveXtermTheme(palette: ThemePalette) {
  return {
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.cursorColor,
    cursorAccent: palette.cursorText,
    selectionBackground: palette.selectionBackground,
    selectionForeground: palette.selectionForeground,
    black: palette.ansi[0],
    red: palette.ansi[1],
    green: palette.ansi[2],
    yellow: palette.ansi[3],
    blue: palette.ansi[4],
    magenta: palette.ansi[5],
    cyan: palette.ansi[6],
    white: palette.ansi[7],
    brightBlack: palette.ansi[8],
    brightRed: palette.ansi[9],
    brightGreen: palette.ansi[10],
    brightYellow: palette.ansi[11],
    brightBlue: palette.ansi[12],
    brightMagenta: palette.ansi[13],
    brightCyan: palette.ansi[14],
    brightWhite: palette.ansi[15],
  };
}

// ── Theme definitions (20 themes: 14 dark + 6 light) ────────────────────────

export const THEMES: Theme[] = [
  // ── Dark themes (14) ──────────────────────────────────────────────
  {
    id: "default-dark",
    name: "Default Dark",
    category: "dark",
    palette: {
      foreground: "#e8eaf0",
      background: "#0f1117",
      cursorColor: "#e8eaf0",
      cursorText: "#0f1117",
      selectionBackground: "#2a3040",
      selectionForeground: "#e8eaf0",
      ansi: ["#0f1117", "#e06c75", "#22c55e", "#e8a84f", "#5b8af0", "#c678dd", "#56b6c2", "#e8eaf0", "#7a8394", "#e06c75", "#22c55e", "#e8a84f", "#5b8af0", "#c678dd", "#56b6c2", "#ffffff"],
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    category: "dark",
    palette: {
      foreground: "#f8f8f2",
      background: "#282a36",
      cursorColor: "#f8f8f2",
      cursorText: "#282a36",
      selectionBackground: "#44475a",
      selectionForeground: "#f8f8f2",
      ansi: ["#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2", "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff"],
    },
  },
  {
    id: "one-dark",
    name: "One Dark",
    category: "dark",
    palette: {
      foreground: "#abb2bf",
      background: "#282c34",
      cursorColor: "#528bff",
      cursorText: "#282c34",
      selectionBackground: "#3e4452",
      selectionForeground: "#abb2bf",
      ansi: ["#282c34", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf", "#636d83", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#ffffff"],
    },
  },
  {
    id: "nord",
    name: "Nord",
    category: "dark",
    palette: {
      foreground: "#d8dee9",
      background: "#2e3440",
      cursorColor: "#d8dee9",
      cursorText: "#2e3440",
      selectionBackground: "#434c5e",
      selectionForeground: "#d8dee9",
      ansi: ["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0", "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#eceff4"],
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    category: "dark",
    palette: {
      foreground: "#ebdbb2",
      background: "#282828",
      cursorColor: "#ebdbb2",
      cursorText: "#282828",
      selectionBackground: "#504945",
      selectionForeground: "#ebdbb2",
      ansi: ["#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984", "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2"],
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    category: "dark",
    palette: {
      foreground: "#839496",
      background: "#002b36",
      cursorColor: "#839496",
      cursorText: "#002b36",
      selectionBackground: "#073642",
      selectionForeground: "#839496",
      ansi: ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#586e75", "#cb4b16", "#859900", "#b58900", "#268bd2", "#6c71c4", "#2aa198", "#fdf6e3"],
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    category: "dark",
    palette: {
      foreground: "#c0caf5",
      background: "#1a1b26",
      cursorColor: "#c0caf5",
      cursorText: "#1a1b26",
      selectionBackground: "#33467c",
      selectionForeground: "#c0caf5",
      ansi: ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6", "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"],
    },
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    category: "dark",
    palette: {
      foreground: "#cdd6f4",
      background: "#1e1e2e",
      cursorColor: "#f5e0dc",
      cursorText: "#1e1e2e",
      selectionBackground: "#45475a",
      selectionForeground: "#cdd6f4",
      ansi: ["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de", "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8"],
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    category: "dark",
    palette: {
      foreground: "#f8f8f2",
      background: "#272822",
      cursorColor: "#f8f8f0",
      cursorText: "#272822",
      selectionBackground: "#49483e",
      selectionForeground: "#f8f8f2",
      ansi: ["#272822", "#f92672", "#a6e22e", "#f4bf75", "#66d9ef", "#ae81ff", "#a1efe4", "#f8f8f2", "#75715e", "#f92672", "#a6e22e", "#f4bf75", "#66d9ef", "#ae81ff", "#a1efe4", "#f9f8f5"],
    },
  },
  {
    id: "material-dark",
    name: "Material Dark",
    category: "dark",
    palette: {
      foreground: "#eeffff",
      background: "#212121",
      cursorColor: "#ffcc00",
      cursorText: "#212121",
      selectionBackground: "#3a3a3a",
      selectionForeground: "#eeffff",
      ansi: ["#212121", "#f07178", "#c3e88d", "#ffcb6b", "#82aaff", "#c792ea", "#89ddff", "#eeffff", "#545454", "#f07178", "#c3e88d", "#ffcb6b", "#82aaff", "#c792ea", "#89ddff", "#ffffff"],
    },
  },
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    category: "dark",
    palette: {
      foreground: "#bfbdb6",
      background: "#0b0e14",
      cursorColor: "#e6b450",
      cursorText: "#0b0e14",
      selectionBackground: "#273747",
      selectionForeground: "#bfbdb6",
      ansi: ["#01060e", "#ea6c73", "#7fd962", "#f9af4f", "#59c2ff", "#d2a6ff", "#73b8ff", "#bfbdb6", "#484f58", "#f07178", "#aad94c", "#ffb454", "#59c2ff", "#d2a6ff", "#95e6cb", "#d9d7ce"],
    },
  },
  {
    id: "everforest-dark",
    name: "Everforest Dark",
    category: "dark",
    palette: {
      foreground: "#d3c6aa",
      background: "#2d353b",
      cursorColor: "#d3c6aa",
      cursorText: "#2d353b",
      selectionBackground: "#543a48",
      selectionForeground: "#d3c6aa",
      ansi: ["#343f44", "#e67e80", "#a7c080", "#dbbc7f", "#7fbbb3", "#d699b6", "#83c092", "#d3c6aa", "#475258", "#e67e80", "#a7c080", "#dbbc7f", "#7fbbb3", "#d699b6", "#83c092", "#d3c6aa"],
    },
  },
  {
    id: "rose-pine",
    name: "Ros\u00e9 Pine",
    category: "dark",
    palette: {
      foreground: "#e0def4",
      background: "#191724",
      cursorColor: "#524f67",
      cursorText: "#e0def4",
      selectionBackground: "#2a283e",
      selectionForeground: "#e0def4",
      ansi: ["#26233a", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4", "#6e6a86", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4"],
    },
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    category: "dark",
    palette: {
      foreground: "#dcd7ba",
      background: "#1f1f28",
      cursorColor: "#c8c093",
      cursorText: "#1f1f28",
      selectionBackground: "#2d4f67",
      selectionForeground: "#dcd7ba",
      ansi: ["#16161d", "#c34043", "#76946a", "#c0a36e", "#7e9cd8", "#957fb8", "#6a9589", "#c8c093", "#727169", "#e82424", "#98bb6c", "#e6c384", "#7fb4ca", "#938aa9", "#7aa89f", "#dcd7ba"],
    },
  },

  // ── Light themes (6) ──────────────────────────────────────────────
  {
    id: "default-light",
    name: "Default Light",
    category: "light",
    palette: {
      foreground: "#1a1d24",
      background: "#f8f9fb",
      cursorColor: "#1a1d24",
      cursorText: "#f8f9fb",
      selectionBackground: "#c7d2fe",
      selectionForeground: "#1a1d24",
      ansi: ["#1a1d24", "#e53e3e", "#16a34a", "#ca8a04", "#4a7ae8", "#9333ea", "#0891b2", "#f8f9fb", "#6b7280", "#e53e3e", "#16a34a", "#ca8a04", "#4a7ae8", "#9333ea", "#0891b2", "#ffffff"],
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    category: "light",
    palette: {
      foreground: "#657b83",
      background: "#fdf6e3",
      cursorColor: "#657b83",
      cursorText: "#fdf6e3",
      selectionBackground: "#eee8d5",
      selectionForeground: "#657b83",
      ansi: ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#002b36", "#cb4b16", "#859900", "#b58900", "#268bd2", "#6c71c4", "#2aa198", "#fdf6e3"],
    },
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    category: "light",
    palette: {
      foreground: "#3c3836",
      background: "#fbf1c7",
      cursorColor: "#3c3836",
      cursorText: "#fbf1c7",
      selectionBackground: "#d5c4a1",
      selectionForeground: "#3c3836",
      ansi: ["#fbf1c7", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#7c6f64", "#928374", "#9d0006", "#79740e", "#b57614", "#076678", "#8f3f71", "#427b58", "#3c3836"],
    },
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    category: "light",
    palette: {
      foreground: "#4c4f69",
      background: "#eff1f5",
      cursorColor: "#dc8a78",
      cursorText: "#eff1f5",
      selectionBackground: "#ccd0da",
      selectionForeground: "#4c4f69",
      ansi: ["#5c5f77", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#8839ef", "#179299", "#acb0be", "#6c6f85", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#8839ef", "#179299", "#bcc0cc"],
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    category: "light",
    palette: {
      foreground: "#24292e",
      background: "#ffffff",
      cursorColor: "#044289",
      cursorText: "#ffffff",
      selectionBackground: "#c8c8fa",
      selectionForeground: "#24292e",
      ansi: ["#24292e", "#d73a49", "#22863a", "#b08800", "#0366d6", "#6f42c1", "#1b7c83", "#6a737d", "#959da5", "#cb2431", "#28a745", "#dbab09", "#2188ff", "#8a63d2", "#3192aa", "#d1d5da"],
    },
  },
  {
    id: "rose-pine-dawn",
    name: "Ros\u00e9 Pine Dawn",
    category: "light",
    palette: {
      foreground: "#575279",
      background: "#faf4ed",
      cursorColor: "#9893a5",
      cursorText: "#575279",
      selectionBackground: "#dfdad9",
      selectionForeground: "#575279",
      ansi: ["#f2e9e1", "#b4637a", "#286983", "#ea9d34", "#56949f", "#907aa9", "#d7827e", "#575279", "#9893a5", "#b4637a", "#286983", "#ea9d34", "#56949f", "#907aa9", "#d7827e", "#575279"],
    },
  },
];

// ── Lookup helpers ───────────────────────────────────────────────────────────

export function getThemeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export const DEFAULT_DARK_THEME: Theme = THEMES.find((t) => t.id === "default-dark")!;
export const DEFAULT_LIGHT_THEME: Theme = THEMES.find((t) => t.id === "default-light")!;
