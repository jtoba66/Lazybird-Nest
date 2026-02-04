import { useState, useEffect } from 'react';
import { List, X } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';

const Navbar = () => {
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { pathname } = useLocation();

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <nav
            className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${isScrolled
                ? 'bg-white/80 backdrop-blur-xl border-slate-200 py-4 shadow-sm'
                : 'bg-transparent border-transparent py-8'
                }`}
        >
            <div className="container mx-auto px-6 flex items-center justify-between">
                {/* Brand Logo */}
                <div className="flex items-center gap-3 group cursor-pointer">
                    <img src="/nest-logo.png" alt="Nest - Private Cloud Storage" className="h-10 w-auto drop-shadow-sm" />
                    <span className="text-2xl font-display font-bold tracking-tight text-text-main mt-1">
                        LazyBird's Nest
                    </span>
                </div>

                {/* Desktop Menu */}
                <div className="hidden md:flex items-center gap-10">
                    {['Features', 'Architecture', 'FAQ', 'Pricing'].map((item) => (
                        <a
                            key={item}
                            href={pathname === '/' ? `#${item.toLowerCase()}` : `/#${item.toLowerCase()}`}
                            className="text-sm font-semibold text-text-muted hover:text-text-main transition-colors duration-300 font-display uppercase tracking-wide"
                        >
                            {item}
                        </a>
                    ))}
                    <Link
                        to="/docs"
                        className="text-sm font-semibold text-text-muted hover:text-text-main transition-colors duration-300 font-display uppercase tracking-wide"
                    >
                        Documentation
                    </Link>
                    <Link to="/login" className="bg-text-main hover:bg-slate-800 text-white px-7 py-3 rounded-full font-bold transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5 font-display text-sm">
                        Launch App
                    </Link>
                </div>

                {/* Mobile Toggle */}
                <button
                    className="md:hidden text-text-main"
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    aria-label="Toggle menu"
                >
                    {isMobileMenuOpen ? <X size={24} /> : <List size={24} />}
                </button>
            </div>

            {/* Mobile Menu */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="absolute top-full left-0 right-0 bg-white border-b border-slate-200 overflow-hidden md:hidden shadow-xl"
                    >
                        <div className="flex flex-col p-6 gap-6">
                            {['Features', 'Architecture', 'FAQ', 'Pricing'].map((item) => (
                                <a
                                    key={item}
                                    href={pathname === '/' ? `#${item.toLowerCase()}` : `/#${item.toLowerCase()}`}
                                    className="text-lg font-display font-bold text-text-main hover:text-primary"
                                    onClick={(e) => {
                                        setIsMobileMenuOpen(false);
                                        // Yield to React state update before scrolling
                                        if (pathname === '/') {
                                            e.preventDefault();
                                            setTimeout(() => {
                                                const el = document.getElementById(item.toLowerCase());
                                                if (el) {
                                                    // Offset for fixed header (approx 80px)
                                                    const headerOffset = 85;
                                                    const elementPosition = el.getBoundingClientRect().top;
                                                    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                                                    window.scrollTo({
                                                        top: offsetPosition,
                                                        behavior: "smooth"
                                                    });
                                                }
                                            }, 150);
                                        }
                                    }}
                                >
                                    {item}
                                </a>
                            ))}
                            <Link
                                to="/docs"
                                className="text-lg font-display font-bold text-text-main hover:text-primary"
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                Documentation
                            </Link>
                            <Link to="/login" className="bg-text-main text-white px-5 py-4 rounded-xl font-bold transition-all text-center shadow-md">
                                Launch App
                            </Link>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </nav>
    );
};

export default Navbar;
