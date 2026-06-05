/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bitget: {
          DEFAULT: "#2B6B6B",
          dark: "#F5F0E6",
          panel: "#FAF6ED",
          border: "#D4C7B0",
          muted: "#EDE6D8",
        },
        primary: { DEFAULT: "#A83232", hover: "#8C2828" },
        profit: "#3A8F8F",
        loss: "#A83232",
        ink: {
          DEFAULT: "#3D3428",
          soft: "#4A4035",
          body: "#5C5244",
          muted: "#7A6F5F",
          faint: "#9A8B78",
        },
        warn: { DEFAULT: "#8B6914", muted: "#A07D2A" },
        paper: { DEFAULT: "#F5F0E6", sub: "#EDE6D8" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        panel: "0 2px 12px rgba(61, 52, 40, 0.06), 0 1px 3px rgba(61, 52, 40, 0.04)",
        float: "0 4px 20px rgba(61, 52, 40, 0.08), 0 2px 6px rgba(61, 52, 40, 0.04)",
      },
    },
  },
  plugins: [],
};
