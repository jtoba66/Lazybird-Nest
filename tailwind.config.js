/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // High-Contrast Brand Palette
                background: '#F0F4F8',
                surface: '#FFFFFF',
                card: 'rgba(223, 235, 246, 0.4)',
                'card-hover': 'rgba(238, 245, 250, 0.6)',

                primary: '#5D7285',   // Updated Deep Steel
                secondary: '#8DA9C4', // Updated Muted Blue
                accent: '#0F172A',    // Dark Accent for landing
                success: '#10b981',
                error: '#ef4444',

                'text-main': '#0F172A',   // Slate-900 for high contrast
                'text-muted': '#475569',  // Slate-600
                'text-light': '#94A3B8',  // Slate-400

                border: 'rgba(203, 213, 225, 0.4)',
                glass: 'rgba(255, 255, 255, 0.7)',
                'glass-strong': 'rgba(255, 255, 255, 0.9)',
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                display: ['Outfit', 'sans-serif'],
                mono: ['Space Grotesk', 'monospace'],
            },
            backgroundImage: {
                'mesh': 'radial-gradient(at 0% 0%, rgba(141, 169, 196, 0.25) 0px, transparent 60%), radial-gradient(at 100% 100%, rgba(93, 114, 133, 0.15) 0px, transparent 60%), radial-gradient(at 50% 50%, rgba(255, 255, 255, 0.8) 0px, transparent 100%)',
            },
            boxShadow: {
                'soft': '0 2px 10px var(--shadow-color)',
                'glow': 'var(--shadow-glow)',
                'glass': 'var(--shadow-glass)',
                'premium': '0 4px 20px -2px rgba(93, 114, 133, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.02), 0 0 0 1px rgba(93, 114, 133, 0.05)',
                'premium-hover': '0 25px 30px -5px rgba(93, 114, 133, 0.15), 0 10px 10px -5px rgba(93, 114, 133, 0.04), 0 0 0 1px rgba(93, 114, 133, 0.1)',
            }
        },
    },
    plugins: [],
}
