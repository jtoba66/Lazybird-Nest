import { motion } from 'framer-motion';

const DatabaseDoc = () => {
    return (
        <div className="max-w-4xl text-zinc-100">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <h1 className="text-4xl font-bold mb-8">Database & Schema</h1>

                <p className="text-lg text-zinc-400 mb-12 leading-relaxed">
                    Nest uses **PostgreSQL** with **Drizzle ORM** for its persistence layer. The schema is designed to balance relational data requirements with zero-knowledge privacy.
                </p>

                <section className="mb-12">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                        <h2 className="text-2xl font-bold mb-6 text-white flex items-center gap-3">
                            <span className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                                <span className="text-amber-400">T</span>
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
                                <div key={table.name} className="flex flex-col md:flex-row md:items-center justify-between py-4 border-b border-zinc-800 last:border-0">
                                    <div className="flex items-center gap-4">
                                        <code className="text-amber-400 font-bold">{table.name}</code>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 font-bold uppercase tracking-widest">{table.role}</span>
                                    </div>
                                    <p className="text-sm text-zinc-500 mt-2 md:mt-0">{table.info}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-white">The Graveyard</h2>
                    <p className="text-zinc-400 mb-6">
                        To support secure deletion and system audits, Nest uses a separate "Graveyard" schema. Metadata for deleted files is moved here to preserve history without cluttering the active filesystem handles.
                    </p>
                </section>
            </motion.div>
        </div>
    );
};

export default DatabaseDoc;
