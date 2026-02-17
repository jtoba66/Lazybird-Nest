import { AnalyticsDashboard } from '../components/admin/AnalyticsDashboard';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Users, HardDrives, Database, ArrowsClockwise, Trash, CloudCheck, Warning, CheckCircle, Clock, Spinner, MagnifyingGlass } from '@phosphor-icons/react';
import { useToast } from '../contexts/ToastContext';
import API_BASE_URL from '../config/api';
import { ChunksInspectorModal } from '../components/admin/ChunksInspectorModal';
import { PageLoader } from '../components/PageLoader';

interface SystemMetrics {
    memory: {
        total: number;
        free: number;
        used: number;
        usedPercent: number;
    };
    uptime: number;
    load: number[];
    database: {
        totalFiles: number;
        totalUsers: number;
        totalFolders: number;
        totalStorage: number;
    };
}

interface FileRecord {
    id: number;
    user_email: string;
    storage_id: string;
    file_size: number;
    jackal_fid: string;
    merkle_hash: string;
    jackal_status: 'pending' | 'verifying' | 'uploaded';
    can_retry: boolean;
    encrypted_file_path?: string;
    created_at: string;
    folder_id: number | null;
    is_chunked?: number;
    chunk_progress?: {
        total: number;
        verified: number;
        verifying: number;
        pending: number;
    } | null;
    retry_count?: number;
    failure_reason?: string;
    storage_type?: 'single' | 'blob';
    type?: 'soft' | 'permanent';
}

interface UserRecord {
    id: number;
    email: string;
    created_at: string;
    storage_used_bytes: number;
    storage_quota_bytes: number;
    file_count: number;
    folder_count: number;
    is_banned: number;
    subscription_tier: string;
}

interface Analytics {
    jackal: {
        total: number;
        active: number;
        pending: number;
        graveyard: number;
        uploadRate?: number; // Optional now, or remove if not sent
    };
    recent: {
        uploads24h: number;
    };
}

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState<'overview' | 'insights' | 'files' | 'users' | 'failed' | 'graveyard'>('overview');
    const [system, setSystem] = useState<SystemMetrics | null>(null);
    const [files, setFiles] = useState<FileRecord[]>([]);
    const [inspectFile, setInspectFile] = useState<{ id: number, name: string, source: 'files' | 'graveyard' } | null>(null);
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [analytics, setAnalytics] = useState<Analytics | null>(null);
    const [failedFiles, setFailedFiles] = useState<FileRecord[]>([]);
    const [graveyardFiles, setGraveyardFiles] = useState<any[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    const navigate = useNavigate();
    const { showToast } = useToast();

    const handleBanUser = async (userId: number) => {
        try {
            const token = localStorage.getItem('nest_token');
            const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/ban`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_banned: data.is_banned } : u));
                showToast(data.is_banned ? 'User banned' : 'User unbanned', 'success');
            } else {
                showToast('Failed to update ban status', 'error');
            }
        } catch (err: any) {
            showToast(err.message, 'error');
        }
    };

    const handleToggleTier = async (userId: number) => {
        try {
            const token = localStorage.getItem('nest_token');
            const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/tier`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, subscription_tier: data.tier, storage_quota_bytes: data.quota } : u));
                showToast(`User moved to ${data.tier.toUpperCase()}`, 'success');
            } else {
                showToast('Failed to toggle tier', 'error');
            }
        } catch (err: any) {
            showToast(err.message, 'error');
        }
    };

    const handlePurgeUser = async (userId: number, email: string) => {
        if (!confirm(`Are you SURE you want to purge all files for ${email}? This will move them to the Graveyard and reset their usage to 0.`)) return;

        try {
            const token = localStorage.getItem('nest_token');
            const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/purge`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                showToast(`Successfully purged ${data.purged_count} files to Graveyard`, 'success');
                fetchAllData(); // Refresh all stats
            } else {
                showToast('Failed to purge user files', 'error');
            }
        } catch (err: any) {
            showToast(err.message, 'error');
        }
    };

    const handlePruneGraveyard = async (graveId: number) => {
        if (!confirm('Are you SURE you want to prune this file? This will permanently remove it from Jackal network (simulate) and update history.')) return;

        try {
            const token = localStorage.getItem('nest_token');
            const res = await fetch(`${API_BASE_URL}/admin/graveyard/${graveId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                showToast('File pruned from network', 'success');
                // Remove locally to avoid reload
                setGraveyardFiles(prev => prev.filter(f => f.id !== graveId));
                // Refresh analytics to show the Drop
                setTimeout(fetchAllData, 1000);
            } else {
                showToast('Failed to prune file', 'error');
            }
        } catch (err: any) {
            showToast(err.message, 'error');
        }
    };

    const fetchAllData = async () => {
        try {
            const token = localStorage.getItem('nest_token');
            if (!token) {
                navigate('/login');
                return;
            }

            const headers = { 'Authorization': `Bearer ${token}` };
            const apiUrl = API_BASE_URL;

            const [systemRes, filesRes, usersRes, analyticsRes, failedRes, graveyardRes] = await Promise.all([
                fetch(`${apiUrl}/admin/system`, { headers }),
                fetch(`${apiUrl}/admin/files`, { headers }),
                fetch(`${apiUrl}/admin/users`, { headers }),
                fetch(`${apiUrl}/admin/analytics`, { headers }),
                fetch(`${apiUrl}/admin/failed-uploads`, { headers }),
                fetch(`${apiUrl}/admin/graveyard`, { headers })
            ]);

            const responses = [systemRes, filesRes, usersRes, analyticsRes, failedRes, graveyardRes];
            const failedResponse = responses.find(r => !r.ok);

            if (failedResponse) {
                if (failedResponse.status === 403) {
                    setError('Access denied. Admin privileges required.');
                } else {
                    const errorText = await failedResponse.text();
                    console.error('[ADMIN] API Error:', failedResponse.status, errorText.substring(0, 100));
                    setError(`Server error (${failedResponse.status}): ${failedResponse.statusText}`);
                }
                setLoading(false);
                return;
            }

            const systemData = await systemRes.json();
            const filesData = await filesRes.json();
            const usersData = await usersRes.json();
            const analyticsData = await analyticsRes.json();
            const failedData = await failedRes.json();
            const graveyardData = await graveyardRes.json();

            setSystem(systemData);
            setFiles(filesData);
            setUsers(usersData);
            setAnalytics(analyticsData);
            setFailedFiles(failedData);
            setGraveyardFiles(graveyardData);
            setLoading(false);
        } catch (err: any) {
            console.error('[ADMIN] Fetch error:', err);
            setError(err.message);
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAllData();
        const interval = setInterval(fetchAllData, 10000); // Refresh every 10s
        return () => clearInterval(interval);
    }, []);

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatUptime = (seconds: number) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${days}d ${hours}h ${minutes}m`;
    };

    const handleRetryUpload = async (fileId: number) => {
        try {
            const token = localStorage.getItem('nest_token');
            if (!token) return;

            showToast('Retrying upload to Jackal...', 'info');

            const response = await fetch(`${API_BASE_URL}/admin/files/${fileId}/retry-upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (response.ok) {
                const message = data.queued
                    ? 'Retry queued successfully (processing in background)'
                    : 'Retry successful! File uploaded to Jackal';

                showToast(message, 'success');
                // Don't refresh immediately if queued, better to let user refresh manually or wait for auto-refresh
                setTimeout(fetchAllData, 2000);
            } else {
                showToast(`Retry failed: ${data.error}`, 'error');
            }
        } catch (err: any) {
            console.error('[ADMIN] Retry error:', err);
            showToast(`Retry failed: ${err.message}`, 'error');
        }
    };

    const handleBulkRetry = async () => {
        try {
            const token = localStorage.getItem('nest_token');
            if (!token) return;

            const failedCount = files.filter(f => f.can_retry).length;
            if (failedCount === 0) {
                showToast('No files need retry', 'info');
                return;
            }

            if (!confirm(`Retry ${failedCount} failed uploads?`)) return;

            showToast(`Queuing ${failedCount} files for retry...`, 'info');

            const response = await fetch(`${API_BASE_URL}/admin/retry-all-failed`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (response.ok) {
                showToast(`Successfully queued ${data.queued} files for retry`, 'success');
                setTimeout(fetchAllData, 2000);
            } else {
                showToast(`Bulk retry failed: ${data.error}`, 'error');
            }
        } catch (err: any) {
            console.error('[ADMIN] Bulk retry error:', err);
            showToast(`Bulk retry failed: ${err.message}`, 'error');
        }
    };

    if (error) {
        return (
            <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4 sm:p-6">
                <div className="bg-card border border-error/20 rounded-2xl p-6 sm:p-8 max-w-md text-center">
                    <Warning size={48} weight="duotone" className="text-error mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-error mb-2">Access Denied</h2>
                    <p className="text-text-muted mb-4">{error}</p>
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="btn-secondary"
                    >
                        Return to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    if (loading) {
        return <PageLoader />;
    }

    return (
        <div className="min-h-[100dvh] text-text-main overflow-hidden relative">
            {/* Background */}
            <div className="fixed inset-0 pointer-events-none -z-50">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px]" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-secondary/5 rounded-full blur-[120px]" />
            </div>

            {/* Header */}
            <div className="border-b border-white/10 glass-panel square-corners sticky top-0 z-40 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                                <Shield size={28} weight="duotone" className="text-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
                                <p className="text-sm text-text-muted">System monitoring & management</p>
                            </div>
                        </div>
                        <button
                            onClick={() => navigate('/dashboard')}
                            className="glass-button px-4 py-2 text-sm"
                        >
                            Back to Dashboard
                        </button>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-white/10 bg-white/5 backdrop-blur-sm sticky top-[97px] z-30">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="flex gap-2 overflow-x-auto custom-scrollbar">
                        {[
                            { id: 'overview', label: 'Overview' },
                            { id: 'insights', label: 'Insights' },
                            { id: 'files', label: 'Files' },
                            { id: 'users', label: 'Users' },
                            { id: 'failed', label: 'Failed Uploads' },
                            { id: 'graveyard', label: 'Graveyard' }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`px-5 py-4 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${activeTab === tab.id
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-text-muted hover:text-text-main hover:bg-white/5'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
                {/* INSIGHTS TAB */}
                {activeTab === 'insights' && (
                    <AnalyticsDashboard />
                )}

                {/* OVERVIEW TAB */}
                {activeTab === 'overview' && (
                    <div className="space-y-6">
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <div className="glass-panel p-6 flex flex-col justify-between">
                                <div className="flex items-center gap-3 mb-2">
                                    <Database size={20} className="text-primary" />
                                    <span className="text-xs uppercase tracking-wider text-text-muted font-bold">Total Blobs</span>
                                </div>
                                <div className="text-2xl sm:text-3xl font-bold font-mono">{system?.database.totalFiles || 0}</div>
                            </div>

                            <div className="glass-panel p-6 flex flex-col justify-between">
                                <div className="flex items-center gap-3 mb-2">
                                    <Users size={20} className="text-secondary" />
                                    <span className="text-xs uppercase tracking-wider text-text-muted font-bold">Total Users</span>
                                </div>
                                <div className="text-2xl sm:text-3xl font-bold font-mono">{system?.database.totalUsers || 0}</div>
                            </div>

                            <div className="glass-panel p-6 flex flex-col justify-between">
                                <div className="flex items-center gap-3 mb-2">
                                    <HardDrives size={20} className="text-warning" />
                                    <span className="text-xs uppercase tracking-wider text-text-muted font-bold">Total Storage</span>
                                </div>
                                <div className="text-2xl sm:text-3xl font-bold font-mono">{formatBytes(system?.database.totalStorage || 0)}</div>
                            </div>

                            <div className="glass-panel p-6 flex flex-col justify-between">
                                <div className="flex items-center gap-3 mb-2">
                                    <Clock size={20} className="text-success" />
                                    <span className="text-xs uppercase tracking-wider text-text-muted font-bold">24h Uploads</span>
                                </div>
                                <div className="text-2xl sm:text-3xl font-bold font-mono">{analytics?.recent.uploads24h?.toLocaleString() || 0}</div>
                            </div>
                        </div>

                        {/* Jackal Statistics */}
                        {analytics && (
                            <div className="glass-panel p-6">
                                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                    <CloudCheck size={20} className="text-primary" />
                                    Managed Blob Overview
                                </h3>

                                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                                    <div className="bg-background-dark/50 p-4 rounded-xl">
                                        <div className="text-sm text-text-muted mb-1">Total Network Footprint</div>
                                        <div className="text-2xl font-bold font-mono text-white">
                                            {analytics.jackal.total.toLocaleString()}
                                        </div>
                                    </div>

                                    <div className="bg-background-dark/50 p-4 rounded-xl border-l-2 border-success">
                                        <div className="text-sm text-text-muted mb-1">Active (Secured)</div>
                                        <div className="text-2xl font-bold font-mono text-success">
                                            {analytics.jackal.active.toLocaleString()}
                                        </div>
                                    </div>

                                    <div className="bg-background-dark/50 p-4 rounded-xl border-l-2 border-warning">
                                        <div className="text-sm text-text-muted mb-1">Pending / Failed</div>
                                        <div className="text-2xl font-bold font-mono text-warning">
                                            {analytics.jackal.pending.toLocaleString()}
                                        </div>
                                    </div>

                                    <div className="bg-background-dark/50 p-4 rounded-xl border-l-2 border-danger">
                                        <div className="text-sm text-text-muted mb-1">Graveyard</div>
                                        <div className="text-2xl font-bold font-mono text-danger">
                                            {analytics.jackal.graveyard.toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}


                        {/* System Health */}
                        {system && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="glass-panel p-6">
                                    <h3 className="text-lg font-bold mb-4">Memory Usage</h3>
                                    <div className="space-y-4">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-text-muted">Used</span>
                                            <span className="font-mono">{formatBytes(system.memory.used)}</span>
                                        </div>
                                        <div className="h-3 bg-white/10 rounded-full overflow-hidden border border-white/5">
                                            <div
                                                className={`h-full transition-all ${system.memory.usedPercent > 90 ? 'bg-error' :
                                                    system.memory.usedPercent > 70 ? 'bg-warning' : 'bg-success'
                                                    }`}
                                                style={{ width: `${system.memory.usedPercent}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-xs text-text-muted">
                                            <span>{system.memory.usedPercent}% used</span>
                                            <span>Total: {formatBytes(system.memory.total)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="glass-panel p-6">
                                    <h3 className="text-lg font-bold mb-4">System Info</h3>
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-sm py-2 border-b border-white/5">
                                            <span className="text-text-muted">Uptime</span>
                                            <span className="font-mono">{formatUptime(system.uptime)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm py-2 border-b border-white/5">
                                            <span className="text-text-muted">Load Average</span>
                                            <span className="font-mono">{system.load[0].toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm py-2">
                                            <span className="text-text-muted">Folders</span>
                                            <span className="font-mono">{system.database.totalFolders}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* FILES TAB */}
                {activeTab === 'files' && (
                    <div className="glass-panel overflow-hidden">
                        <div className="p-4 border-b border-white/10 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold">All Files</h3>
                                <p className="text-sm text-text-muted">Manage all uploaded files and retry failed uploads</p>
                            </div>
                            <button
                                onClick={handleBulkRetry}
                                className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-sm font-bold transition-colors"
                            >
                                <ArrowsClockwise size={16} weight="bold" />
                                Retry All Failed
                            </button>
                        </div>
                        <div className="overflow-x-auto custom-scrollbar">
                            <table className="w-full">
                                <thead className="bg-white/5 border-b border-white/10">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">ID</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">User</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Jackal Storage Key</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Type</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Size</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Jackal Status</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Actions</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Created</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {files.map((file) => (
                                        <tr key={file.id} className="hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-4 text-sm font-mono text-text-muted">#{file.id}</td>
                                            <td className="px-6 py-4 text-sm font-medium">{file.user_email}</td>
                                            <td className="px-6 py-4 text-sm font-mono text-primary truncate max-w-[200px]" title={file.storage_id}>{file.storage_id}</td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${file.storage_type === 'blob' ? 'bg-secondary/20 text-secondary border border-secondary/30 shadow-[0_0_8px_rgba(var(--color-secondary-rgb),0.2)]' : 'bg-primary/10 text-primary border border-primary/20'}`}>
                                                    {file.storage_type || 'single'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm font-mono">{formatBytes(file.file_size)}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1">
                                                    {file.jackal_status === 'uploaded' ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-success/10 border border-success/20 text-success rounded text-xs font-bold uppercase w-fit">
                                                            <CheckCircle size={12} weight="fill" />
                                                            Uploaded
                                                        </span>
                                                    ) : file.jackal_status === 'verifying' ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-warning/10 border border-warning/20 text-warning rounded text-xs font-bold uppercase w-fit">
                                                            <Spinner size={12} weight="bold" className="animate-spin" />
                                                            Verifying
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 border border-primary/20 text-primary rounded text-xs font-bold uppercase w-fit">
                                                            <Clock size={12} weight="bold" />
                                                            Pending
                                                        </span>
                                                    )}
                                                    {file.chunk_progress && (
                                                        <span className="text-xs text-text-muted font-mono">
                                                            {file.chunk_progress.verified}/{file.chunk_progress.total} chunks
                                                        </span>
                                                    )}
                                                    {file.retry_count && file.retry_count > 0 && (
                                                        <span className="text-xs text-warning font-mono">
                                                            Retry {file.retry_count}/3
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    {file.can_retry && (
                                                        <button
                                                            onClick={() => handleRetryUpload(file.id)}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-xs font-bold transition-colors"
                                                            title="Retry Upload"
                                                        >
                                                            <ArrowsClockwise size={14} weight="bold" />
                                                            Retry
                                                        </button>
                                                    )}

                                                    {/* Inspect Button - Always visible for chunked files or just all files */}
                                                    <button
                                                        onClick={() => setInspectFile({ id: file.id, name: file.storage_id, source: 'files' })}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg text-xs font-bold transition-colors"
                                                        title="Inspect Chunks"
                                                    >
                                                        <MagnifyingGlass size={14} weight="bold" />
                                                        Inspect
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-text-muted">
                                                {new Date(file.created_at).toLocaleDateString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* USERS TAB */}
                {activeTab === 'users' && (
                    <div className="glass-panel overflow-hidden">
                        <div className="overflow-x-auto custom-scrollbar">
                            <table className="w-full">
                                <thead className="bg-white/5 border-b border-white/10">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">ID</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Email</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Status</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Plan</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Files</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Storage</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Actions</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Joined</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {users.map((user) => (
                                        <tr key={user.id} className="hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-4 text-sm font-mono text-text-muted">#{user.id}</td>
                                            <td className="px-6 py-4 text-sm font-medium">{user.email}</td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${user.is_banned ? 'bg-error/20 text-error border border-error/30' : 'bg-success/10 text-success border border-success/20'}`}>
                                                    {user.is_banned ? 'Banned' : 'Active'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${user.subscription_tier === 'pro' ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-white/10 text-text-muted border border-white/10'}`}>
                                                    {user.subscription_tier || 'free'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm font-mono">{user.file_count}</td>
                                            <td className="px-6 py-4 text-sm font-mono">
                                                <div className="flex flex-col">
                                                    <span>{formatBytes(user.storage_used_bytes)}</span>
                                                    <span className="text-[10px] text-text-muted">of {formatBytes(user.storage_quota_bytes)}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleBanUser(user.id)}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${user.is_banned
                                                            ? 'bg-success/10 hover:bg-success/20 text-success border-success/30'
                                                            : 'bg-error/10 hover:bg-error/20 text-error border-error/30'}`}
                                                    >
                                                        {user.is_banned ? 'Unban' : 'Ban User'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleToggleTier(user.id)}
                                                        className="px-3 py-1.5 bg-error/10 hover:bg-error/20 text-error border border-error/30 rounded-lg text-xs font-bold transition-all shadow-[0_0_10px_rgba(var(--color-error-rgb),0.1)] hover:shadow-[0_0_15px_rgba(var(--color-error-rgb),0.2)]"
                                                    >
                                                        {user.subscription_tier === 'pro' ? 'Make Free' : 'Make Pro'}
                                                    </button>
                                                    {user.storage_used_bytes > user.storage_quota_bytes && (
                                                        <button
                                                            onClick={() => handlePurgeUser(user.id, user.email)}
                                                            className="px-3 py-1.5 bg-error text-white hover:bg-error/90 rounded-lg text-xs font-bold transition-all shadow-lg shadow-error/20 flex items-center gap-1.5"
                                                            title="User is over quota - Move all files to graveyard"
                                                        >
                                                            <Trash size={14} weight="bold" />
                                                            Purge
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-text-muted">
                                                {new Date(user.created_at).toLocaleDateString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* FAILED UPLOADS TAB */}
                {activeTab === 'failed' && (
                    <div className="glass-panel overflow-hidden">
                        <div className="p-6 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <Warning size={24} className="text-error" />
                                <div>
                                    <h2 className="text-lg font-bold">Failed Jackal Uploads</h2>
                                    <p className="text-sm text-text-muted">Files that failed to upload to Jackal storage - require user re-upload</p>
                                </div>
                            </div>
                        </div>

                        {failedFiles.length === 0 ? (
                            <div className="p-8 sm:p-16 text-center">
                                <CheckCircle size={48} className="text-success mx-auto mb-4" />
                                <p className="text-text-muted">No failed uploads - all files successfully stored!</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto custom-scrollbar">
                                <table className="w-full">
                                    <thead className="bg-white/5 border-b border-white/10">
                                        <tr>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">ID</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">User</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Jackal Storage Key</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Type</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Size</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Actions</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Created</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {failedFiles.map((file) => (
                                            <tr key={file.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4 text-sm font-mono text-text-muted">#{file.id}</td>
                                                <td className="px-6 py-4 text-sm font-medium">{file.user_email}</td>
                                                <td className="px-6 py-4 text-sm font-mono text-error break-all">{file.storage_id}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${file.storage_type === 'blob' ? 'bg-secondary/20 text-secondary border border-secondary/30 shadow-[0_0_8px_rgba(var(--color-secondary-rgb),0.2)]' : 'bg-primary/10 text-primary border border-primary/20'}`}>
                                                        {file.storage_type || 'single'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-sm font-mono">{formatBytes(file.file_size)}</td>
                                                <td className="px-6 py-4 text-sm">
                                                    {file.encrypted_file_path ? (
                                                        <button
                                                            onClick={() => handleRetryUpload(file.id)}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-xs font-bold transition-colors"
                                                        >
                                                            <ArrowsClockwise size={14} weight="bold" />
                                                            Retry Upload
                                                        </button>
                                                    ) : (
                                                        <span className="text-xs text-text-muted italic">No file to retry (re-upload needed)</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-text-muted">
                                                    {new Date(file.created_at).toLocaleDateString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* GRAVEYARD TAB */}
                {activeTab === 'graveyard' && (
                    <div className="glass-panel overflow-hidden">
                        <div className="p-6 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <Trash size={24} className="text-warning" />
                                <div>
                                    <h2 className="text-lg font-bold">File Graveyard</h2>
                                    <p className="text-sm text-text-muted">Deleted files still on Jackal storage - manual cleanup required</p>
                                </div>
                            </div>
                        </div>

                        {graveyardFiles.length === 0 ? (
                            <div className="p-6 sm:p-12 text-center">
                                <CheckCircle size={48} className="text-success mx-auto mb-4" />
                                <p className="text-text-muted">Graveyard is empty - no deleted files on Jackal!</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-background/50 border-b border-border">
                                        <tr>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">ID</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">User</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Jackal Storage Key</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Type</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Size</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Actions</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Deleted</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {graveyardFiles.map((file) => (
                                            <tr key={file.id} className="hover:bg-background/30 transition-colors">
                                                <td className="px-6 py-4 text-sm font-mono text-text-muted">#{file.id}</td>
                                                <td className="px-6 py-4 text-sm font-medium">{file.user_email}</td>
                                                <td className="px-6 py-4 text-sm font-mono text-primary break-all">{file.storage_id}</td>
                                                <td className="px-6 py-4 text-sm">
                                                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${file.storage_type === 'blob' ? 'bg-secondary/20 text-secondary border border-secondary/30 shadow-[0_0_8px_rgba(var(--color-secondary-rgb),0.2)]' : 'bg-primary/10 text-primary border border-primary/20'}`}>
                                                        {file.storage_type || 'single'}
                                                        {file.is_chunked ? ` (${file.chunk_count} chunks)` : ''}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-sm font-mono">{formatBytes(file.file_size)}</td>
                                                <td className="px-6 py-4">
                                                    {(file.storage_type === 'blob' || file.is_chunked === 1 || file.is_chunked === true) && (
                                                        <button
                                                            onClick={() => setInspectFile({ id: file.id, name: file.storage_id, source: file.type === 'permanent' ? 'graveyard' : 'files' })}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg text-xs font-bold transition-colors"
                                                            title="Inspect Chunks"
                                                        >
                                                            <MagnifyingGlass size={14} weight="bold" />
                                                            Inspect
                                                        </button>
                                                    )}

                                                    <button
                                                        onClick={() => handlePruneGraveyard(file.id)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-error/10 hover:bg-error/20 text-error border border-error/30 rounded-lg text-xs font-bold transition-colors"
                                                        title="Permanently Prune from Jackal"
                                                    >
                                                        <Trash size={14} weight="bold" />
                                                        Prune
                                                    </button>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-text-muted">
                                                    {file.deleted_at ? new Date(file.deleted_at).toLocaleDateString() : 'Unknown'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Chunk Inspector Modal */}
            {
                inspectFile && (
                    <ChunksInspectorModal
                        isOpen={!!inspectFile}
                        onClose={() => setInspectFile(null)}
                        fileId={inspectFile.id}
                        filename={inspectFile.name}
                        source={inspectFile.source}
                    />
                )
            }
        </div >
    );
}
