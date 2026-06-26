import { useState, useEffect } from 'react';
import { Modal } from '../components/Modal';
import { Trash, ArrowUUpLeft, Info, Warning, Folder, File as FileIcon, ArrowLeft } from '@phosphor-icons/react';
import { filesAPI, type File } from '../api/files';
import { foldersAPI, type Folder as FolderType } from '../api/folders';
import { useToast } from '../contexts/ToastContext';
import { useRefresh } from '../contexts/RefreshContext';
import { useStorage } from '../contexts/StorageContext';
import { useAuth } from '../contexts/AuthContext';
import { PageLoader } from '../components/PageLoader';
import api from '../lib/api';

export const TrashPage = () => {
    const [trashFiles, setTrashFiles] = useState<File[]>([]);
    const [trashFolders, setTrashFolders] = useState<FolderType[]>([]);
    const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
    const [folderPath, setFolderPath] = useState<{ id: number, name: string }[]>([]);

    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();
    const { fileListVersion, triggerFileRefresh } = useRefresh();
    const { refreshQuota } = useStorage();
    const { metadata, masterKey } = useAuth();
    const [isDeleting, setIsDeleting] = useState(false);

    // Context drop zones for filename decryption if needed
    const [dropZones, setDropZones] = useState<any[]>([]);

    useEffect(() => {
        const loadDropZones = async () => {
            try {
                const res = await api.get('/drop-zones');
                if (res.data && res.data.success && masterKey) {
                    const { decryptDropPrivateKey, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
                    await init();
                    const decryptedDZs = res.data.drop_zones.map((dz: any) => {
                        try {
                            const privateKey = decryptDropPrivateKey(fromBase64(dz.encrypted_private_key), fromBase64(dz.private_key_nonce), masterKey);
                            return { ...dz, privateKey };
                        } catch {
                            return dz;
                        }
                    });
                    setDropZones(decryptedDZs);
                }
            } catch (err) {
                // Ignore
            }
        };
        loadDropZones();
    }, [masterKey]);

    const fetchContent = async () => {
        try {
            setLoading(true);
            if (currentFolderId === null) {
                // Root Trash View
                const filesData = await filesAPI.getTrash();
                const foldersData = await foldersAPI.getTrash();
                setTrashFiles(filesData.files);
                setTrashFolders(foldersData.folders);
            } else {
                // Nested Folder View
                const filesData = await filesAPI.list(currentFolderId);
                const foldersData = await foldersAPI.list(currentFolderId);
                setTrashFiles(filesData.files);
                setTrashFolders(foldersData.folders);
            }
        } catch (error) {
            console.error('Failed to fetch trash:', error);
            showToast('Failed to load trash items', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchContent();
    }, [fileListVersion, currentFolderId]);

    const handleRestoreFolder = async (folder: FolderType) => {
        try {
            await foldersAPI.restore(folder.id);
            showToast('Folder restored successfully', 'success');
            triggerFileRefresh();
        } catch (error) {
            console.error('Restore failed:', error);
            showToast('Failed to restore folder', 'error');
        }
    };

    const handleRestoreFile = async (file: File) => {
        try {
            if (currentFolderId === null) {
                // Individually deleted file
                await filesAPI.restore(file.id);
                showToast('File restored successfully', 'success');
            } else {
                // File inside a deleted folder -> Move to Root
                if (!metadata || !masterKey) throw new Error('Authentication required');
                const { decryptFolderKey, decryptFileKey, encryptFileKey, toBase64, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
                await init();

                const downloadInfo = await api.get(`/files/download/${file.id}`);
                const currentFolderKey = decryptFolderKey(fromBase64(downloadInfo.data.folder_key_encrypted), fromBase64(downloadInfo.data.folder_key_nonce), masterKey);
                const fileKey = decryptFileKey(fromBase64(downloadInfo.data.file_key_encrypted), fromBase64(downloadInfo.data.file_key_nonce), currentFolderKey);

                const rootKeyData = await foldersAPI.getKey(null);
                const rootFolderKey = decryptFolderKey(fromBase64(rootKeyData.key), fromBase64(rootKeyData.nonce), masterKey);
                const reencryptedFileKey = encryptFileKey(fileKey, rootFolderKey);

                await filesAPI.move(file.id, null, {
                    fileKeyEncrypted: toBase64(reencryptedFileKey.encrypted),
                    fileKeyNonce: toBase64(reencryptedFileKey.nonce)
                });
                showToast('File restored to main directory', 'success');
            }
            fetchContent();
            refreshQuota();
        } catch (error) {
            console.error('Restore failed:', error);
            showToast('Failed to restore file', 'error');
        }
    };

    const [itemToDelete, setItemToDelete] = useState<{ type: 'file' | 'folder', item: any } | null>(null);

    const handleDeleteForever = async () => {
        if (!itemToDelete) return;
        setIsDeleting(true);
        try {
            if (itemToDelete.type === 'file') {
                await filesAPI.deleteForever(itemToDelete.item.id);
                showToast('File permanently deleted', 'success');
            } else {
                await foldersAPI.deleteForever(itemToDelete.item.id);
                showToast('Folder permanently deleted', 'success');
            }
            setItemToDelete(null);
            fetchContent();
            refreshQuota();
        } catch (error) {
            console.error('Permanent delete failed:', error);
            showToast('Failed to delete permanently', 'error');
        } finally {
            setIsDeleting(false);
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const getFilename = (file: any) => {
        if (metadata?.files[file.id.toString()]) return metadata.files[file.id.toString()].filename;
        if (file.encrypted_filename && dropZones.length > 0) {
            const dz = dropZones.find(d => d.folderId === file.folder_id);
            if (dz && dz.privateKey) {
                try {
                    const sodium = (window as any).sodium;
                    if (sodium) {
                        const encryptedBytes = (window as any).nestCrypto.fromBase64(file.encrypted_filename);
                        const decrypted = sodium.crypto_box_seal_open(encryptedBytes, dz.publicKey, dz.privateKey);
                        if (decrypted) return sodium.to_string(decrypted);
                    }
                } catch {
                    return 'Encrypted File';
                }
            }
        }
        return 'Encrypted File';
    };

    const getFolderName = (folder: any) => {
        if (metadata?.folders && metadata.folders[folder.id.toString()]) return metadata.folders[folder.id.toString()].name;
        return `Folder #${folder.id}`;
    };

    const navToFolder = (folder: FolderType) => {
        setFolderPath([...folderPath, { id: folder.id, name: getFolderName(folder) }]);
        setCurrentFolderId(folder.id);
    };


    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-4 sm:p-6 md:p-8 animate-in fade-in duration-500 relative">
            <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title="Delete Forever?">
                <div className="space-y-4">
                    <div className="flex justify-center">
                        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
                            <Warning size={32} weight="fill" className="text-red-500" />
                        </div>
                    </div>
                    <div className="text-center space-y-2">
                        <p className="text-text-main font-medium">Are you sure you want to permanently delete this?</p>
                        <p className="text-sm text-text-muted">
                            <span className="font-medium text-text-main break-words">
                                "{itemToDelete ? (itemToDelete.type === 'file' ? getFilename(itemToDelete.item) : getFolderName(itemToDelete.item)) : ''}"
                            </span> will be permanently deleted.
                            <br /><span className="text-red-500 font-bold">This action cannot be undone.</span>
                        </p>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button onClick={() => setItemToDelete(null)} disabled={isDeleting} className="flex-1 px-4 py-2.5 bg-bg-secondary hover:bg-card-hover text-text-main rounded-xl font-medium transition-all">Cancel</button>
                        <button onClick={handleDeleteForever} disabled={isDeleting} className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-all">{isDeleting ? 'Deleting...' : 'Delete Forever'}</button>
                    </div>
                </div>
            </Modal>

            <div className="flex items-center justify-between mb-5 sm:mb-8">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-text-main flex items-center gap-3">
                        <Trash size={32} weight="fill" className="text-primary" /> Trash
                    </h1>
                    {currentFolderId !== null ? (
                        <div className="mt-2 flex items-center gap-2 text-sm text-text-muted">
                            <button onClick={() => { setCurrentFolderId(null); setFolderPath([]); }} className="hover:text-primary transition-colors flex items-center gap-1"><ArrowLeft size={16} /> Trash Root</button>
                            <span>/</span>
                            {folderPath.map((p, i) => (
                                <div key={p.id} className="flex items-center gap-2">
                                    <button onClick={() => {
                                        const newPath = folderPath.slice(0, i + 1);
                                        setFolderPath(newPath);
                                        setCurrentFolderId(p.id);
                                    }} className={`hover:text-primary transition-colors ${i === folderPath.length - 1 ? 'text-primary font-medium' : ''}`}>{p.name}</button>
                                    {i < folderPath.length - 1 && <span>/</span>}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-text-muted mt-1">Files are kept here for 30 days before being permanently deleted.</p>
                    )}
                </div>
            </div>

            {currentFolderId === null && (
                <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-2xl flex items-start gap-4">
                    <div className="p-2 bg-primary/10 rounded-xl text-primary mt-1"><Info size={20} weight="fill" /></div>
                    <div>
                        <h4 className="font-bold text-primary">Automatic Purge Policy</h4>
                        <p className="text-sm text-text-muted">Nest automatically purges items in the trash after 30 days. Once purged, files cannot be recovered.</p>
                    </div>
                </div>
            )}

            {loading ? <PageLoader /> : trashFiles.length === 0 && trashFolders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 glass-panel rounded-3xl border-dashed">
                    <div className="w-20 h-20 rounded-full bg-background flex items-center justify-center text-text-muted/30 mb-6"><Trash size={48} /></div>
                    <h3 className="text-xl font-bold text-text-main">Empty</h3>
                    <p className="text-text-muted mt-2">Nothing to see here.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {trashFolders.map(folder => (
                        <div key={`folder-${folder.id}`} onDoubleClick={() => navToFolder(folder)} className="glass-panel p-4 group hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 cursor-pointer">
                            <div className="flex items-start justify-between mb-4">
                                <div className="p-3 bg-primary/10 rounded-2xl text-primary"><Folder size={24} weight="fill" /></div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={(e) => { e.stopPropagation(); handleRestoreFolder(folder); }} className="p-2 hover:bg-primary/10 rounded-xl text-text-muted hover:text-primary transition-all"><ArrowUUpLeft size={20} /></button>
                                    <button onClick={(e) => { e.stopPropagation(); setItemToDelete({ type: 'folder', item: folder }); }} className="p-2 hover:bg-red-500/10 rounded-xl text-text-muted hover:text-red-500 transition-all"><Trash size={20} /></button>
                                </div>
                            </div>
                            <h3 className="font-bold text-text-main truncate">{getFolderName(folder)}</h3>
                            <div className="text-xs text-text-muted font-medium mt-1">Deleted {new Date(folder.deleted_at || Date.now()).toLocaleDateString()}</div>
                        </div>
                    ))}
                    {trashFiles.map(file => (
                        <div key={`file-${file.id}`} className="glass-panel p-4 group hover:shadow-xl hover:shadow-primary/5 transition-all duration-300">
                            <div className="flex items-start justify-between mb-4">
                                <div className="p-3 bg-primary/10 rounded-2xl text-primary"><FileIcon size={24} weight="fill" /></div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleRestoreFile(file)} className="p-2 hover:bg-primary/10 rounded-xl text-text-muted hover:text-primary transition-all"><ArrowUUpLeft size={20} /></button>
                                    <button onClick={() => setItemToDelete({ type: 'file', item: file })} className="p-2 hover:bg-red-500/10 rounded-xl text-text-muted hover:text-red-500 transition-all"><Trash size={20} /></button>
                                </div>
                            </div>
                            <h3 className="font-bold text-text-main truncate" title={getFilename(file)}>{getFilename(file)}</h3>
                            <div className="flex items-center gap-2 text-xs text-text-muted font-medium mt-1">
                                <span>{formatBytes(file.file_size)}</span>
                                <span>•</span>
                                <span>Deleted {new Date(file.deleted_at || Date.now()).toLocaleDateString()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TrashPage;
