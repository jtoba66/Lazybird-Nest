import axios from 'axios';
import API_BASE_URL from '../config/api';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Add auth token to requests
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('nest_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Handle session expiration
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Session expired or invalid
            const currentPath = window.location.pathname;

            // Don't redirect if already on auth pages
            if (!['/login', '/signup', '/reset-password'].includes(currentPath)) {
                // Clear stale session data
                localStorage.removeItem('nest_token');
                localStorage.removeItem('nest_email');

                // Show user-friendly message
                const message = error.response?.data?.error || 'Your session has expired. Please log in again.';

                // Create a toast-like notification
                const toast = document.createElement('div');
                toast.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: rgba(220, 38, 38, 0.95);
                    color: white;
                    padding: 16px 24px;
                    border-radius: 12px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    z-index: 10000;
                    font-family: system-ui, -apple-system, sans-serif;
                    font-size: 14px;
                    font-weight: 500;
                    backdrop-filter: blur(10px);
                `;
                toast.textContent = message;
                document.body.appendChild(toast);

                // Redirect to login after showing message
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            }
        }
        return Promise.reject(error);
    }
);

export default api;
