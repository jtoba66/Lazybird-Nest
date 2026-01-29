import { z } from 'zod';

export const signupSchema = z.object({
    body: z.object({
        email: z.string().email(),
        authHash: z.string().min(10), // Base64 hash
        salt: z.string().min(10),
        encryptedMasterKey: z.string().min(10),
        encryptedMasterKeyNonce: z.string().min(10),
        encryptedMetadata: z.string().min(10),
        encryptedMetadataNonce: z.string().min(10),
        rootFolderKeyEncrypted: z.string().min(10),
        rootFolderKeyNonce: z.string().min(10),
        kdfParams: z.string() // JSON string
    })
});

export const loginSchema = z.object({
    body: z.object({
        email: z.string().email(),
        authHash: z.string().min(10)
    })
});

export const forgotPasswordSchema = z.object({
    body: z.object({
        email: z.string().email()
    })
});

export const resetPasswordSchema = z.object({
    body: z.object({
        token: z.string(),
        authHash: z.string().min(10),
        salt: z.string().min(10),
        encryptedMasterKey: z.string().min(10),
        encryptedMasterKeyNonce: z.string().min(10),
        encryptedMetadata: z.string().optional(),
        encryptedMetadataNonce: z.string().optional(),
        rootFolderKeyEncrypted: z.string().optional(),
        rootFolderKeyNonce: z.string().optional(),
        kdfParams: z.string(),
        wipeData: z.boolean().optional()
    })
});
