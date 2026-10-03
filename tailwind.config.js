/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef5fb', 100: '#d9e8f5', 500: '#1867a5', 600: '#145a91', 700: '#114a78', 900: '#102f4f' },
      },
    },
  },
  plugins: [],
};
