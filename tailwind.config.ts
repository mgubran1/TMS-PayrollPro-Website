import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}','./components/**/*.{ts,tsx}','./pages/**/*.{ts,tsx}','./src/**/*.{ts,tsx}'],
  theme: { extend: { boxShadow: { glow: '0 10px 25px rgba(0,0,0,0.12)' } } },
  plugins: [],
}
export default config
