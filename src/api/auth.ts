import api from '../lib/api';

export interface LoginCredentials {
    email: string;
    password?: string; // Legacy
    authHash?: string; // ZK
}

export interface SignupCredentials {
    email: string;
    password?: string; // Legacy
    authHash?: string; // ZK
    salt?: string;
    encryptedMasterKey?: string;
    encryptedMasterKeyNonce?: string;
    encryptedMetadata?: string;
    encryptedMetadataNonce?: string;
    rootFolderKeyEncrypted?: string;
    rootFolderKeyNonce?: string;
    kdfParams?: string; // JSON string
}

export interface AuthResponse {
    token: string;
    role?: string;
    // ZK fields
    encryptedMasterKey?: string;
    encryptedMasterKeyNonce?: string;
    encryptedMetadata?: string;
    encryptedMetadataNonce?: string;
    salt?: string;
    kdfParams?: string;
}

export const authAPI = {
    async getSalt(email: string): Promise<{ salt: string; kdfParams: string }> {
        const { data } = await api.post('/auth/salt', { email });
        return data;
    },

    async saveMetadata(data: { encryptedMetadata: string; encryptedMetadataNonce: string; email: string }): Promise<{ success: boolean }> {
        const response = await api.post('/auth/metadata', data);
        return response.data;
    },

    async getMetadata(): Promise<{ encryptedMetadata?: string; encryptedMetadataNonce?: string }> {
        const { data } = await api.get('/auth/metadata');
        return data;
    },

    async login(credentials: LoginCredentials): Promise<AuthResponse> {
        const { data } = await api.post('/auth/login', credentials);
        return data;
    },

    async signup(credentials: SignupCredentials): Promise<{ message: string }> {
        const { data } = await api.post('/auth/signup', credentials);
        return data;
    },

    async forgotPassword(email: string): Promise<{ message: string }> {
        const { data } = await api.post('/auth/forgot-password', { email });
        return data;
    },

    async resetPassword(data: {
        token: string;
        authHash: string;
        salt: string;
        encryptedMasterKey: string;
        encryptedMasterKeyNonce: string;
        encryptedMetadata: string;
        encryptedMetadataNonce: string;
        rootFolderKeyEncrypted?: string;
        rootFolderKeyNonce?: string;
        kdfParams: string;
        wipeData: boolean;
    }): Promise<{ message: string }> {
        const { data: response } = await api.post('/auth/reset-password', data);
        return response;
    },

    async deleteAccount(authHash: string): Promise<{ message: string }> {
        const { data } = await api.delete('/auth/account', { data: { authHash } });
        return data;
    }
};
