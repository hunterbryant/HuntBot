/** @type {import('tailwindcss').Config} */
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		fontFamily: {
			sans: ['Favorit', ...defaultTheme.fontFamily.sans],
			serif: ['Garamond', ...defaultTheme.fontFamily.serif],
			mono: [...defaultTheme.fontFamily.mono]
		},
		extend: {}
	},
	plugins: [],
	future: {
		hoverOnlyWhenSupported: true
	}
};
