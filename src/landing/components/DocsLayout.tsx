import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ShieldCheck,
    Browsers,
    Database,
    Globe,
    List,
    X,
    BookOpenText
} from '@phosphor-icons/react';
import Navbar from './Navbar';
import Footer from './Footer';

const DOCS_NAV = [
    { name: 'Introduction', path: '/docs', icon: BookOpenText },
    { name: 'Architecture', path: '/docs/architecture', icon: ShieldCheck },
    { name: 'API Reference', path: '/docs/api', icon: Globe },
    { name: 'Frontend Logic', path: '/docs/frontend', icon: Browsers },
    { name: 'Database Schema', path: '/docs/database', icon: Database },
];

export const DocsLayout: React.FC = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const { pathname } = useLocation();

    return (
        <div className="min-h-screen bg-[#050505] text-white flex flex-col font-outfit">
            <Navbar />

            <div className="flex-1 flex flex-col lg:flex-row max-w-7xl mx-auto w-full pt-24 pb-12 px-6 gap-12">
                {/* Sidebar Navigation */}
                <aside className="hidden lg:block w-64 flex-shrink-0">
                    <div className="sticky top-32">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-6 px-4">
                            Documentation
                        </h3>
                        <nav className="space-y-1">
                            {DOCS_NAV.map((item) => {
                                const Icon = item.icon;
                                const isActive = pathname === item.path;
                                return (
                                    <NavLink
                                        key={item.path}
                                        to={item.path}
                                        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group ${isActive
                                            ? 'bg-zinc-800/50 text-white border border-zinc-700/50'
                                            : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                                            }`}
                                    >
                                        <Icon weight={isActive ? "fill" : "regular"} size={20} className={isActive ? "text-indigo-400" : "text-zinc-500 group-hover:text-zinc-300"} />
                                        <span className="text-[15px] font-medium">{item.name}</span>
                                        {isActive && (
                                            <motion.div
                                                layoutId="activeDocIndicator"
                                                className="ml-auto w-1 h-1 rounded-full bg-indigo-400"
                                            />
                                        )}
                                    </NavLink>
                                );
                            })}
                        </nav>
                    </div>
                </aside>

                {/* Mobile Navigation Trigger */}
                <div className="lg:hidden">
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 active:scale-95 transition-transform"
                    >
                        <List size={20} />
                        <span className="text-sm font-medium">Docs Menu</span>
                    </button>
                </div>

                {/* Mobile Sidebar Overlay */}
                <AnimatePresence>
                    {isSidebarOpen && (
                        <>
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setIsSidebarOpen(false)}
                                className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] lg:hidden"
                            />
                            <motion.div
                                initial={{ x: '-100%' }}
                                animate={{ x: 0 }}
                                exit={{ x: '-100%' }}
                                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                                className="fixed top-0 left-0 bottom-0 w-[280px] bg-[#0A0A0A] border-r border-zinc-800 z-[101] p-6 lg:hidden"
                            >
                                <div className="flex justify-between items-center mb-8">
                                    <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Docs</h3>
                                    <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-zinc-900 rounded-lg">
                                        <X size={20} />
                                    </button>
                                </div>
                                <nav className="space-y-2">
                                    {DOCS_NAV.map((item) => {
                                        const Icon = item.icon;
                                        const isActive = pathname === item.path;
                                        return (
                                            <NavLink
                                                key={item.path}
                                                to={item.path}
                                                onClick={() => setIsSidebarOpen(false)}
                                                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                                                    }`}
                                            >
                                                <Icon size={20} />
                                                <span className="font-medium">{item.name}</span>
                                            </NavLink>
                                        );
                                    })}
                                </nav>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>

                {/* Main Content Area */}
                <main className="flex-1 min-w-0">
                    <Outlet />
                </main>
            </div>

            <Footer />
        </div>
    );
};
