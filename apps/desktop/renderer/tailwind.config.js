const colors = require('tailwindcss/colors')

module.exports = {
  content: [
    './renderer/pages/**/*.{js,ts,jsx,tsx}',
    './renderer/components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    colors: {
      // use colors only specified
      white: colors.white,
      gray: colors.gray,
      blue: colors.blue,
      red: colors.red,
      green: colors.green,
      yellow: colors.yellow,
      orange: colors.orange,
      purple: colors.purple,
      pink: colors.pink,
      cyan: colors.cyan,
      emerald: colors.emerald,
      amber: colors.amber,
      indigo: colors.indigo,
    },
    extend: {},
  },
  plugins: [],
}
