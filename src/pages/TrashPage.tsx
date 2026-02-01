import { useState, useEffect } from 'react';
import { Modal } from '../components/Modal';
import { Trash, ArrowUUpLeft, Clock, Info, Warning } from '@phosphor-icons/react';
import { filesAPI, type File } from '../api/files';
import { useToast } from '../contexts/ToastContext';
import { useRefresh } from '../contexts/RefreshContext';
import { useStorage } from '../contexts/StorageContext';
import { useAuth } from '../contexts/AuthContext';

export const TrashPage = () => {
    const [trashFiles, setTrashFiles] = useState<File[]>([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();
    const { fileListVersion } = useRefresh();
    const { refreshQuota } = useStorage();
    const { metadata } = useAuth();

    // Track deletion state for loading indicator
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchTrash = async () => {
        try {
            setLoading(true);
            const data = await filesAPI.getTrash();
            setTrashFiles(data.files);
        } catch (error) {
            console.error('Failed to fetch trash:', error);
            showToast('Failed to load trash items', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTrash();
    }, [fileListVersion]);

    const handleRestore = async (fileId: number) => {
        try {
            await filesAPI.restore(fileId);
            showToast('File restored successfully', 'success');
            fetchTrash();
            refreshQuota(); // Refresh storage quota
        } catch (error) {
            console.error('Restore failed:', error);
            showToast('Failed to restore file', 'error');
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const [fileToDelete, setFileToDelete] = useState<File | null>(null);

    const handleDeleteForever = async () => {
        if (!fileToDelete) return;
        setIsDeleting(true);
        try {
            await filesAPI.deleteForever(fileToDelete.id);
            showToast('File permanently deleted', 'success');
            setFileToDelete(null);
            fetchTrash();
            refreshQuota();
        } catch (error) {
            console.error('Permanent delete failed:', error);
            showToast('Failed to delete file', 'error');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="p-4 sm:p-6 md:p-8 animate-in fade-in duration-500 relative">
            {/* Delete Confirmation Modal */}
            <Modal
                isOpen={!!fileToDelete}
                onClose={() => setFileToDelete(null)}
                title="Delete Forever?"
            >
                <div className="space-y-4">
                    {/* Warning Icon */}
                    <div className="flex justify-center">
                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                            <Warning size={32} weight="fill" className="text-red-500" />
                        </div>
                    </div>

                    {/* Message */}
                    <div className="text-center space-y-2">
                        <p className="text-text-main font-medium">
                            Are you sure you want to permanently delete this file?
                        </p>
                        <p className="text-sm text-text-muted">
                            <span className="font-medium text-text-main break-words [overflow-wrap:anywhere]">
                                "{fileToDelete ? (metadata?.files[fileToDelete.id.toString()]?.filename || fileToDelete.filename) : ''}"
                            </span> will be permanently deleted.
                            <br />
                            <span className="text-red-500 font-bold">This action cannot be undone.</span>
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => setFileToDelete(null)}
                            disabled={isDeleting}
                            className="flex-1 px-4 py-2.5 bg-bg-secondary hover:bg-card-hover text-text-main rounded-xl font-medium transition-all disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDeleteForever}
                            disabled={isDeleting}
                            className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-all disabled:opacity-50 border border-red-500/20 shadow-lg shadow-red-500/10"
                        >
                            {isDeleting ? 'Deleting...' : 'Delete Forever'}
                        </button>
                    </div>
                </div>
            </Modal>

            <div className="flex items-center justify-between mb-5 sm:mb-8">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-text-main flex items-center gap-3">
                        <Trash size={32} weight="fill" className="text-primary scale-90 sm:scale-100" />
                        Trash
                    </h1>
                    <p className="text-text-muted mt-1">Files are kept here for 24 hours before being permanently deleted.</p>
                </div>
            </div>

            {/* Warning Banner */}
            <div className="mb-6 sm:mb-8 p-4 bg-primary/5 border border-primary/20 rounded-2xl flex items-start gap-4">
                <div className="p-2 bg-primary/10 rounded-xl text-primary mt-1">
                    <Info size={20} weight="fill" />
                </div>
                <div>
                    <h4 className="font-bold text-primary">Automatic Purge Policy</h4>
                    <p className="text-sm text-text-muted">
                        Nest automatically purges items in the trash after 24 hours. Once purged, files cannot be recovered as their encryption keys are wiped from the server.
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-16 sm:py-20 gap-4">
                    <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                    <p className="text-text-muted font-medium">Scanning trash...</p>
                </div>
            ) : trashFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 sm:py-32 glass-panel rounded-3xl border-dashed">
                    <div className="w-20 h-20 rounded-full bg-background flex items-center justify-center text-text-muted/30 mb-6">
                        <Trash size={48} />
                    </div>
                    <h3 className="text-xl font-bold text-text-main">Trash is empty</h3>
                    <p className="text-text-muted mt-2">Any files you delete will appear here for 24 hours.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {trashFiles.map((file) => (
                        <div key={file.id} className="glass-panel p-4 group hover:shadow-xl hover:shadow-primary/5 transition-all duration-300">

                            <div className="flex items-start justify-between mb-4">
                                <div className="p-3 bg-primary/10 rounded-2xl text-primary group-hover:scale-110 transition-transform duration-300">
                                    <Clock size={24} weight="bold" />
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => handleRestore(file.id)}
                                        className="p-2 hover:bg-primary/10 rounded-xl text-text-muted hover:text-primary transition-all flex items-center gap-2 group/btn"
                                        title="Restore"
                                    >
                                        <ArrowUUpLeft size={20} />
                                    </button>
                                    <button
                                        onClick={() => setFileToDelete(file)}
                                        className="p-2 hover:bg-red-500/10 rounded-xl text-text-muted hover:text-red-500 transition-all flex items-center gap-2 group/btn"
                                        title="Delete Permanently"
                                    >
                                        <Trash size={20} />
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <h3 className="font-bold text-text-main truncate max-w-[200px] md:max-w-none break-all" title={file.filename}>
                                    {metadata?.files[file.id.toString()]?.filename || file.filename || (file as any).original_filename || (file as any).name || `File #${file.id}`}
                                </h3>
                                <div className="flex items-center gap-2 text-xs text-text-muted font-medium">
                                    <span>{formatBytes(file.file_size)}</span>
                                    <span>•</span>
                                    <span>Deleted {new Date((file as any).deleted_at).toLocaleDateString()}</span>
                                </div>
                            </div>

                            <div className="mt-4 pt-4 border-t border-text-muted/5">
                                <span className="text-[10px] font-black uppercase tracking-widest text-text-muted/40">
                                    Permanent purge in &lt; 24h
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TrashPage;
