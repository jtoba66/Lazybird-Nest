import { motion } from 'framer-motion';
import { ShieldCheck, Globe, Browsers, Database } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';

const DocsIndex = () => {
    const categories = [
        {
            title: 'Architecture & Security',
            desc: 'The Zero-Knowledge blueprint and cryptographic protocols powering the Nest ecosystem.',
            icon: ShieldCheck,
            link: '/docs/architecture',
            color: 'text-primary',
            bg: 'bg-primary/10'
        },
        {
            title: 'API Reference',
            desc: 'Comprehensive guide to our RESTful endpoints, request schemas, and authentication.',
            icon: Globe,
            link: '/docs/api',
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10'
        },
        {
            title: 'Frontend Logic',
            desc: 'Understanding client-side encryption, chunking, and session management.',
            icon: Browsers,
            link: '/docs/frontend',
            color: 'text-sky-500',
            bg: 'bg-sky-500/10'
        },
        {
            title: 'Database Schema',
            desc: 'A look at the relational models and storage strategies that maintain user privacy.',
            icon: Database,
            link: '/docs/database',
            color: 'text-amber-500',
            bg: 'bg-amber-500/10'
        }
    ];

    return (
        <div className="max-w-4xl text-text-main">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-12"
            >
                <h1 className="text-4xl lg:text-5xl font-bold tracking-tight mb-6">
                    Documentation
                </h1>
                <p className="text-xl text-text-muted leading-relaxed">
                    Welcome to the Nest Deep Wiki. Here you'll find everything you need to understand the technical foundations of our decentralized, zero-knowledge storage network.
                </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {categories.map((cat, i) => (
                    <Link key={cat.title} to={cat.link}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.1 }}
                            className="group p-6 rounded-2xl bg-white border border-slate-200 hover:border-primary/30 transition-all cursor-pointer h-full flex flex-col shadow-sm"
                        >
                            <div className={`w-12 h-12 rounded-xl \${cat.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                                <cat.icon size={24} className={cat.color} weight="fill" />
                            </div>
                            <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">
                                {cat.title}
                            </h3>
                            <p className="text-text-muted text-sm leading-relaxed">
                                {cat.desc}
                            </p>
                        </motion.div>
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default DocsIndex;
