import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Users, CaretDown, ArrowsClockwise } from '@phosphor-icons/react';
import API_BASE_URL from '../../config/api';

export function UserGrowthChart() {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('30d');
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Toggles
    const [showTotal, setShowTotal] = useState(true);
    const [showPaid, setShowPaid] = useState(true);

    useEffect(() => {
        fetchHistory();
    }, [range]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('nest_token');
            const res = await fetch(`${API_BASE_URL}/admin/analytics/users?range=${range}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const history = await res.json();
                console.log('[DEBUG] User Growth Data:', history);
                setData(history);
            } else {
                console.error('[DEBUG] User Growth Fetch Failed:', res.status, res.statusText);
            }
        } catch (err) {
            console.error('[DEBUG] User Growth Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-background/90 border border-white/10 p-3 rounded-lg shadow-xl backdrop-blur-md">
                    <p className="text-text-muted text-xs mb-2 font-medium">{new Date(label).toLocaleString()}</p>
                    {payload.map((p: any, i: number) => (
                        <div key={i} className="flex items-center justify-between gap-6 mb-1">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                                <span className="text-sm font-medium text-text-muted">{p.name}</span>
                            </div>
                            <span className="text-sm font-bold text-text-main">{p.value}</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="glass-panel p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                        <Users size={20} weight="duotone" className="text-primary" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold">User Growth</h3>
                        <p className="text-xs text-text-muted font-medium">Network adoption stats</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchHistory}
                        className="p-1.5 hover:bg-black/5 rounded-lg transition-colors text-text-muted hover:text-text-main"
                        title="Refresh data"
                    >
                        <ArrowsClockwise size={16} className={loading ? 'animate-spin' : ''} />
                    </button>

                    {/* Range Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-border rounded-lg text-xs font-bold transition-all hover:bg-gray-50 text-text-main"
                        >
                            {range === '24h' ? 'Last 24h' : range === '7d' ? 'Last 7 Days' : range === '90d' ? 'Last 3 Months' : 'Last 30 Days'}
                            <CaretDown size={12} className={`transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isMenuOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)} />
                                <div className="absolute right-0 top-full mt-2 w-40 bg-white border border-border rounded-xl shadow-2xl overflow-hidden z-20 py-1">
                                    <button onClick={() => { setRange('24h'); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-text-main hover:bg-black/5 transition-colors">Last 24 Hours</button>
                                    <button onClick={() => { setRange('7d'); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-text-main hover:bg-black/5 transition-colors">Last 7 Days</button>
                                    <button onClick={() => { setRange('30d'); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-text-main hover:bg-black/5 transition-colors">Last 30 Days</button>
                                    <button onClick={() => { setRange('90d'); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-text-main hover:bg-black/5 transition-colors">Last 3 Months</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Toggles */}
            <div className="flex gap-6 mb-6">
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                    <input type="checkbox" checked={showTotal} onChange={e => setShowTotal(e.target.checked)} className="hidden" />
                    <div className={`w-4 h-4 rounded-full transition-all ${showTotal ? 'bg-primary shadow-[0_0_10px_rgba(var(--color-primary-rgb),0.5)]' : 'bg-text-muted/20'}`} />
                    <div className="flex flex-col">
                        <span className={`text-xs font-bold transition-colors ${showTotal ? 'text-text-main' : 'text-text-muted'}`}>Total Users</span>
                        {data.length > 0 && <span className="text-[10px] text-text-muted font-medium">{data[data.length - 1].total} Current</span>}
                    </div>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none group">
                    <input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} className="hidden" />
                    <div className={`w-4 h-4 rounded-full transition-all ${showPaid ? 'bg-secondary shadow-[0_0_10px_rgba(var(--color-secondary-rgb),0.5)]' : 'bg-text-muted/20'}`} />
                    <div className="flex flex-col">
                        <span className={`text-xs font-bold transition-colors ${showPaid ? 'text-text-main' : 'text-text-muted'}`}>Paid Users</span>
                        {data.length > 0 && <span className="text-[10px] text-text-muted font-medium">{data[data.length - 1].paid} Pro</span>}
                    </div>
                </label>
            </div>

            <div className="h-[300px] w-full">
                {loading ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
                        <span className="text-xs text-text-muted font-medium animate-pulse">Fetching analytics...</span>
                    </div>
                ) : data.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-text-muted border-2 border-dashed border-border rounded-2xl bg-black/[0.02]">
                        <Users size={40} weight="thin" className="mb-3 opacity-20" />
                        <span className="text-sm font-medium">No user data for this period</span>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorPaid" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-secondary)" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="var(--color-secondary)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} horizontal={true} />
                            <XAxis
                                dataKey="date"
                                tickFormatter={(str) => {
                                    const d = new Date(str);
                                    if (range === '24h') return d.toLocaleTimeString([], { hour: 'numeric', hour12: true });
                                    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                                }}
                                stroke="#94a3b8"
                                tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }}
                                tickLine={{ stroke: '#94a3b8' }}
                                axisLine={{ stroke: '#94a3b8' }}
                                dy={10}
                            />
                            <YAxis
                                stroke="#94a3b8"
                                tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }}
                                tickLine={{ stroke: '#94a3b8' }}
                                axisLine={{ stroke: '#94a3b8' }}
                                dx={-5}
                                allowDecimals={false}
                                domain={[0, (dataMax: number) => Math.max(dataMax + 2, 5)]}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />

                            {showTotal && (
                                <Area
                                    type="monotone"
                                    dataKey="total"
                                    name="Total Users"
                                    stroke="var(--color-primary)"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorTotal)"
                                    animationDuration={1500}
                                />
                            )}

                            {showPaid && (
                                <Area
                                    type="monotone"
                                    dataKey="paid"
                                    name="Paid Users"
                                    stroke="var(--color-secondary)"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorPaid)"
                                    animationDuration={1500}
                                />
                            )}
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
