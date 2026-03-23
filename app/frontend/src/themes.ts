export type Theme = {
  id: string;
  name: string;
  category: "dark" | "light";
  colors: {
    bgPrimary: string;
    bgCard: string;
    bgInset: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    accent: string;
    accentGreen: string;
  };
  themeColor: string;
};

/** Maps Theme.colors keys to CSS custom property names. */
export const COLOR_CSS_MAP: Record<keyof Theme["colors"], string> = {
  bgPrimary: "--color-bg-primary",
  bgCard: "--color-bg-card",
  bgInset: "--color-bg-inset",
  textPrimary: "--color-text-primary",
  textSecondary: "--color-text-secondary",
  border: "--color-border",
  accent: "--color-accent",
  accentGreen: "--color-accent-green",
};

export const THEMES: Theme[] = [
  // ── Dark themes (14) ──────────────────────────────────────────────
  {
    id: "default-dark",
    name: "Default Dark",
    category: "dark",
    colors: {
      bgPrimary: "#0f1117",
      bgCard: "#171b24",
      bgInset: "#0a0c12",
      textPrimary: "#e8eaf0",
      textSecondary: "#7a8394",
      border: "#454d66",
      accent: "#5b8af0",
      accentGreen: "#22c55e",
    },
    themeColor: "#0f1117",
  },
  {
    id: "dracula",
    name: "Dracula",
    category: "dark",
    colors: {
      bgPrimary: "#282a36",
      bgCard: "#343746",
      bgInset: "#21222c",
      textPrimary: "#f8f8f2",
      textSecondary: "#6272a4",
      border: "#44475a",
      accent: "#bd93f9",
      accentGreen: "#50fa7b",
    },
    themeColor: "#282a36",
  },
  {
    id: "one-dark",
    name: "One Dark",
    category: "dark",
    colors: {
      bgPrimary: "#282c34",
      bgCard: "#2c313c",
      bgInset: "#21252b",
      textPrimary: "#abb2bf",
      textSecondary: "#636d83",
      border: "#3e4452",
      accent: "#61afef",
      accentGreen: "#98c379",
    },
    themeColor: "#282c34",
  },
  {
    id: "nord",
    name: "Nord",
    category: "dark",
    colors: {
      bgPrimary: "#2e3440",
      bgCard: "#3b4252",
      bgInset: "#272c36",
      textPrimary: "#eceff4",
      textSecondary: "#7b88a1",
      border: "#434c5e",
      accent: "#88c0d0",
      accentGreen: "#a3be8c",
    },
    themeColor: "#2e3440",
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    category: "dark",
    colors: {
      bgPrimary: "#282828",
      bgCard: "#3c3836",
      bgInset: "#1d2021",
      textPrimary: "#ebdbb2",
      textSecondary: "#a89984",
      border: "#504945",
      accent: "#83a598",
      accentGreen: "#b8bb26",
    },
    themeColor: "#282828",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    category: "dark",
    colors: {
      bgPrimary: "#002b36",
      bgCard: "#073642",
      bgInset: "#00212b",
      textPrimary: "#839496",
      textSecondary: "#586e75",
      border: "#2a4f59",
      accent: "#268bd2",
      accentGreen: "#859900",
    },
    themeColor: "#002b36",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    category: "dark",
    colors: {
      bgPrimary: "#1a1b26",
      bgCard: "#24283b",
      bgInset: "#16161e",
      textPrimary: "#c0caf5",
      textSecondary: "#565f89",
      border: "#3b4261",
      accent: "#7aa2f7",
      accentGreen: "#9ece6a",
    },
    themeColor: "#1a1b26",
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    category: "dark",
    colors: {
      bgPrimary: "#1e1e2e",
      bgCard: "#313244",
      bgInset: "#181825",
      textPrimary: "#cdd6f4",
      textSecondary: "#7f849c",
      border: "#45475a",
      accent: "#89b4fa",
      accentGreen: "#a6e3a1",
    },
    themeColor: "#1e1e2e",
  },
  {
    id: "monokai",
    name: "Monokai",
    category: "dark",
    colors: {
      bgPrimary: "#272822",
      bgCard: "#3e3d32",
      bgInset: "#1e1f1c",
      textPrimary: "#f8f8f2",
      textSecondary: "#75715e",
      border: "#49483e",
      accent: "#66d9ef",
      accentGreen: "#a6e22e",
    },
    themeColor: "#272822",
  },
  {
    id: "material-dark",
    name: "Material Dark",
    category: "dark",
    colors: {
      bgPrimary: "#212121",
      bgCard: "#2c2c2c",
      bgInset: "#1a1a1a",
      textPrimary: "#eeffff",
      textSecondary: "#6b7394",
      border: "#3a3a3a",
      accent: "#82aaff",
      accentGreen: "#c3e88d",
    },
    themeColor: "#212121",
  },
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    category: "dark",
    colors: {
      bgPrimary: "#0b0e14",
      bgCard: "#11151c",
      bgInset: "#07090d",
      textPrimary: "#bfbdb6",
      textSecondary: "#636a76",
      border: "#2a2e3a",
      accent: "#e6b450",
      accentGreen: "#7fd962",
    },
    themeColor: "#0b0e14",
  },
  {
    id: "everforest-dark",
    name: "Everforest Dark",
    category: "dark",
    colors: {
      bgPrimary: "#2d353b",
      bgCard: "#343f44",
      bgInset: "#272e33",
      textPrimary: "#d3c6aa",
      textSecondary: "#859289",
      border: "#475258",
      accent: "#7fbbb3",
      accentGreen: "#a7c080",
    },
    themeColor: "#2d353b",
  },
  {
    id: "rose-pine",
    name: "Ros\u00e9 Pine",
    category: "dark",
    colors: {
      bgPrimary: "#191724",
      bgCard: "#26233a",
      bgInset: "#13111e",
      textPrimary: "#e0def4",
      textSecondary: "#6e6a86",
      border: "#403d52",
      accent: "#c4a7e7",
      accentGreen: "#31748f",
    },
    themeColor: "#191724",
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    category: "dark",
    colors: {
      bgPrimary: "#1f1f28",
      bgCard: "#2a2a37",
      bgInset: "#16161d",
      textPrimary: "#dcd7ba",
      textSecondary: "#727169",
      border: "#3a3a4a",
      accent: "#7e9cd8",
      accentGreen: "#98bb6c",
    },
    themeColor: "#1f1f28",
  },

  // ── Light themes (6) ──────────────────────────────────────────────
  {
    id: "default-light",
    name: "Default Light",
    category: "light",
    colors: {
      bgPrimary: "#f8f9fb",
      bgCard: "#ffffff",
      bgInset: "#e8eaef",
      textPrimary: "#1a1d24",
      textSecondary: "#6b7280",
      border: "#d1d5db",
      accent: "#4a7ae8",
      accentGreen: "#16a34a",
    },
    themeColor: "#f8f9fb",
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    category: "light",
    colors: {
      bgPrimary: "#fdf6e3",
      bgCard: "#eee8d5",
      bgInset: "#f5efdc",
      textPrimary: "#657b83",
      textSecondary: "#93a1a1",
      border: "#d6cdb7",
      accent: "#268bd2",
      accentGreen: "#859900",
    },
    themeColor: "#fdf6e3",
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    category: "light",
    colors: {
      bgPrimary: "#fbf1c7",
      bgCard: "#f2e5bc",
      bgInset: "#f0e5b4",
      textPrimary: "#3c3836",
      textSecondary: "#7c6f64",
      border: "#d5c4a1",
      accent: "#076678",
      accentGreen: "#79740e",
    },
    themeColor: "#fbf1c7",
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    category: "light",
    colors: {
      bgPrimary: "#eff1f5",
      bgCard: "#e6e9ef",
      bgInset: "#dce0e8",
      textPrimary: "#4c4f69",
      textSecondary: "#7c7f93",
      border: "#ccd0da",
      accent: "#1e66f5",
      accentGreen: "#40a02b",
    },
    themeColor: "#eff1f5",
  },
  {
    id: "github-light",
    name: "GitHub Light",
    category: "light",
    colors: {
      bgPrimary: "#ffffff",
      bgCard: "#f6f8fa",
      bgInset: "#eef1f4",
      textPrimary: "#24292e",
      textSecondary: "#6a737d",
      border: "#e1e4e8",
      accent: "#0366d6",
      accentGreen: "#22863a",
    },
    themeColor: "#ffffff",
  },
  {
    id: "rose-pine-dawn",
    name: "Ros\u00e9 Pine Dawn",
    category: "light",
    colors: {
      bgPrimary: "#faf4ed",
      bgCard: "#fffaf3",
      bgInset: "#f2e9e1",
      textPrimary: "#575279",
      textSecondary: "#9893a5",
      border: "#dfdad9",
      accent: "#907aa9",
      accentGreen: "#286983",
    },
    themeColor: "#faf4ed",
  },
];

export function getThemeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export const DEFAULT_DARK_THEME: Theme = THEMES.find((t) => t.id === "default-dark")!;
export const DEFAULT_LIGHT_THEME: Theme = THEMES.find((t) => t.id === "default-light")!;
