/**
 * Shared file-display formatters used by both the main file manager (FileTable)
 * and the collab portal, so sizes and type labels render identically everywhere.
 */

/** Human-readable file size (e.g. "293.04 MB"). Picks B/KB/MB/GB/TB by magnitude. */
export function formatBytes(bytes: number): string {
    if (!bytes || bytes < 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** Concise type label from a MIME type, falling back to the file extension. */
export function formatFileType(mimeType: string, filename: string): string {
    const mimeMap: Record<string, string> = {
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
        'application/msword': 'DOC',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
        'application/vnd.ms-excel': 'XLS',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
        'application/vnd.ms-powerpoint': 'PPT',
        'application/pdf': 'PDF',
        'application/zip': 'ZIP',
        'application/x-zip-compressed': 'ZIP',
        'application/json': 'JSON',
        'text/plain': 'TXT',
        'text/markdown': 'MD',
    };

    if (mimeType && mimeMap[mimeType]) {
        return mimeMap[mimeType];
    }

    const subtype = mimeType?.split('/')[1] || '';

    if (subtype.length > 8 || subtype.includes('vnd.') || subtype.includes('x-')) {
        const ext = filename.split('.').pop();
        if (ext && ext !== filename) {
            return ext.toUpperCase();
        }
    }

    const cleanSubtype = subtype.toUpperCase();
    return cleanSubtype.length > 12 ? cleanSubtype.substring(0, 12) + '...' : cleanSubtype;
}
