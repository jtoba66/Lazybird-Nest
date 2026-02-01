import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { foldersAPI, type Folder } from '../api/folders';
import { Folder as FolderIcon, MagnifyingGlass, CaretRight, CaretDown } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';

interface MoveFileModalProps {
    isOpen: boolean;
    onClose: () => void;
    onMove: (folderId: number | null) => void;
    currentFolderId?: number | null;
    isMoving?: boolean;
}

interface FolderNode extends Folder {
    children: FolderNode[];
    isExpanded: boolean;
}

export const MoveFileModal = ({
    isOpen,
    onClose,
    onMove,
    currentFolderId,
    isMoving = false,
}: MoveFileModalProps) => {
    const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
    const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const { metadata } = useAuth(); // Get metadata for folder names

    useEffect(() => {
        if (isOpen) {
            fetchFolders();
            setSearchQuery('');
        }
    }, [isOpen]);

    const fetchFolders = async () => {
        setLoading(true);
        try {
            const response = await foldersAPI.list();
            const serverFolders = response.folders || [];


            // Merge metadata names with server data
            const foldersWithNames = serverFolders.map(folder => {
                // Check if this is the root folder (parent_id is null/undefined/0)
                // Root folder should ALWAYS be named "Home", ignoring any metadata implementation details
                const isRoot = folder.parent_id === null || folder.parent_id === undefined || folder.parent_id === 0;

                if (isRoot) {
                    return { ...folder, name: 'Home' };
                }

                // Get the name from metadata first
                const metadataName = metadata?.folders[folder.id.toString()]?.name;

                return {
                    ...folder,
                    name: metadataName || `Folder ${folder.id}`
                };
            });



            // Do not filter out Root anymore. Users need to move files there.
            const visibleFolders = foldersWithNames;

            buildTree(visibleFolders);
        } catch (error) {
            console.error('Failed to fetch folders:', error);
        } finally {
            setLoading(false);
        }
    };

    const buildTree = (flatFolders: Folder[]) => {
        const folderMap = new Map<number, FolderNode>();
        const roots: FolderNode[] = [];

        // Create nodes for ALL folders
        flatFolders.forEach(folder => {
            folderMap.set(folder.id, {
                ...folder,
                children: [],
                isExpanded: false
            });
        });

        // Build tree: folders with parent_id = null are top-level
        flatFolders.forEach(folder => {
            const node = folderMap.get(folder.id)!;

            if (folder.parent_id === null) {
                // This is a top-level folder
                roots.push(node);
            } else {
                // This folder has a parent
                const parent = folderMap.get(folder.parent_id);
                if (parent) {
                    parent.children.push(node);
                } else {
                    // Parent doesn't exist, treat as orphan top-level folder
                    roots.push(node);
                }
            }
        });

        if (roots.length === 1) {
            roots[0].isExpanded = true;
        }

        setFolderTree(roots);
    };

    const toggleFolder = (folderId: number) => {
        const toggleInTree = (nodes: FolderNode[]): FolderNode[] => {
            return nodes.map(node => {
                if (node.id === folderId) {
                    return { ...node, isExpanded: !node.isExpanded };
                }
                if (node.children.length > 0) {
                    return { ...node, children: toggleInTree(node.children) };
                }
                return node;
            });
        };

        setFolderTree(toggleInTree(folderTree));
    };

    const handleSubmit = () => {
        onMove(selectedFolderId);
    };

    const renderTree = (nodes: FolderNode[], depth: number = 0) => {
        return nodes.map(node => {
            const hasChildren = node.children.length > 0;
            const isCurrentFolder = currentFolderId === node.id;
            const isSelected = selectedFolderId === node.id;

            // Filter by search
            if (searchQuery && !node.name.toLowerCase().includes(searchQuery.toLowerCase())) {
                return null;
            }

            return (
                <div key={node.id}>
                    <div
                        className={`group flex items-center gap-1 transition-all rounded-lg ${isSelected ? 'bg-primary/20 border-l-2 border-primary' : 'hover:bg-white/10'
                            }`}
                        style={{ paddingLeft: `${depth * 16 + 8}px` }}
                    >
                        {/* Expansion Toggle Hit Area */}
                        <div
                            onClick={(e) => {
                                e.stopPropagation();
                                if (hasChildren) toggleFolder(node.id);
                            }}
                            className={`w-6 h-8 flex items-center justify-center cursor-pointer transition-colors ${hasChildren ? 'hover:bg-white/20' : 'opacity-0 pointer-events-none'} rounded`}
                        >
                            {node.isExpanded ? (
                                <CaretDown size={14} weight="bold" className="text-text-muted" />
                            ) : (
                                <CaretRight size={14} weight="bold" className="text-text-muted transition-transform group-hover:scale-110" />
                            )}
                        </div>

                        {/* Selection Hit Area */}
                        <button
                            onClick={() => setSelectedFolderId(node.id)}
                            disabled={isCurrentFolder}
                            className={`flex-1 flex items-center gap-2 py-2 pr-3 text-left transition-colors ${isCurrentFolder ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                                }`}
                        >
                            <FolderIcon
                                size={18}
                                weight="duotone"
                                className={isSelected ? "text-primary" : "text-text-muted"}
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={`text-sm font-medium truncate ${isSelected ? 'text-primary' : 'text-text-main'}`}>
                                        {node.name === 'Root' ? 'Home' : node.name}
                                    </span>
                                    {(node.file_count !== undefined || node.subfolder_count !== undefined) && (
                                        <span className="text-[10px] text-text-muted shrink-0">
                                            {node.file_count || 0}f
                                            {node.subfolder_count ? `, ${node.subfolder_count}d` : ''}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </button>
                    </div>

                    {/* Render children if expanded */}
                    {hasChildren && node.isExpanded && (
                        <div className="mt-0.5">
                            {renderTree(node.children, depth + 1)}
                        </div>
                    )}
                </div>
            );
        });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Move to Folder" maxWidth="max-w-lg">
            <div className="space-y-4">
                {/* Search Bar */}
                <div className="relative">
                    <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" weight="bold" />
                    <input
                        type="text"
                        placeholder="Search folders..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white/10 border border-white/20 rounded-lg text-sm text-text-main placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <>
                        {/* Folder tree */}
                        <div className="max-h-80 overflow-y-auto custom-scrollbar space-y-0.5">
                            {folderTree.length === 0 ? (
                                <p className="text-sm text-text-muted text-center py-4">
                                    No folders available
                                </p>
                            ) : (
                                renderTree(folderTree)
                            )}
                        </div>
                    </>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={onClose}
                        disabled={isMoving}
                        className="flex-1 px-4 py-2.5 bg-bg-secondary hover:bg-card-hover text-text-main rounded-xl font-medium transition-all disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isMoving || loading || selectedFolderId === currentFolderId}
                        className="flex-1 px-4 py-2.5 bg-bg-secondary hover:bg-card-hover hover:scale-105 text-text-main rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:hover:scale-100"
                    >
                        {isMoving ? 'Moving...' : 'Move'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};
