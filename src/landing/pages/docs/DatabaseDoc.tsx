import { motion } from 'framer-motion';
import SEO from '../../../components/SEO';

const DatabaseDoc = () => {
    return (
        <div className="max-w-4xl text-text-main">
            <SEO
                title="Database Schema"
                description="Overview of Nest's database schema and how it handles zero-knowledge relational data."
                canonical="https://nest.lazybird.io/docs/database"
            />
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <h1 className="text-4xl font-bold mb-8 text-text-main">Database & Schema</h1>

                <p className="text-lg text-text-muted mb-12 leading-relaxed">
                    Nest uses <strong className="font-bold">PostgreSQL</strong> with <strong className="font-bold">Drizzle ORM</strong> for its persistence layer. The schema is designed to balance relational data requirements with zero-knowledge privacy.
                </p>

                <section className="mb-12 font-sans">
                    <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
                        <h2 className="text-2xl font-bold mb-6 text-text-main flex items-center gap-3 font-display">
                            <span className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                                <span className="text-amber-500">T</span>
                            </span>
                            Table Definitions
                        </h2>

                        <div className="space-y-6">
                            {[
                                { name: 'users', role: 'Identity & Billing', info: 'Stores email and bcrypt-hashed AuthHash.' },
                                { name: 'user_crypto', role: 'ZK Core', info: 'Stores salt, wrapped master key, and encrypted metadata blob.' },
                                { name: 'files', role: 'Cloud Pointers', info: 'Stores Jackal Merkle hashes and encrypted file keys.' },
                                { name: 'folders', role: 'Structure', info: 'Stores relational hierarchy and encrypted folder keys.' }
                            ].map(table => (
                                <div key={table.name} className="flex flex-col md:flex-row md:items-center justify-between py-4 border-b border-slate-100 last:border-0">
                                    <div className="flex items-center gap-4">
                                        <code className="text-amber-600 font-bold">{table.name}</code>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-50 text-text-muted font-bold uppercase tracking-widest">{table.role}</span>
                                    </div>
                                    <p className="text-sm text-text-muted mt-2 md:mt-0">{table.info}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">The Graveyard</h2>
                    <p className="text-text-muted mb-6 leading-relaxed">
                        To support secure deletion and system audits, Nest uses a separate "Graveyard" schema. Metadata for deleted files is moved here to preserve history without cluttering the active filesystem handles. Even in the graveyard, all metadata remains fully encrypted.
                    </p>
                </section>
            </motion.div>
        </div>
    );
};

export default DatabaseDoc;
