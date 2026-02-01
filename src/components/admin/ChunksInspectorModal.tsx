import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { CheckCircle, Clock, Spinner, ShieldCheck, ArrowsClockwise } from '@phosphor-icons/react';
import { useToast } from '../../contexts/ToastContext';
import API_BASE_URL from '../../config/api';

interface Chunk {
    id: number;
    chunk_index: number;
    size: number;
    jackal_merkle?: string;
    is_gateway_verified: number;
    created_at: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    fileId: number | null;
    filename: string;
    source: 'files' | 'graveyard';
}

export const ChunksInspectorModal = ({ isOpen, onClose, fileId, filename, source }: Props) => {
    const [chunks, setChunks] = useState<Chunk[]>([]);
    const [loading, setLoading] = useState(true);
    const [verifyingId, setVerifyingId] = useState<number | null>(null);
    const [retryingId, setRetryingId] = useState<number | null>(null);
    const { showToast } = useToast();

    useEffect(() => {
        if (isOpen && fileId) {
            fetchChunks();
        } else {
            setChunks([]);
        }
    }, [isOpen, fileId]);

    const fetchChunks = async () => {
        if (!fileId) return;
        setLoading(true);
        try {
            const token = localStorage.getItem('nest_token');
            const endpoint = source === 'graveyard' ? `admin/graveyard/${fileId}/chunks` : `admin/files/${fileId}/chunks`;
            const res = await fetch(`${API_BASE_URL}/${endpoint}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setChunks(data);
            } else {
                showToast('Failed to load chunks', 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Failed to load chunks', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (chunk: Chunk) => {
        if (!chunk.jackal_merkle) return;
        setVerifyingId(chunk.id);
        try {
            const token = localStorage.getItem('nest_token');
            const res = await fetch(`${API_BASE_URL}/admin/chunks/${chunk.id}/verify`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (res.ok && data.verified) {
                showToast(`Chunk ${chunk.chunk_index} verified!`, 'success');
                // Update local state
                setChunks(prev => prev.map(c => c.id === chunk.id ? { ...c, is_gateway_verified: 1 } : c));
            } else {
                showToast('Verification failed: Not found on gateway', 'error');
            }

        } catch (e) {
            console.error(e);
            showToast('Verification request failed', 'error');
        } finally {
            setVerifyingId(null);
        }
    };

    const handleRetry = async (chunk: Chunk) => {
        setRetryingId(chunk.id);
        try {
            const token = localStorage.getItem('nest_token');
            const res = await fetch(`${API_BASE_URL}/admin/chunks/${chunk.id}/retry`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (res.ok && data.success) {
                showToast(`Chunk ${chunk.chunk_index} re-uploaded!`, 'success');
                // Update local state - verify needed next
                setChunks(prev => prev.map(c => c.id === chunk.id ? { ...c, jackal_merkle: data.merkle, is_gateway_verified: 0 } : c));
            } else {
                showToast(`Retry failed: ${data.error}`, 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Retry request failed', 'error');
        } finally {
            setRetryingId(null);
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizeStr = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizeStr[i];
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Inspect Chunks: ${filename}`} maxWidth="max-w-4xl">
            <div className="space-y-4">
                {loading ? (
                    <div className="flex justify-center p-8">
                        <Spinner size={32} className="animate-spin text-primary" />
                    </div>
                ) : chunks.length === 0 ? (
                    <div className="text-center p-8 text-text-muted">
                        No chunks found for this file. It might not be a chunked upload.
                    </div>
                ) : (
                    <div className="overflow-x-auto custom-scrollbar border border-white/5 rounded-lg">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white/5 uppercase text-xs font-bold text-text-muted">
                                <tr>
                                    <th className="px-4 py-3">#</th>
                                    <th className="px-4 py-3">Size</th>
                                    <th className="px-4 py-3">Merkle Hash</th>
                                    <th className="px-4 py-3">Status</th>
                                    {source === 'files' && <th className="px-4 py-3">Action</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {chunks.map(chunk => (
                                    <tr key={chunk.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-4 py-3 font-mono">{chunk.chunk_index}</td>
                                        <td className="px-4 py-3 font-mono">{formatBytes(chunk.size)}</td>
                                        <td className="px-4 py-3 font-mono text-xs max-w-[150px] truncate" title={chunk.jackal_merkle}>
                                            {chunk.jackal_merkle || '-'}
                                        </td>
                                        <td className="px-4 py-3">
                                            {chunk.is_gateway_verified ? (
                                                <span className="inline-flex items-center gap-1 text-success font-bold text-xs bg-success/10 px-2 py-0.5 rounded border border-success/20">
                                                    <CheckCircle weight="fill" /> Verified
                                                </span>
                                            ) : chunk.jackal_merkle ? (
                                                <span className="inline-flex items-center gap-1 text-warning font-bold text-xs bg-warning/10 px-2 py-0.5 rounded border border-warning/20">
                                                    <Clock weight="bold" /> Pending
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-text-muted font-bold text-xs bg-white/5 px-2 py-0.5 rounded">
                                                    Not Uploaded
                                                </span>
                                            )}
                                        </td>
                                        {source === 'files' && (
                                            <td className="px-4 py-3 flex items-center gap-2">
                                                {!chunk.is_gateway_verified && chunk.jackal_merkle && (
                                                    <button
                                                        onClick={() => handleVerify(chunk)}
                                                        disabled={verifyingId === chunk.id}
                                                        className="flex items-center gap-1.5 px-3 py-1 bg-primary/10 hover:bg-primary/20 text-text-main border border-primary/20 rounded text-xs font-bold transition-all disabled:opacity-50"
                                                    >
                                                        {verifyingId === chunk.id ? (
                                                            <Spinner className="animate-spin" />
                                                        ) : (
                                                            <ShieldCheck weight="bold" />
                                                        )}
                                                        Verify
                                                    </button>
                                                )}
                                                {!chunk.is_gateway_verified && (
                                                    <button
                                                        onClick={() => handleRetry(chunk)}
                                                        disabled={retryingId === chunk.id}
                                                        className="flex items-center gap-1.5 px-3 py-1 bg-warning/10 hover:bg-warning/20 text-warning border border-warning/20 rounded text-xs font-bold transition-all disabled:opacity-50"
                                                    >
                                                        {retryingId === chunk.id ? (
                                                            <Spinner className="animate-spin" />
                                                        ) : (
                                                            <ArrowsClockwise weight="bold" />
                                                        )}
                                                        {chunk.jackal_merkle ? 'Force Retry' : 'Retry Upload'}
                                                    </button>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Modal>
    );
};
