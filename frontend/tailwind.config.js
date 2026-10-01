/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FBF8F4",
        surface: "#FFFFFF",
        sunken: "#F5EFE7",
        ink: "#2A1A0E",
        muted: "#5E4A3B",
        faint: "#7D6656",
        line: "#E8DDD0",
        lineStrong: "#D6C6B3",
        brand: "#522A0C",
        gold: "#D5A956",
        goldInk: "#86601C",
        onBrand: "#FFF8EE",
      },
      fontFamily: {
        display: ["Heebo", "Arial Hebrew", "sans-serif"],
        sans: ["Heebo", "Arial Hebrew", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(42 21 5 / 5%)",
        pop: "0 4px 12px rgb(42 21 5 / 8%)",
        sheet: "0 16px 40px rgb(42 21 5 / 16%)",
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
      },
    },
  },
  plugins: [],
};
