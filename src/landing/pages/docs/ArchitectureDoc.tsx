import { motion } from 'framer-motion';

const ArchitectureDoc = () => {
    return (
        <div className="max-w-4xl text-text-main">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <h1 className="text-4xl font-bold mb-8 text-text-main">Architecture & Security</h1>

                <p className="text-lg text-text-muted mb-12 leading-relaxed">
                    Nest is built on a **Zero-Knowledge (ZK)** security model. This means that the server is "blind" to your data—it facilitates storage and authentication without ever having the technical capability to decrypt your files.
                </p>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">The Zero-Knowledge Model</h2>
                    <p className="text-text-muted mb-6">
                        In traditional cloud storage, the server manages your keys. In Nest, **you are the only one who holds the keys.**
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                            { title: 'Client-Side Primacy', desc: 'Encryption and decryption happen strictly in your browser.' },
                            { title: 'Untrusted Backend', desc: 'The server is treated as a compromised entity.' },
                            { title: 'No Cleartext Metadata', desc: 'Filenames and folder structures are always encrypted.' }
                        ].map(item => (
                            <div key={item.title} className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
                                <h4 className="font-bold mb-2 text-primary">{item.title}</h4>
                                <p className="text-xs text-text-muted">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="mb-12">
                    <div className="flex items-center mb-4">
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-tighter font-bold">Key Hierarchy</span>
                    </div>
                    <h3 className="text-xl font-bold mb-4 text-text-main">Root Derivation (Argon2id)</h3>
                    <p className="text-text-muted mb-6 font-sans">
                        When you log in, your password is processed locally using the **Argon2id** memory-hard hashing function.
                    </p>
                    <div className="bg-slate-900 rounded-xl p-6 border border-slate-800 font-mono text-sm overflow-x-auto shadow-xl">
                        <pre className="text-emerald-400">
                            {`AuthHash = Argon2id(Password, Salt, { iterations: 3, memory: 64MB })
RootKey = Argon2id(Password, Salt, { iterations: 3, memory: 64MB, keyLength: 32 })`}
                        </pre>
                    </div>
                </section>

                <section className="mb-12 p-8 rounded-3xl bg-white border border-slate-200 shadow-sm">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">Cryptographic Suite</h2>
                    <table className="w-full text-left text-sm text-text-muted">
                        <thead>
                            <tr className="border-b border-slate-100">
                                <th className="py-2 font-bold text-text-main">Layer</th>
                                <th className="py-2 font-bold text-text-main">Algorithm</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            <tr><td className="py-3 font-medium text-text-main">Password Hashing</td><td className="py-3">Argon2id</td></tr>
                            <tr><td className="py-3 font-medium text-text-main">Key Wrapping</td><td className="py-3">XChaCha20-Poly1305</td></tr>
                            <tr><td className="py-3 font-medium text-text-main">File Encryption</td><td className="py-3">AES-256-GCM / Sodium SecretStream</td></tr>
                            <tr><td className="py-3 font-medium text-text-main">Integrity</td><td className="py-3">SHA-256 / Blake3</td></tr>
                        </tbody>
                    </table>
                </section>
            </motion.div>
        </div>
    );
};

export default ArchitectureDoc;
