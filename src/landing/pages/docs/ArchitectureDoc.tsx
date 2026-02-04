import { motion } from 'framer-motion';

const ArchitectureDoc = () => {
    return (
        <div className="max-w-4xl text-zinc-100">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <h1 className="text-4xl font-bold mb-8">Architecture & Security</h1>

                <p className="text-lg text-zinc-400 mb-12 leading-relaxed">
                    Nest is built on a **Zero-Knowledge (ZK)** security model. This means that the server is "blind" to your data—it facilitates storage and authentication without ever having the technical capability to decrypt your files.
                </p>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-white">The Zero-Knowledge Model</h2>
                    <p className="text-zinc-400 mb-6">
                        In traditional cloud storage, the server manages your keys. In Nest, **you are the only one who holds the keys.**
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                            { title: 'Client-Side Primacy', desc: 'Encryption and decryption happen strictly in your browser.' },
                            { title: 'Untrusted Backend', desc: 'The server is treated as a compromised entity.' },
                            { title: 'No Cleartext Metadata', desc: 'Filenames and folder structures are always encrypted.' }
                        ].map(item => (
                            <div key={item.title} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
                                <h4 className="font-bold mb-2 text-indigo-400">{item.title}</h4>
                                <p className="text-xs text-zinc-500">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-white text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 inline-flex mb-4 uppercase tracking-tighter font-bold">Key Hierarchy</h2>
                    <h3 className="text-xl font-bold mb-4 text-white">Root Derivation (Argon2id)</h3>
                    <p className="text-zinc-400 mb-6">
                        When you log in, your password is processed locally using the **Argon2id** memory-hard hashing function.
                    </p>
                    <div className="bg-black/40 rounded-xl p-6 border border-zinc-800 font-mono text-sm overflow-x-auto">
                        <pre className="text-indigo-300">
                            {`AuthHash = Argon2id(Password, Salt, { iterations: 3, memory: 64MB })
RootKey = Argon2id(Password, Salt, { iterations: 3, memory: 64MB, keyLength: 32 })`}
                        </pre>
                    </div>
                </section>

                <section className="mb-12 p-8 rounded-3xl bg-gradient-to-br from-indigo-500/5 to-transparent border border-indigo-500/10">
                    <h2 className="text-2xl font-bold mb-4 text-white">Cryptographic Suite</h2>
                    <table className="w-full text-left text-sm text-zinc-400">
                        <thead>
                            <tr className="border-b border-zinc-800">
                                <th className="py-2 font-bold text-white">Layer</th>
                                <th className="py-2 font-bold text-white">Algorithm</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                            <tr><td className="py-3 font-medium text-zinc-300">Password Hashing</td><td className="py-3">Argon2id</td></tr>
                            <tr><td className="py-3 font-medium text-zinc-300">Key Wrapping</td><td className="py-3">XChaCha20-Poly1305</td></tr>
                            <tr><td className="py-3 font-medium text-zinc-300">File Encryption</td><td className="py-3">AES-256-GCM / Sodium SecretStream</td></tr>
                            <tr><td className="py-3 font-medium text-zinc-300">Integrity</td><td className="py-3">SHA-256 / Blake3</td></tr>
                        </tbody>
                    </table>
                </section>
            </motion.div>
        </div>
    );
};

export default ArchitectureDoc;
