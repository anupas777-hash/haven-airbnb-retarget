/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#121A2B",
        paper: "#F7F3E9",
        fog: "#E7E0D1",
        brass: "#C8A96A",
        moss: "#5B6B53",
        signal: "#C53A2E",
        stone: "#8A8278",
        border: "#E7E0D1",
        muted: "#F2EDE3",
      },
      fontFamily: {
        display: ['Fraunces','serif'],
        sans: ['DM Sans','ui-sans-serif','system-ui'],
        mono: ['JetBrains Mono','ui-monospace','monospace'],
      },
      borderRadius: {
        xl: "16px",
        '2xl': "20px",
      },
      boxShadow: {
        paper: "0 8px 30px rgba(18,26,43,0.08), 0 1px 3px rgba(18,26,43,0.08)",
        ticket: "0 12px 40px rgba(18,26,43,0.12), 0 2px 8px rgba(18,26,43,0.06)",
      },
      keyframes: {
        stamp: { "0%": { transform: "scale(1.4) rotate(-6deg)", opacity:"0" }, "100%": { transform: "scale(1) rotate(-2deg)", opacity:"1" } },
        rise: { "0%": { transform: "translateY(6px)", opacity:"0"}, "100%": {transform:"translateY(0)", opacity:"1"} },
      },
      animation: {
        stamp: "stamp 420ms cubic-bezier(0.34,1.56,0.64,1) forwards",
        rise: "rise 520ms ease-out forwards",
      }
    }
  },
  plugins: []
}
