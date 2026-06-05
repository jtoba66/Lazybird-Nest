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
                    Nest uses <strong className="font-bold">PostgreSQL</strong> with <strong className="font-bold">Drizzle ORM</strong> for its persistence layer. The schema is meticulously designed to balance relational querying speed with absolute zero-knowledge privacy.
                </p>

                <section className="mb-16">
                    <h2 className="text-2xl font-bold mb-8 text-text-main border-l-4 border-amber-500 pl-4">Core Schema Definitions</h2>

                    <div className="space-y-8">
                        {/* users table */}
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-4 mb-4">
                                <code className="text-amber-600 font-bold text-xl">users</code>
                                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold uppercase tracking-widest">Identity & Billing</span>
                            </div>
                            <p className="text-sm text-text-muted mb-6">Handles authentication state and storage quotas. Passwords are never stored here.</p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-text-muted">
                                    <thead>
                                        <tr className="border-b border-slate-100">
                                            <th className="py-2 font-bold text-text-main">Column</th>
                                            <th className="py-2 font-bold text-text-main">Type</th>
                                            <th className="py-2 font-bold text-text-main">Purpose</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">id</td><td className="py-3 font-mono text-xs">serial</td><td className="py-3">Primary Key</td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">email</td><td className="py-3 font-mono text-xs">varchar</td><td className="py-3">Unique login identifier</td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">auth_hash</td><td className="py-3 font-mono text-xs">varchar</td><td className="py-3">Bcrypt hash of the client-derived AuthHash</td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">storage_quota_bytes</td><td className="py-3 font-mono text-xs">bigint</td><td className="py-3">Maximum bytes allowed based on billing tier</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* user_crypto table */}
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-4 mb-4">
                                <code className="text-amber-600 font-bold text-xl">user_crypto</code>
                                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold uppercase tracking-widest">ZK Core</span>
                            </div>
                            <p className="text-sm text-text-muted mb-6">Stores the pre-derivation salts and the encrypted master keys required to bootstrap a zero-knowledge session.</p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-text-muted">
                                    <thead>
                                        <tr className="border-b border-slate-100">
                                            <th className="py-2 font-bold text-text-main">Column</th>
                                            <th className="py-2 font-bold text-text-main">Type</th>
                                            <th className="py-2 font-bold text-text-main">Purpose</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">user_id</td><td className="py-3 font-mono text-xs">integer</td><td className="py-3">Foreign Key to `users.id`</td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">salt</td><td className="py-3 font-mono text-xs">text</td><td className="py-3">Base64 random bytes for Argon2id</td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">encrypted_master_key</td><td className="py-3 font-mono text-xs">text</td><td className="py-3">XChaCha20 ciphertext of the Master Key</td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">encrypted_metadata</td><td className="py-3 font-mono text-xs">text</td><td className="py-3">Encrypted JSON blob containing folder/file names</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* files table */}
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-4 mb-4">
                                <code className="text-amber-600 font-bold text-xl">files</code>
                                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold uppercase tracking-widest">Cloud Pointers</span>
                            </div>
                            <p className="text-sm text-text-muted mb-6">Stores pointers to the decentralized storage network. Does NOT store filenames.</p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-text-muted">
                                    <thead>
                                        <tr className="border-b border-slate-100">
                                            <th className="py-2 font-bold text-text-main">Column</th>
                                            <th className="py-2 font-bold text-text-main">Type</th>
                                            <th className="py-2 font-bold text-text-main">Purpose</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">id</td><td className="py-3 font-mono text-xs">serial</td><td className="py-3">Primary Key</td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">user_id</td><td className="py-3 font-mono text-xs">integer</td><td className="py-3">Owner of the file</td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">jackal_fid</td><td className="py-3 font-mono text-xs">varchar</td><td className="py-3">File ID on the Obsideo Storage Network <i>(Note: Database column retains legacy name `jackal_fid`)</i></td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">encrypted_file_key</td><td className="py-3 font-mono text-xs">text</td><td className="py-3">Wrapped key needed to decrypt the file blob</td></tr>
                                        <tr><td className="py-3 font-mono text-xs text-sky-600">file_size</td><td className="py-3 font-mono text-xs">bigint</td><td className="py-3">Size in bytes (used for quota calculations)</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">The Graveyard Protocol</h2>
                    <p className="text-text-muted mb-6 leading-relaxed">
                        To support secure deletion and enterprise auditing, Nest utilizes a specialized "Graveyard" schema (<code>graveyard</code> and <code>graveyard_chunks</code>). When a user permanently deletes a file, its metadata is moved from the active <code>files</code> table to the graveyard. This preserves historical records of storage network IDs without cluttering the active filesystem indices or exposing metadata to the client.
                    </p>
                </section>
            </motion.div>
        </div>
    );
};

export default DatabaseDoc;
