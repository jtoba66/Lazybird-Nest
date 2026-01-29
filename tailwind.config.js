/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Semantic Colors (Hardcoded to support opacity modifiers)
                background: '#f0f4f8', // --bg-deep
                card: 'rgba(223, 235, 246, 0.4)', // --bg-card
                'card-hover': 'rgba(238, 245, 250, 0.6)', // --bg-card-hover

                primary: '#768A96', // --accent-primary
                secondary: '#AAC7D8', // --accent-secondary
                success: '#10b981', // Using standard emerald-500 for success instead of grey
                error: '#ef4444', // --accent-error

                'text-main': '#1a1a1a', // --text-main
                'text-muted': '#5e6c7c', // --text-muted

                border: 'rgba(203, 213, 225, 0.4)', // --border-color
            },
            boxShadow: {
                'soft': '0 2px 10px var(--shadow-color)',
                'glow': 'var(--shadow-glow)',
                'glass': 'var(--shadow-glass)',
            }
        },
    },
    plugins: [],
}
