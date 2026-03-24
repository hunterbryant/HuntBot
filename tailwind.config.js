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
		extend: {
			colors: {
				mud: {
					50: '#fff2ee',
					100: '#fddbd2',
					200: '#f3c6b9',
					300: '#eab1a2',
					400: '#da9e8f',
					500: '#cb8d7d',
					600: '#ad6e5e',
					700: '#814a3b',
					800: '#56261a',
					900: '#300902'
				}
			}
		}
	},
	plugins: [require('@tailwindcss/typography')],
	future: {
		hoverOnlyWhenSupported: true
	}
};
