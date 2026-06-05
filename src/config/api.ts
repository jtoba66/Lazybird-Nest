const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://nestapi.lazybird.io/api' : 'http://localhost:3004/api');

console.log('[API] Using Base URL:', API_BASE_URL);

export default API_BASE_URL;
