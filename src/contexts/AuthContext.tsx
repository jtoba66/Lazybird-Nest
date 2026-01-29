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
    login: (credentials: LoginCredentials & { rootKey?: Uint8Array }) => Promise<any>;
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
        const savedRole = localStorage.getItem('nest_role');
        return savedEmail ? { email: savedEmail, role: savedRole || 'user' } : null;
    });
    const [masterKey, setMasterKey] = useState<Uint8Array | null>(() => {
        // Try to restore master key from localStorage
        const stored = localStorage.getItem('nest_master_key');
        if (stored) {
            try {
                // Master key is stored as base64 or raw string
                if (stored.startsWith('---B64---')) {
                    // We'll restore properly in the useEffect to avoid async issues in initializer
                    return null;
                } else {
                    return Uint8Array.from(atob(stored), c => c.charCodeAt(0));
                }
            } catch (e) {
                console.error('[AUTH] Failed to restore masterKey from storage:', e);
                return null;
            }
        }

        console.log('[AUTH] No master key in storage');
        // If we have a token but no master key, we are in an inconsistent/locked state.
        // For security and UX, we should force a re-login to recover the master key.
        if (localStorage.getItem('nest_token')) {
            console.warn('[AUTH] Session Locked: Token exists but Master Key is missing. This will be restored if possible, otherwise re-login is required.');
            return null;
        }
        return null;
    });
    const [metadata, setMetadata] = useState<MetadataBlob | null>(null);

    // 1. Restore master key if possible
    useEffect(() => {
        const restoreKeys = async () => {
            if (!masterKey) {
                const stored = localStorage.getItem('nest_master_key');
                if (stored && stored.startsWith('---B64---')) {
                    try {
                        const { fromBase64 } = await import('../crypto/v2');
                        const mk = fromBase64(stored.replace('---B64---', ''));
                        setMasterKey(mk);
                    } catch (e) {
                        console.error('[AUTH] Failed to restore Master Key:', e);
                    }
                }
            }
        };
        restoreKeys();
    }, [masterKey]);

    // 2. Load metadata once masterKey and token are ready
    useEffect(() => {
        const restoreSession = async () => {
            if (token && masterKey) {
                try {
                    console.log('[AUTH] Starting metadata restoration...');

                    // Fetch encrypted metadata from server
                    const { authAPI } = await import('../api/auth');

                    // Add a timeout-like behavior or check for non-JSON responses via the interceptor
                    const response = await authAPI.getMetadata();

                    if (response && response.encryptedMetadata && response.encryptedMetadataNonce) {
                        console.log('[AUTH] Metadata received, decrypting...');
                        const { decryptMetadataBlob, fromBase64 } = await import('../crypto/v2');
                        const meta = decryptMetadataBlob(
                            fromBase64(response.encryptedMetadata),
                            fromBase64(response.encryptedMetadataNonce),
                            masterKey
                        );
                        setMetadata(meta);
                        console.log('[AUTH] Metadata restored successfully');
                    } else {
                        console.log('[AUTH] No metadata found on server, initializing empty vault');
                        setMetadata({ v: 2, folders: {}, files: {} });
                    }
                } catch (e: any) {
                    console.error('[AUTH] Metadata restoration error:', e);
                    // If it's a syntax error (unexpected HTML), log it specifically
                    if (e.message?.includes('Unexpected token')) {
                        console.error('[AUTH] Server returned HTML instead of JSON. Check VITE_API_URL.');
                    }
                    // Fallback to empty metadata so the user isn't stuck
                    setMetadata({ v: 2, folders: {}, files: {} });
                }
            } else if (token && !masterKey) {
                // Only warn if it's TRULY missing from storage too.
                // Otherwise, we are just waiting for the async restoreKeys effect to finish.
                if (!localStorage.getItem('nest_master_key')) {
                    console.warn('[AUTH] Cannot restore metadata: Master Key is missing from memory and storage.');
                }
            }
        };

        restoreSession();
    }, [token, masterKey]);

    const login = async (credentials: LoginCredentials & { rootKey?: Uint8Array }) => {
        let authHash = credentials.authHash;
        let rootKey: Uint8Array | null = credentials.rootKey || null;

        // 1. If password provided and no rootKey, perform Client-Side Derivation
        if (credentials.password && !rootKey) {
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
        localStorage.setItem('nest_role', response.role || 'user');

        // 3. Decrypt Vault (if we have the Root Key)
        // If logged in via just AuthHash (unusual), we can't decrypt master key here.
        if (rootKey && response.encryptedMasterKey && response.encryptedMasterKeyNonce) {
            try {
                const { decryptMasterKey, deriveWrappingKey, fromBase64, toBase64, decryptMetadataBlob } = await import('../crypto/v2');

                const wrappingKey = deriveWrappingKey(rootKey);
                const mk = decryptMasterKey(
                    fromBase64(response.encryptedMasterKey),
                    fromBase64(response.encryptedMasterKeyNonce),
                    wrappingKey
                );

                setMasterKey(mk);

                // Persist master key to localStorage
                const mkB64 = '---B64---' + toBase64(mk);
                localStorage.setItem('nest_master_key', mkB64);

                // Verify persistence immediately
                const verifyMeta = localStorage.getItem('nest_master_key');
                if (verifyMeta === mkB64) {
                    console.log('[AUTH] Master Key persisted correctly');
                } else {
                    console.error('[AUTH] Failed to verify Master Key persistence');
                }

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
        // 1. Generate Client-Side ZK Parameters
        const {
            deriveRootKey,
            deriveAuthHash,
            deriveWrappingKey,
            generateSalt,
            generateMasterKey,
            encryptMasterKey,
            encryptMetadataBlob,
            generateFolderKey,
            encryptFolderKey,
            toBase64
        } = await import('../crypto/v2');

        const salt = generateSalt();
        const kdfParams = { algorithm: 'argon2id' as const, memoryCost: 65536, timeCost: 3, parallelism: 4 };

        // A. Derive Root Key & Auth Hash
        // This is the heavy lifting
        if (!credentials.password) throw new Error("Password required for signup");
        const rootKey = await deriveRootKey(credentials.password, salt, kdfParams);
        const authHash = deriveAuthHash(rootKey);
        const wrappingKey = deriveWrappingKey(rootKey);

        // B. Generate Master Key
        const masterKey = generateMasterKey();
        const { encrypted: encryptedMasterKey, nonce: encryptedMasterKeyNonce } = encryptMasterKey(masterKey, wrappingKey);

        // C. Initialize Empty Metadata (Root Structure)
        const initialMetadata: MetadataBlob = { v: 2, folders: {}, files: {} };
        const { encrypted: encryptedMetadata, nonce: encryptedMetadataNonce } = encryptMetadataBlob(initialMetadata, masterKey);

        // D. Create Root Folder Key (for the actual filesystem root / )
        const rootFolderKey = generateFolderKey();
        const { encrypted: rootFolderKeyEncrypted, nonce: rootFolderKeyNonce } = encryptFolderKey(rootFolderKey, masterKey);

        // 2. Submit to API
        await authAPI.signup({
            email: credentials.email,
            authHash,
            salt: toBase64(salt),
            encryptedMasterKey: toBase64(encryptedMasterKey),
            encryptedMasterKeyNonce: toBase64(encryptedMasterKeyNonce),
            encryptedMetadata: toBase64(encryptedMetadata),
            encryptedMetadataNonce: toBase64(encryptedMetadataNonce),
            rootFolderKeyEncrypted: toBase64(rootFolderKeyEncrypted),
            rootFolderKeyNonce: toBase64(rootFolderKeyNonce),
            kdfParams: JSON.stringify(kdfParams)
        });

        // 3. Auto-login (We already have the keys, so just set state directly to avoid re-derivation)
        setToken(null); // Will be set by login response if we called it, but here we likely need to prompt login or handle it manually.
        // Actually, to keep it simple and consistent, we'll just triggers a standard login which re-verified everything against the server.
        // It adds 1s delay but ensures the server state is perfectly synced.
        await login({ email: credentials.email, password: credentials.password });
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
        localStorage.removeItem('nest_role');
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
