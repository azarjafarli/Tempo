/** @type {import('tailwindcss').Config} */
// EVA RECOVERY design tokens: "surface procedures" — cool regolith paper, graphite ink,
// steel blue for baselines and controls, international orange reserved for flags and "now".
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#EEF0ED",   // page: regolith grey
        deck: "#F6F7F5",   // inset surfaces
        panel: "#FFFFFF",  // sheets: beta cloth white
        panel2: "#EEF1EE",
        line: "#D3D8D2",
        ink: "#1D2227",    // graphite
        dim: "#4C565E",
        faint: "#77818A",
        cyan: { DEFAULT: "#2B5F8E", soft: "#7FA3C4", deep: "#E2EBF3" },   // steel
        amber: { DEFAULT: "#C8460F", soft: "#EE8A5C", deep: "#FBE8DE" },  // international orange
        rose: { DEFAULT: "#9E2F28", deep: "#F5E0DD" },                    // rust: invalid / errors
        jade: { DEFAULT: "#3F7140", deep: "#E2EDDF" },                    // moss: within baseline
      },
      fontFamily: {
        sans: ['"Barlow"', '"Segoe UI"', "system-ui", "sans-serif"],
        cond: ['"Barlow Condensed"', '"Barlow"', '"Arial Narrow"', "sans-serif"],
        mono: ['"Barlow Condensed"', '"Barlow"', "sans-serif"],
      },
      keyframes: {
        pulseRing: { "0%": { boxShadow: "0 0 0 0 rgba(43,95,142,.45)" }, "100%": { boxShadow: "0 0 0 16px rgba(43,95,142,0)" } },
        sweep: { "0%": { transform: "scaleX(0)" }, "100%": { transform: "scaleX(1)" } },
      },
      animation: { pulseRing: "pulseRing 1.6s ease-out infinite", sweep: "sweep .9s cubic-bezier(.2,.7,.2,1) both", rise: "none" },
    },
  },
  plugins: [],
};
