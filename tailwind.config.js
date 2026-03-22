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
					50: '#ffd3c4',
					100: '#ffbea8',
					200: '#fda98d',
					300: '#e79479',
					400: '#d18066',
					500: '#b5664d',
					600: '#9b4f36',
					700: '#7b3219',
					800: '#5c1900',
					900: '#300900'
				}
			}
		}
	},
	plugins: [require('@tailwindcss/typography')],
	future: {
		hoverOnlyWhenSupported: true
	}
};
