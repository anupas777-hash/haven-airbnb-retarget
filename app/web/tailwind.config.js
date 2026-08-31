/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F172A",
        paper: "#FFFFFF",
        surface: "#F8FAFC",
        fog: "#E2E8F0",
        stone: "#64748B",
        brass: "#FF385C",
        accent: "#FF385C",
        moss: "#10B981",
        signal: "#EF4444",
        border: "#E2E8F0",
        muted: "#F1F5F9",
      },
      fontFamily: {
        sans: ['Geist','Inter','Helvetica Neue','Helvetica','Arial','sans-serif'],
        display: ['Geist','Inter','Helvetica Neue','Helvetica','Arial','sans-serif'],
        mono: ['Geist Mono','JetBrains Mono','monospace'],
      },
      borderRadius: {
        xl: "12px",
        '2xl': "16px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(15,23,42,0.08), 0 4px 12px rgba(15,23,42,0.05)",
        lift: "0 4px 16px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.06)",
      },
      keyframes: {
        in: { "0%": { opacity:"0", transform:"translateY(4px)" }, "100%": { opacity:"1", transform:"translateY(0)" } },
      },
      animation: {
        in: "in 240ms ease-out forwards",
      }
    }
  },
  plugins: []
}
