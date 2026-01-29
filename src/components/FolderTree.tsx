import { useState, useEffect } from 'react';
import { FolderOpen, Folder, CaretRight, CaretDown } from '@phosphor-icons/react';
import { foldersAPI, type Folder as FolderType } from '../api/folders';

interface FolderTreeProps {
    onFolderSelect: (folderId: number | null) => void;
    selectedFolderId: number | null;
}

interface TreeNodeProps {
    folder: FolderType;
    level: number;
    onSelect: (folderId: number | null) => void;
    selectedFolderId: number | null;
    allFolders: FolderType[];
}

const TreeNode = ({ folder, level, onSelect, selectedFolderId, allFolders }: TreeNodeProps) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Derived children from allFolders prop
    const children = allFolders.filter(f => f.parent_id === folder.id);
    const hasChildren = children.length > 0;

    const isSelected = selectedFolderId === folder.id;

    return (
        <div>
            <button
                onClick={() => {
                    if (hasChildren) {
                        setIsExpanded(!isExpanded);
                    }
                    onSelect(folder.id);
                }}
                className={`flex items-center gap-2 rounded-lg text-sm transition-all w-full nav-item ${isSelected ? 'active' : ''}`}
                style={{ paddingLeft: `${level * 16 + 12}px` }}
            >
                {hasChildren ? (
                    <span
                        className="text-text-muted hover:text-white transition-colors cursor-pointer p-1 -ml-1"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                    >
                        {isExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                    </span>
                ) : (
                    <span className="w-5" /> // Spacer
                )}

                {isSelected ? (
                    <FolderOpen size={18} weight="fill" className="text-primary-light" />
                ) : (
                    <Folder size={18} weight="regular" className="text-text-muted group-hover:text-white transition-colors" />
                )}
                <span className="flex-1 text-left truncate">{folder.name}</span>
            </button>
            {isExpanded && hasChildren && (
                <div>
                    {children.map(child => (
                        <TreeNode
                            key={child.id}
                            folder={child}
                            level={level + 1}
                            onSelect={onSelect}
                            selectedFolderId={selectedFolderId}
                            allFolders={allFolders}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export const FolderTree = ({ onFolderSelect, selectedFolderId }: FolderTreeProps) => {
    const [folders, setFolders] = useState<FolderType[]>([]);
    const [loading, setLoading] = useState(true);

    const loadFolders = async () => {
        try {
            const response = await foldersAPI.list();
            setFolders(response.folders || []);
        } catch (error) {
            console.error('Failed to load folders:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFolders();
    }, []);

    const rootFolders = folders.filter(f => f.parent_id === null);

    if (loading) {
        return (
            <div className="p-4 text-sm text-text-muted">
                Loading folders...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full glass-panel overflow-hidden border-none text-sm">
            <div className="p-2">
                <button
                    onClick={() => onFolderSelect(null)}
                    className={`nav-item w-full ${selectedFolderId === null ? 'active' : ''}`}
                >
                    <FolderOpen size={18} weight={selectedFolderId === null ? 'fill' : 'regular'} />
                    <span>My Cloud</span>
                </button>

                <div className="mt-1 pl-2">
                    {rootFolders.map(folder => (
                        <TreeNode
                            key={folder.id}
                            folder={folder}
                            level={0}
                            onSelect={onFolderSelect}
                            selectedFolderId={selectedFolderId}
                            allFolders={folders}
                        />
                    ))}
                </div>
            </div>
            {rootFolders.length === 0 && (
                <div className="px-6 py-2 text-xs text-text-muted italic">
                    No folders
                </div>
            )}
        </div>
    );
};
