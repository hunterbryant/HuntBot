/** @type {import('tailwindcss').Config} */
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
	content: ['./src/**/*.{html,js,svelte,ts,svg}'],
	theme: {
		fontFamily: {
			sans: ['Favorit', ...defaultTheme.fontFamily.sans],
			serif: ['Garamond', ...defaultTheme.fontFamily.serif],
			mono: [...defaultTheme.fontFamily.mono]
		},
		extend: {}
	},
	plugins: [require('@tailwindcss/typography')],
	future: {
		hoverOnlyWhenSupported: true
	}
};
