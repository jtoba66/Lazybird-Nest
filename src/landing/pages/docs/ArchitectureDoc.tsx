import { motion } from 'framer-motion';
import SEO from '../../../components/SEO';

const ArchitectureDoc = () => {
    return (
        <div className="max-w-4xl text-text-main">
            <SEO
                title="Zero-Knowledge Architecture"
                description="Deep dive into Nest's client-side encryption, key management, and distributed storage model."
                canonical="https://nest.lazybird.io/docs/architecture"
            />
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <h1 className="text-4xl font-bold mb-8 text-text-main">Architecture & Security</h1>

                <p className="text-lg text-text-muted mb-12 leading-relaxed">
                    Nest is built on a <strong className="font-bold">Zero-Knowledge (ZK)</strong> security model. This means that the server is "blind" to your data. It facilitates storage and authentication without ever having the technical capability to decrypt your files.
                </p>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">The Zero-Knowledge Model</h2>
                    <p className="text-text-muted mb-6">
                        In traditional cloud storage, the server manages your keys. In Nest, <strong className="font-bold">you are the only one who holds the keys.</strong>
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                        {[
                            { title: 'Client-Side Primacy', desc: 'Encryption and decryption happen strictly in your browser.' },
                            { title: 'Untrusted Backend', desc: 'The server is treated as a compromised entity.' }
                        ].map(item => (
                            <div key={item.title} className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
                                <h4 className="font-bold mb-2 text-primary">{item.title}</h4>
                                <p className="text-sm text-text-muted">{item.desc}</p>
                            </div>
                        ))}
                    </div>

                    <h3 className="text-xl font-bold mb-4 text-text-main">The Metadata Blob Mechanism</h3>
                    <p className="text-text-muted mb-4 leading-relaxed">
                        A major challenge in Zero-Knowledge architectures is hiding file and folder names without breaking search and directory navigation. If the server cannot read filenames, how does it construct your filesystem?
                    </p>
                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <p className="text-sm text-text-muted mb-4">
                            Nest solves this via the <strong className="font-bold text-text-main">Metadata Blob</strong>. Instead of storing filenames in relational database columns, the entire virtual file system is stored as a massive JSON object that is encrypted by the Master Key.
                        </p>
                        <ol className="list-decimal pl-5 text-sm text-text-muted space-y-2 marker:text-primary marker:font-bold">
                            <li>When you log in, your browser downloads the encrypted blob and decrypts it locally.</li>
                            <li>Your browser parses the JSON to render your folders and filenames in the UI.</li>
                            <li>When you rename a file, the browser updates the local JSON, re-encrypts the entire blob, and pushes the new ciphertext back to the server.</li>
                        </ol>
                        <p className="text-sm text-text-muted mt-4 italic">
                            Result: The server only sees a meaningless stream of bytes. It knows how many bytes you are storing, but it has no mathematical way of knowing if you are storing photos, documents, or what those files are named.
                        </p>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">Architecture Flow</h2>
                    <p className="text-text-muted mb-4 leading-relaxed">
                        The architecture enforces a strict boundary between the trusted client and the untrusted server and storage layers.
                    </p>
                    <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl overflow-x-auto">
                        <pre className="text-xs font-mono text-sky-400 whitespace-pre-wrap">
{`Client (Browser)
   │
   ├─ [Trust Boundary]
   │    ├─ Argon2id KDF
   │    └─ XChaCha20-Poly1305 Encryption
   │
   ├─ 1. Login (Auth Hash) ────> API Server
   ├─ 2. Derive Key & Unlock Vault
   ├─ 3. Encrypt File
   └─ 4. Upload Encrypted Blob ────> API Server ────> Obsideo Storage Network`}
                        </pre>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">Obsideo Distributed Storage</h2>
                    <p className="text-text-muted mb-4 leading-relaxed">
                        Once your files are encrypted locally, Nest does not store the resulting ciphertexts on centralized servers like AWS S3. Instead, we utilize the <strong className="font-bold">Obsideo Storage Network</strong> for high-availability, redundant, distributed storage.
                    </p>
                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 shadow-sm mb-4">
                        <p className="text-sm font-bold mb-1">Important Integration Note</p>
                        <p className="text-xs">
                            The Obsideo SDK is utilized purely as a dumb storage pipe. It receives files that are <strong className="font-bold underline">already encrypted</strong> by your browser's WebAssembly crypto engine. Obsideo stores only opaque encrypted chunks — it never sees your file contents or file names.
                        </p>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">Secure File Sharing</h2>
                    <p className="text-text-muted mb-4 leading-relaxed">
                        How do you share an encrypted file if the server can't read the key? Nest uses <strong className="font-bold">URL Hash Fragments</strong> to facilitate peer-to-peer sharing.
                    </p>
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <ol className="list-decimal pl-5 text-sm text-text-muted space-y-3 marker:text-emerald-500 marker:font-bold">
                            <li>You select a file to share. Your browser generates a unique, temporary <strong>Share Key</strong>.</li>
                            <li>The browser encrypts the specific File Key with this new Share Key and uploads this new "Share Pointer" to the server.</li>
                            <li>The browser generates a link: <code className="bg-slate-100 text-pink-500 px-1 py-0.5 rounded">nest.lazybird.io/share/ID#ShareKey</code></li>
                            <li>When the recipient clicks the link, their browser fetches the Share Pointer.</li>
                            <li><strong>Crucially:</strong> The `#ShareKey` fragment is never sent to the server (by HTTP design). The recipient's browser uses it to decrypt the File Key, and then decrypts the file stream entirely locally.</li>
                        </ol>
                    </div>
                </section>

                <section className="mb-12">
                    <div className="flex items-center mb-4">
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-tighter font-bold">Key Hierarchy</span>
                    </div>
                    <h3 className="text-xl font-bold mb-4 text-text-main">Root Derivation (Argon2id)</h3>
                    <p className="text-text-muted mb-6 font-sans">
                        When you log in, your password is processed locally using the <strong className="font-bold">Argon2id</strong> memory-hard hashing function.
                    </p>
                    <div className="bg-slate-900 rounded-xl p-6 border border-slate-800 font-mono text-sm overflow-x-auto shadow-xl">
                        <pre className="text-emerald-400">
                            {`RootKey = Argon2id(Password, Salt, { iterations: 3, memory: 64MB, parallelism: 4 })
AuthHash = BLAKE2b("auth_" + RootKey)
WrappingKey = BLAKE2b("wrap_" + RootKey)`}
                        </pre>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">Open-Source Engine</h2>
                    <p className="text-text-muted mb-4 leading-relaxed">
                        The heart of Nest is <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">@lazybird-inc/nest-crypto</code>. It handles key derivation, file encryption, and master key wrapping using Argon2id and XChaCha20-Poly1305.
                    </p>
                    <p className="text-text-muted mb-6 leading-relaxed">
                        We load this exact engine in your browser directly from a public CDN using Subresource Integrity (SRI) hashes. This mathematically proves that the engine running in your browser matches the public, auditable source code exactly.
                    </p>
                    <div className="bg-slate-900 rounded-xl p-6 border border-slate-800 font-mono text-sm overflow-x-auto shadow-xl">
                        <pre className="text-slate-400">
{`<!-- Loaded in Nest's index.html -->
<script 
  src="https://unpkg.com/@lazybird-inc/nest-crypto" 
  integrity="sha384-..."
></script>`}
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
                            <tr><td className="py-3 font-medium text-text-main">Password Hashing</td><td className="py-3">Argon2id (hash-wasm)</td></tr>
                            <tr><td className="py-3 font-medium text-text-main">Key Wrapping</td><td className="py-3">XChaCha20-Poly1305</td></tr>
                            <tr><td className="py-3 font-medium text-text-main">File Encryption</td><td className="py-3">XChaCha20-Poly1305 (SecretStream)</td></tr>
                            <tr><td className="py-3 font-medium text-text-main">Hashing & Derivation</td><td className="py-3">BLAKE2b</td></tr>
                        </tbody>
                    </table>
                </section>
            </motion.div>
        </div>
    );
};

export default ArchitectureDoc;
