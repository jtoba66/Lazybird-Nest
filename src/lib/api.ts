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

let isRefreshing = false;
let failedQueue: { resolve: (token: string) => void, reject: (err: any) => void }[] = [];

const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach(prom => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token as string);
        }
    });
    failedQueue = [];
};

// Handle session expiration and automatic token refresh
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401) {
            // Prevent infinite loops if the refresh endpoint itself 401s
            if (originalRequest.url?.includes('/auth/refresh') || originalRequest.url?.includes('/auth/login')) {
                handleSessionLocked(error);
                return Promise.reject(error);
            }

            if (!originalRequest._retry) {
                if (isRefreshing) {
                    return new Promise(function(resolve, reject) {
                        failedQueue.push({ resolve, reject });
                    }).then(token => {
                        originalRequest.headers['Authorization'] = 'Bearer ' + token;
                        return api(originalRequest);
                    }).catch(err => {
                        return Promise.reject(err);
                    });
                }

                originalRequest._retry = true;
                isRefreshing = true;

                const failedRefreshToken = localStorage.getItem('nest_refresh_token');
                if (!failedRefreshToken) {
                    isRefreshing = false;
                    handleSessionLocked(error);
                    return Promise.reject(error);
                }

                try {
                    const data = await navigator.locks.request('nest_refresh_token', async () => {
                        // Check if token was refreshed by another tab while waiting for the lock
                        const currentRefreshToken = localStorage.getItem('nest_refresh_token');
                        if (currentRefreshToken !== failedRefreshToken) {
                            const newToken = localStorage.getItem('nest_token');
                            if (!newToken) throw new Error('Cross-tab refresh failed');
                            return { token: newToken, refreshToken: currentRefreshToken };
                        }

                        // Perform the refresh
                        const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken: failedRefreshToken });
                        return res.data;
                    });
                    
                    // Update local storage
                    localStorage.setItem('nest_token', data.token);
                    if (data.refreshToken) {
                        localStorage.setItem('nest_refresh_token', data.refreshToken);
                    }
                    
                    // Update default headers
                    api.defaults.headers.common['Authorization'] = 'Bearer ' + data.token;
                    originalRequest.headers['Authorization'] = 'Bearer ' + data.token;
                    
                    processQueue(null, data.token);
                    return api(originalRequest);
                } catch (refreshError) {
                    processQueue(refreshError, null);
                    handleSessionLocked(error);
                    return Promise.reject(refreshError);
                } finally {
                    isRefreshing = false;
                }
            }
        }
        return Promise.reject(error);
    }
);

function handleSessionLocked(error: any) {
    const currentPath = window.location.pathname;

    // Don't redirect if already on auth pages
    const publicPaths = ['/login', '/signup', '/reset-password'];
    const isPublicRoute = publicPaths.includes(currentPath) ||
        currentPath.startsWith('/s/') ||
        currentPath.startsWith('/collab/') ||
        currentPath.startsWith('/dz/');
    if (!isPublicRoute) {
        // Clear stale session data
        localStorage.removeItem('nest_token');
        localStorage.removeItem('nest_refresh_token');
        localStorage.removeItem('nest_email');
        localStorage.removeItem('nest_role');
        localStorage.removeItem('nest_master_key');
        sessionStorage.removeItem('nest_master_key');

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

export default api;
