export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Montserrat", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Arial", "sans-serif"],
      },
      colors: {
        brand: {
          gold: "#F5B21A",
          "gold-dark": "#8A6400",
          soft: "rgba(245,178,26,0.14)",
        },
        surface: {
          DEFAULT: "rgba(255,255,255,0.90)",
          strong: "#FFFFFF",
          bg: "#F6F3EE",
        },
        ink: {
          DEFAULT: "#242322",
          muted: "#6B6862",
        },
        line: {
          DEFAULT: "rgba(60,60,67,0.14)",
          strong: "rgba(245,178,26,0.42)",
        },
        state: {
          success: "#1FA35C",
          warning: "#D68A0B",
          danger: "#E53E3E",
          info: "#2563EB",
        },
      },
      borderRadius: {
        sm: "14px",
        md: "20px",
        lg: "28px",
      },
      boxShadow: {
        soft: "0 8px 28px rgba(0,0,0,0.055)",
        elevated: "0 18px 50px rgba(0,0,0,0.08)",
      },
    },
  },
  plugins: [],
};
