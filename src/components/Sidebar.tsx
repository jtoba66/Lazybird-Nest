import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
// Sidebar component definition
import {
    FolderOpen,
    House,
    ShareNetwork,
    GearSix,
    Shield,
    Plus,
    FileArrowUp,
    FolderPlus,
    Trash,
    X,
    Lock
} from '@phosphor-icons/react';
import clsx from 'clsx';
import { useStorage } from '../contexts/StorageContext';
import { useUpload } from '../contexts/UploadContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useQuotaCheck } from './QuotaBanner';
import nestLogo from '../assets/nest-logo.png';

interface SidebarItemProps {
    icon: any;
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick?: () => void;
}

const SidebarItem = ({ icon: Icon, label, active = false, disabled = false, onClick }: SidebarItemProps) => {
    return (
        <button
            onClick={disabled ? undefined : onClick}
            className={clsx(
                "nav-item w-full",
                active && "active",
                disabled && "opacity-40 cursor-not-allowed grayscale"
            )}
            title={disabled ? "Quota Exceeded - Feature Locked" : undefined}
        >
            <div className="relative">
                <Icon size={20} weight={active ? "fill" : "regular"} />
                {disabled && (
                    <div className="absolute -top-1 -right-1 bg-error rounded-full p-0.5 shadow-sm">
                        <Lock size={8} weight="bold" className="text-white" />
                    </div>
                )}
            </div>
            <span>{label}</span>
        </button>
    );
};

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const SIDEBAR_ITEMS = [
    { icon: House, label: 'Nest', path: '/dashboard' },
    { icon: FolderOpen, label: 'File Manager', path: '/folders' },
    { icon: ShareNetwork, label: 'Shared Links', path: '/shared' },
    { icon: Trash, label: 'Trash', path: '/trash' },
    { icon: GearSix, label: 'Settings', path: '/settings' },
];

interface SidebarProps {
    onClose?: () => void;
}

export const Sidebar = ({ onClose }: SidebarProps) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { quota, loading } = useStorage();
    const { addUpload } = useUpload();
    const { showToast } = useToast();
    const { isOverQuota } = useQuotaCheck();
    const isAdmin = user?.email === 'josephtoba29@gmail.com' || user?.role === 'admin';
    const [showNewMenu, setShowNewMenu] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    // ... existing handlers ...

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                const isGodMode = isAdmin;
                const TWO_GB = 2 * 1024 * 1024 * 1024;
                const TEN_GB = 10 * 1024 * 1024 * 1024;

                if (!isGodMode && quota.tier === 'free' && file.size > TWO_GB) {
                    showToast(`${file.name} exceeds 2GB free tier limit.`, 'error');
                } else if (quota.tier === 'pro' && file.size > TEN_GB) {
                    showToast(`${file.name} exceeds 10GB pro tier limit.`, 'error');
                } else if (isGodMode && file.size > TEN_GB) {
                    showToast(`${file.name} exceeds 10GB individual file limit.`, 'error');
                } else if (!isGodMode && file.size > TEN_GB && quota.tier !== 'pro') {
                    showToast(`${file.name} is too large.`, 'error');
                } else {
                    const searchParams = new URLSearchParams(location.search);
                    const currentFolderId = searchParams.get('folderId');
                    addUpload(file, currentFolderId ? parseInt(currentFolderId) : null);
                }
            });
        }
        setShowNewMenu(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                const isGodMode = isAdmin;
                const TWO_GB = 2 * 1024 * 1024 * 1024;
                const TEN_GB = 10 * 1024 * 1024 * 1024;

                if (!isGodMode && quota.tier === 'free' && file.size > TWO_GB) {
                    showToast(`${file.name} in folder exceeds 2GB limit.`, 'error');
                } else if (quota.tier === 'pro' && file.size > TEN_GB) {
                    showToast(`${file.name} in folder exceeds 10GB pro limit.`, 'error');
                } else if (isGodMode && file.size > TEN_GB) {
                    showToast(`${file.name} exceeds 10GB individual file limit.`, 'error');
                } else if (!isGodMode && file.size > TEN_GB && quota.tier !== 'pro') {
                    showToast(`${file.name} is too large.`, 'error');
                } else {
                    const searchParams = new URLSearchParams(location.search);
                    const currentFolderId = searchParams.get('folderId');
                    addUpload(file, currentFolderId ? parseInt(currentFolderId) : null);
                }
            });
        }
        setShowNewMenu(false);
        if (folderInputRef.current) folderInputRef.current.value = '';
    };

    // Close sidebar when navigating on mobile
    useEffect(() => {
        if (onClose) {
            onClose();
        }
    }, [location.pathname]);

    return (
        <aside className="h-full glass-panel flex flex-col py-5 md:py-6 relative">
            {/* Mobile Close Button */}
            <button
                onClick={onClose}
                className="absolute top-3 right-3 p-2 text-text-muted hover:text-text-main md:hidden z-10"
            >
                <X size={24} />
            </button>

            {/* Logo */}
            <div className="px-5 md:px-6 mb-6 md:mb-8 flex items-center gap-3">
                <div className="w-11 h-11 md:w-12 md:h-12 flex items-center justify-center">
                    <img src={nestLogo} alt="Nest Logo" className="w-full h-full object-contain mix-blend-screen scale-150" />
                </div>
                <span className="text-xl md:text-2xl font-bold tracking-tight text-text-main">LazyBird's Nest</span>
            </div>

            {/* New Button Section */}
            <div className="px-4 mb-5 md:mb-6 relative">
                <button
                    onClick={() => {
                        if (isOverQuota) {
                            showToast('Storage quota exceeded. Please upgrade to upload.', 'error');
                            return;
                        }
                        setShowNewMenu(!showNewMenu);
                    }}
                    className={clsx(
                        "flex items-center gap-3 bg-white text-text-main shadow-md transition-all px-4 md:px-6 py-2.5 md:py-3 rounded-xl md:rounded-2xl w-full font-bold group border border-white/40",
                        isOverQuota ? "opacity-50 grayscale cursor-not-allowed" : "hover:bg-background/80 hover:shadow-lg"
                    )}
                >
                    <Plus size={24} weight="bold" className={clsx("text-primary transition-transform duration-300 scale-90 md:scale-100", !isOverQuota && "group-hover:rotate-90")} />
                    <span>New</span>
                </button>

                {/* Dropdown Menu */}
                {showNewMenu && (
                    <>
                        <div
                            className="fixed inset-0 z-40"
                            onClick={() => setShowNewMenu(false)}
                        />
                        <div className="absolute top-full left-4 right-4 mt-2 bg-white/95 backdrop-blur-md border border-white/40 rounded-2xl shadow-xl z-50 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/10 text-text-main transition-colors text-left"
                            >
                                <FileArrowUp size={20} className="text-primary" />
                                <span className="font-medium text-sm">File upload</span>
                            </button>
                            <button
                                onClick={() => folderInputRef.current?.click()}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/10 text-text-main transition-colors text-left"
                            >
                                <FolderPlus size={20} className="text-primary" />
                                <span className="font-medium text-sm">Folder upload</span>
                            </button>
                        </div>
                    </>
                )}

                {/* Hidden Inputs */}
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    multiple
                    onChange={handleFileSelect}
                />
                <input
                    type="file"
                    ref={folderInputRef}
                    className="hidden"
                    onChange={handleFolderSelect}
                    {...{ webkitdirectory: "", directory: "" } as any}
                />
            </div>

            {/* Navigation */}
            <div className="flex-1 overflow-y-auto px-3 md:px-4 custom-scrollbar">
                <div className="space-y-1">
                    {SIDEBAR_ITEMS.map((item) => (
                        <SidebarItem
                            key={item.path}
                            icon={item.icon}
                            label={item.label}
                            active={location.pathname === item.path}
                            disabled={isOverQuota && item.path === '/shared'}
                            onClick={() => navigate(item.path)}
                        />
                    ))}

                    {/* Admin Link (God-mode for josephtoba29@gmail.com) */}
                    {isAdmin && (
                        <>
                            <div className="my-4 border-t border-text-muted/10 mx-2" />
                            <SidebarItem
                                icon={Shield}
                                label="Admin"
                                active={location.pathname === '/admin'}
                                onClick={() => navigate('/admin')}
                            />
                        </>
                    )}
                </div>
            </div>

            {/* Storage Widget */}
            <div className="px-4 mt-auto mb-6">
                <div className="bg-white/30 backdrop-blur-sm border border-white/40 rounded-xl md:rounded-2xl p-3 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-semibold text-text-muted capitalize">
                            {quota.tier} Plan
                        </span>
                        <span className="text-[10px] font-medium text-primary">
                            {loading ? '...' : `${formatBytes(quota.used)} / ${formatBytes(quota.quota)}`}
                        </span>
                    </div>
                    <div className="w-full h-1.5 bg-white/50 rounded-full overflow-hidden mb-3 border border-white/20">
                        <div
                            className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(118,138,150,0.5)]"
                            style={{ width: `${Math.min(quota.percentage, 100)}%` }}
                        />
                    </div>
                    <button
                        onClick={() => navigate('/pricing')}
                        className="glass-button w-full text-xs py-1.5"
                    >
                        Upgrade Storage
                    </button>
                </div>
            </div>
            {/* User Profile (Mobile/Drawer) */}
            <div className="px-4 mt-6 md:hidden">
                <div className="p-3 bg-white/30 backdrop-blur-sm border border-white/40 rounded-xl flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold text-lg">
                        {user?.email?.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs text-text-muted font-medium">Signed in as</div>
                        <div className="text-sm font-bold text-text-main truncate" title={user?.email || ''}>
                            {user?.email}
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    );
};
