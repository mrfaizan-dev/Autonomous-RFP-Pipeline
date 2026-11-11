import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111713',
        paper: '#f7f8f5',
        sage: '#b8d4c7',
        pine: '#244c40',
        amber: '#d7a75d',
      },
      fontFamily: {
        sans: ['Arial', 'Helvetica Neue', 'sans-serif'],
      },
      boxShadow: {
        quiet: '0 18px 60px rgba(17, 23, 19, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
