import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { authAPI } from '../api/auth';
import type { LoginCredentials, SignupCredentials } from '../api/auth';
import type { MetadataBlob } from '../crypto/v2';

interface User {
    email: string;
    role?: string;
    created_at?: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (credentials: LoginCredentials) => Promise<any>;
    signup: (credentials: SignupCredentials) => Promise<void>;
    logout: () => void;
    isAuthenticated: boolean;
    masterKey: Uint8Array | null;
    setMasterKey: (key: Uint8Array | null) => void;
    metadata: MetadataBlob | null;
    setMetadata: (meta: MetadataBlob | null) => void;
    saveMetadata: (meta: MetadataBlob) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [token, setToken] = useState<string | null>(() => localStorage.getItem('nest_token'));
    const [user, setUser] = useState<User | null>(() => {
        const savedEmail = localStorage.getItem('nest_email');
        return savedEmail ? { email: savedEmail } : null;
    });
    const [masterKey, setMasterKey] = useState<Uint8Array | null>(() => {
        // Try to restore master key from localStorage
        const stored = localStorage.getItem('nest_master_key');
        if (stored) {
            try {
                // Master key is stored as base64
                console.log('[AUTH] Restoring master key from storage, length:', stored.length);
                const bytes = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
                console.log('[AUTH] Master key restored, byte length:', bytes.length);
                return bytes;
            } catch (e) {
                console.error('[AUTH] Failed to restore master key:', e);
                return null;
            }
        }

        console.log('[AUTH] No master key in storage');
        // If we have a token but no master key, we are in an inconsistent/locked state.
        // For security and UX, we should force a re-login to recover the master key.
        if (localStorage.getItem('nest_token')) {
            console.warn('[AUTH] Session Locked: Token exists but Master Key is missing. Forcing logout.');
            localStorage.removeItem('nest_token');
            localStorage.removeItem('nest_email');
            return null;
        }
        return null;
    });
    const [metadata, setMetadata] = useState<MetadataBlob | null>(null);

    // Restore metadata on mount if we have token and master key
    useEffect(() => {
        const restoreSession = async () => {
            if (token && masterKey && !metadata) {
                try {
                    console.log('[AUTH] Restoring session from localStorage...');

                    // Fetch encrypted metadata from server
                    const { authAPI } = await import('../api/auth');
                    const response = await authAPI.getMetadata();

                    if (response.encryptedMetadata && response.encryptedMetadataNonce) {
                        const { decryptMetadataBlob, fromBase64 } = await import('../crypto/v2');
                        const meta = decryptMetadataBlob(
                            fromBase64(response.encryptedMetadata),
                            fromBase64(response.encryptedMetadataNonce),
                            masterKey
                        );
                        setMetadata(meta);
                        console.log('[AUTH] Session restored successfully');
                    } else {
                        // No metadata on server, use empty
                        setMetadata({ v: 2, folders: {}, files: {} });
                    }
                } catch (e) {
                    console.error('[AUTH] Failed to restore session (metadata):', e);
                    // Do NOT logout on metadata failure, just use empty metadata
                    // logout();
                    setMetadata({ v: 2, folders: {}, files: {} });
                }
            }
        };

        restoreSession();
    }, [token, masterKey]); // Run when token or masterKey changes

    const login = async (credentials: LoginCredentials) => {
        let authHash = credentials.authHash;
        let rootKey: Uint8Array | null = null;

        // 1. If password provided, perform Client-Side Derivation
        if (credentials.password) {
            try {
                // A. Fetch Salt & Params
                const { salt, kdfParams } = await authAPI.getSalt(credentials.email);

                // B. Import Crypto
                const { deriveRootKey, deriveAuthHash, fromBase64 } = await import('../crypto/v2');

                // C. Derive Root Key & Auth Hash
                // Note: This is CPU intensive
                rootKey = await deriveRootKey(credentials.password, fromBase64(salt), JSON.parse(kdfParams));
                authHash = deriveAuthHash(rootKey);
            } catch (e) {
                console.error("ZK Login Prep Failed:", e);
                throw e;
            }
        }

        if (!authHash) throw new Error("Missing login credentials (password or hash required)");

        // 2. Authenticate
        const response = await authAPI.login({ email: credentials.email, authHash });

        setToken(response.token);
        setUser({ email: credentials.email, role: response.role });

        localStorage.setItem('nest_token', response.token);
        localStorage.setItem('nest_email', credentials.email);

        // 3. Decrypt Vault (if we have the Root Key)
        // If logged in via just AuthHash (unusual), we can't decrypt master key here.
        if (rootKey && response.encryptedMasterKey && response.encryptedMasterKeyNonce) {
            try {
                const { decryptMasterKey, deriveWrappingKey, fromBase64, decryptMetadataBlob } = await import('../crypto/v2');

                const wrappingKey = deriveWrappingKey(rootKey);
                const mk = decryptMasterKey(
                    fromBase64(response.encryptedMasterKey),
                    fromBase64(response.encryptedMasterKeyNonce),
                    wrappingKey
                );

                setMasterKey(mk);

                // Persist master key to localStorage
                localStorage.setItem('nest_master_key', btoa(String.fromCharCode(...mk)));

                // Persist Encrypted Master Key (Expected by PasswordChangeModal)
                localStorage.setItem('nest_encrypted_master_key', response.encryptedMasterKey);
                localStorage.setItem('nest_encrypted_master_key_nonce', response.encryptedMasterKeyNonce);


                // 4. Decrypt Metadata
                if (response.encryptedMetadata && response.encryptedMetadataNonce) {
                    try {
                        const meta = decryptMetadataBlob(
                            fromBase64(response.encryptedMetadata),
                            fromBase64(response.encryptedMetadataNonce),
                            mk
                        );
                        setMetadata(meta);
                    } catch (e) {
                        console.error("Metadata decryption failed:", e);
                        // Non-fatal, might be empty or corrupted, but access is secured
                        setMetadata({ v: 2, folders: {}, files: {} });
                    }
                }
            } catch (e) {
                console.error("Master Key decryption failed (Password wrong?):", e);
                // This shouldn't happen if AuthHash matched, unless DB is corrupted
                // or if we have a hash collision (unlikely)
            }
        }

        return response;
    };

    const signup = async (credentials: SignupCredentials) => {
        await authAPI.signup(credentials);
        // Auto-login after signup
        // Note: For ZK, immediate auto-login is tricky because we need to perform the login exchange/derivation
        // So we might just let the component handle it or trigger a standard login flow
        await login({ email: credentials.email, password: credentials.password! });
    };

    const saveMetadata = async (newMetadata: MetadataBlob) => {
        if (!masterKey) throw new Error('Master Key not available');

        // 1. Encrypt
        const { encryptMetadataBlob, toBase64 } = await import('../crypto/v2');
        const { encrypted, nonce } = encryptMetadataBlob(newMetadata, masterKey);

        // 2. Send to Server
        const { authAPI } = await import('../api/auth');

        await authAPI.saveMetadata({
            encryptedMetadata: toBase64(encrypted),
            encryptedMetadataNonce: toBase64(nonce),
            email: user?.email || ''
        });

        // 3. Update State
        setMetadata(newMetadata);
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        setMasterKey(null);
        setMetadata(null);
        localStorage.removeItem('nest_token');
        localStorage.removeItem('nest_email');
        localStorage.removeItem('nest_master_key');
        localStorage.removeItem('nest_encrypted_master_key');
        localStorage.removeItem('nest_encrypted_master_key_nonce');

        // Clear sensitive memory explicitly if possible (though GC handles it eventually)
        if (masterKey) {
            masterKey.fill(0);
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                token,
                login,
                signup,
                logout,
                isAuthenticated: !!token,
                masterKey,
                setMasterKey,
                metadata,
                setMetadata,
                saveMetadata
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
