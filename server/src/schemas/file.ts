import { z } from 'zod';

export const uploadInitSchema = z.object({
    body: z.object({
        filename: z.string().min(1),
        file_size: z.number().positive(),
        folderId: z.union([z.number(), z.null()]).optional(),
        fileKeyEncrypted: z.string().min(10),
        fileKeyNonce: z.string().min(10),
        mimeType: z.string().optional()
    })
});

export const moveFileSchema = z.object({
    body: z.object({
        folderId: z.union([z.number(), z.null()]),
        fileKeyEncrypted: z.string().optional(),
        fileKeyNonce: z.string().optional()
    })
});

export const listFilesSchema = z.object({
    query: z.object({
        folderId: z.string().optional()
    })
});
