import { useState, useEffect } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { CloudCheck, HardDrives, Lightning } from '@phosphor-icons/react';
import API_BASE_URL from '../../config/api';
import { UserGrowthChart } from './UserGrowthChart';

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-background/90 border border-white/10 p-3 rounded-lg shadow-xl backdrop-blur-md">
                <p className="text-text-muted text-xs mb-1">{new Date(label).toLocaleString()}</p>
                <p className="text-primary font-bold font-mono">
                    {formatBytes(payload[0].value)}
                </p>
                <p className="text-text-muted text-[10px]">Total Managed Storage</p>
            </div>
        );
    }
    return null;
};

const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
};

export const AnalyticsDashboard = () => {
    const [history, setHistory] = useState<any[]>([]);
    const [pulse, setPulse] = useState<any[]>([]);
    const [range, setRange] = useState('7d');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchPulse, 5000); // Live pulse update
        return () => clearInterval(interval);
    }, [range]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('nest_token');
            const headers = { 'Authorization': `Bearer ${token}` };

            const histRes = await fetch(`${API_BASE_URL}/admin/analytics/history?range=${range}`, { headers });
            const histData = await histRes.json();

            if (Array.isArray(histData)) {
                setHistory(histData);
            } else {
                setHistory([]);
            }

            await fetchPulse();
        } catch (err) {
            console.error('Analytics Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchPulse = async () => {
        try {
            const token = localStorage.getItem('nest_token');
            const res = await fetch(`${API_BASE_URL}/admin/analytics/pulse`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (Array.isArray(data)) {
                setPulse(data);
            }
        } catch (e) { console.error(e); }
    };

    // Derive pulse stats
    const pulseFileCount = pulse.filter(p => p.type === 'file').length;
    const pulseChunkCount = pulse.filter(p => p.type === 'chunk').length;
    const pulseTotalBytes = pulse.reduce((acc, p) => acc + (p.size || 0), 0);

    // Current storage headline from last history data point
    const currentStorage = history.length > 0 ? history[history.length - 1].bytes : 0;

    if (loading && history.length === 0 && pulse.length === 0) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="glass-panel p-6 h-[400px] flex items-center justify-center">
                    <div className="text-text-muted">Loading analytics...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* 1. Storage Growth Chart */}
            <div className="glass-panel p-6">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h3 className="text-lg font-bold flex items-center gap-2">
                            <HardDrives className="text-primary" size={24} weight="duotone" />
                            Network Storage Growth
                        </h3>
                        <p className="text-sm text-text-muted">Data volume added to the decentralized network</p>
                    </div>
                    <div className="flex bg-white/5 rounded-lg p-1">
                        {['24h', '7d', '30d'].map(r => (
                            <button
                                key={r}
                                onClick={() => setRange(r)}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${range === r ? 'bg-primary text-black' : 'text-text-muted hover:text-white'
                                    }`}
                            >
                                {r.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Headline Stat */}
                <div className="mb-4">
                    <span className="text-3xl font-bold font-mono text-text-main">{formatBytes(currentStorage, 1)}</span>
                    <span className="text-xs text-text-muted ml-2">Total Managed Storage</span>
                </div>

                <div className="h-[300px] w-full relative">
                    {history.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center text-text-muted/50 text-sm">
                            Not enough data to display growth chart
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                            <AreaChart data={history} margin={{ left: 30, right: 30, top: 20, bottom: 40 }}>
                                <defs>
                                    <linearGradient id="colorStorage" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={true} vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(str) => {
                                        const date = new Date(str);
                                        if (range === '24h') {
                                            return date.toLocaleTimeString([], { hour: 'numeric', hour12: true });
                                        }
                                        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                    }}
                                    stroke="#94a3b8"
                                    tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }}
                                    minTickGap={20}
                                    tickLine={{ stroke: '#94a3b8' }}
                                    axisLine={{ stroke: '#94a3b8' }}
                                />
                                <YAxis
                                    stroke="#94a3b8"
                                    tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }}
                                    tickFormatter={(val) => formatBytes(val, 1)}
                                    width={90}
                                    tickLine={{ stroke: '#94a3b8' }}
                                    axisLine={{ stroke: '#94a3b8' }}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />
                                <Area
                                    type="monotone"
                                    dataKey="bytes"
                                    stroke="var(--color-primary)"
                                    fillOpacity={1}
                                    fill="url(#colorStorage)"
                                    strokeWidth={2}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* 2. User Growth Chart */}
            <UserGrowthChart />

            {/* 3. Network Pulse (Live Feed) */}
            <div className="glass-panel p-6 overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <Lightning className="text-secondary" size={24} weight="duotone" />
                        Network Pulse
                    </h3>
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-secondary"></span>
                        </span>
                        <span className="text-xs font-mono text-secondary">LIVE</span>
                    </div>
                </div>

                {/* Horizontal Scrolling Ticker */}
                <div className="relative w-full overflow-hidden mask-linear-fade">
                    <div className="flex gap-3 animate-scroll-left w-max">
                        {pulse.map((item, i) => {
                            const isPending = !item.hash || item.hash === 'pending' || (typeof item.hash === 'string' && item.hash.includes('pending'));
                            return (
                                <div
                                    key={i}
                                    className={`flex items-center gap-3 px-4 py-2 border rounded-full whitespace-nowrap ${isPending
                                        ? 'bg-yellow-500/10 border-yellow-500/20'
                                        : 'bg-white/5 border-white/5'
                                        }`}
                                >
                                    {isPending ? (
                                        <Lightning size={16} className="text-yellow-500 animate-pulse" weight="fill" />
                                    ) : (
                                        <CloudCheck size={16} className="text-success" weight="fill" />
                                    )}
                                    <span className={`font-mono text-xs ${isPending ? 'text-yellow-200' : 'text-text-muted'}`}>
                                        {isPending ? 'Uploading...' : `${item.storage_id?.substring(0, 16) || '???'}...`}
                                    </span>
                                    <span className="text-xs font-bold text-text-main">
                                        {formatBytes(item.size)}
                                    </span>
                                    <span className="text-[10px] text-white/30">
                                        {new Date(item.created_at).toLocaleTimeString()}
                                    </span>
                                </div>
                            );
                        })}
                        {pulse.length === 0 && (
                            <div className="text-text-muted text-sm italic py-2">Waiting for network activity...</div>
                        )}
                    </div>
                </div>

                {/* Pulse Summary Stats */}
                <div className="mt-4 flex items-center gap-6 pt-4 border-t border-white/5">
                    <div className="flex items-center gap-2">
                        <span className="text-text-muted text-xs font-medium">Recent Uploads</span>
                        <span className="text-sm font-bold font-mono text-text-main">{pulse.length}</span>
                    </div>
                    <div className="h-4 w-px bg-white/10" />
                    <div className="flex items-center gap-2">
                        <span className="text-text-muted text-xs font-medium">Files</span>
                        <span className="text-sm font-bold font-mono text-text-main">{pulseFileCount}</span>
                    </div>
                    <div className="h-4 w-px bg-white/10" />
                    <div className="flex items-center gap-2">
                        <span className="text-text-muted text-xs font-medium">Chunks</span>
                        <span className="text-sm font-bold font-mono text-text-main">{pulseChunkCount}</span>
                    </div>
                    <div className="h-4 w-px bg-white/10" />
                    <div className="flex items-center gap-2">
                        <span className="text-text-muted text-xs font-medium">Volume</span>
                        <span className="text-sm font-bold font-mono text-text-main">{formatBytes(pulseTotalBytes, 1)}</span>
                    </div>
                </div>
            </div>

            <style>{`
                .mask-linear-fade {
                    mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
                }
                @keyframes scroll-left {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                }
                .animate-scroll-left {
                    animation: scroll-left 40s linear infinite;
                }
                .animate-scroll-left:hover {
                    animation-play-state: paused;
                }
            `}</style>
        </div>
    );
};
