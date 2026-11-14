/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#050b16",
        deck: "#0a1426",
        panel: "#0e1b31",
        panel2: "#13233e",
        line: "#1f3352",
        ink: "#dbe6f5",
        dim: "#8ea3c0",
        faint: "#5d7392",
        cyan: { DEFAULT: "#4fd1e8", soft: "#2a8fa3", deep: "#0f3c4a" },
        amber: { DEFAULT: "#f4b544", soft: "#b98424", deep: "#3d2c0e" },
        rose: { DEFAULT: "#f07a7a", deep: "#3e1a1f" },
        jade: { DEFAULT: "#5fd3a2", deep: "#103a2c" },
      },
      fontFamily: {
        sans: ['"Inter"', '"Segoe UI"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Cascadia Mono"', "Consolas", "monospace"],
      },
      keyframes: {
        rise: { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "none" } },
        pulseRing: { "0%": { boxShadow: "0 0 0 0 rgba(79,209,232,.55)" }, "100%": { boxShadow: "0 0 0 18px rgba(79,209,232,0)" } },
      },
      animation: { rise: "rise .35s ease-out both", pulseRing: "pulseRing 1.6s ease-out infinite" },
    },
  },
  plugins: [],
};
