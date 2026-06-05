import { motion } from 'framer-motion';
import SEO from '../../../components/SEO';

const FrontendDoc = () => {
    return (
        <div className="max-w-4xl text-text-main">
            <SEO
                title="Frontend Logic & Encryption"
                description="How Nest handles client-side encryption, file chunking, and memory management in the browser."
                canonical="https://nest.lazybird.io/docs/frontend"
            />
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <h1 className="text-4xl font-bold mb-8 text-text-main">Frontend & Encryption Logic</h1>

                <p className="text-lg text-text-muted mb-12 leading-relaxed">
                    The Nest frontend is the single point of trust in our system. It is responsible for all cryptographic operations, ensuring that cleartext data never leaves your device.
                </p>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-text-main">Cryptographic Foundations</h2>
                    <p className="text-text-muted">We utilize WebAssembly (WASM) for high-performance crypto:</p>
                    <ul className="text-text-muted space-y-2 mt-4 list-disc pl-5">
                        <li><strong className="text-text-main">libsodium-wrappers</strong>: Authenticated encryption (AEAD) and secret streams.</li>
                        <li><strong className="text-text-main">hash-wasm</strong>: High-speed Argon2id implementation.</li>
                    </ul>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-6 text-text-main">High-Performance Chunking</h2>
                    <div className="relative p-8 rounded-3xl bg-white border border-slate-200 overflow-hidden shadow-sm">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl -mr-16 -mt-16" />
                        <h3 className="text-xl font-bold mb-4 text-primary italic">Streaming Encryption</h3>
                        <p className="text-text-muted text-sm leading-relaxed mb-6 font-sans">
                            To handle files up to 10GB without crashing the browser, Nest employs a dual-layer chunking strategy. Data is streamed directly from disk to the encryption engine in 64MB memory buffers.
                        </p>
                        <div className="flex gap-4">
                            <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider">Resumable</span>
                            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-[10px] font-bold uppercase tracking-wider">Parallel</span>
                            <span className="px-3 py-1 rounded-full bg-sky-500/10 text-sky-600 text-[10px] font-bold uppercase tracking-wider">Memory-Safe</span>
                        </div>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-6 text-text-main">The Decoupled Crypto Engine</h2>
                    <p className="text-text-muted mb-4 leading-relaxed">
                        A common critique of browser-based encryption is that the server could secretly serve malicious JavaScript to steal keys. Nest defeats this by entirely separating our encryption logic from the main application.
                    </p>
                    <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 shadow-sm">
                        <ul className="text-sm text-text-muted space-y-4">
                            <li className="flex gap-3">
                                <span className="text-emerald-500 font-bold mt-0.5">1.</span>
                                <span><strong className="text-text-main font-bold">Open Source Core:</strong> All cryptographic operations are handled by our standalone, open-source NPM package: <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">@lazybird-inc/nest-crypto</code>.</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="text-emerald-500 font-bold mt-0.5">2.</span>
                                <span><strong className="text-text-main font-bold">Subresource Integrity (SRI):</strong> The crypto engine is delivered to the browser with an unforgeable cryptographic hash. If the server tries to alter the encryption code, the browser will instantly block it from running.</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="text-emerald-500 font-bold mt-0.5">3.</span>
                                <span><strong className="text-text-main font-bold">Verifiable:</strong> Security researchers can easily audit the exact cryptography pipeline running in your browser without digging through thousands of lines of UI code.</span>
                            </li>
                        </ul>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-6 text-text-main">Implementation Example</h2>
                    <p className="text-text-muted mb-4 leading-relaxed">
                        Because the engine is standalone, third-party developers can easily build custom clients that integrate with the Nest ecosystem without rewriting the complex WASM-backed crypto.
                    </p>
                    <div className="bg-slate-900 rounded-xl p-6 border border-slate-800 shadow-xl overflow-x-auto">
                        <pre className="text-sm font-mono leading-relaxed">
                            <code className="text-pink-400">import</code> <code className="text-white">{'{ init, encryptFile, generateFileKey }'}</code> <code className="text-pink-400">from</code> <code className="text-emerald-300">'@lazybird-inc/nest-crypto'</code><code className="text-white">;</code>
                            <br/><br/>
                            <code className="text-slate-400">{'// 1. Initialize the WebAssembly module'}</code><br/>
                            <code className="text-pink-400">await</code> <code className="text-sky-300">init</code><code className="text-white">();</code>
                            <br/><br/>
                            <code className="text-slate-400">{'// 2. Generate a secure random 32-byte key'}</code><br/>
                            <code className="text-pink-400">const</code> <code className="text-white">fileKey = </code><code className="text-sky-300">generateFileKey</code><code className="text-white">();</code>
                            <br/><br/>
                            <code className="text-slate-400">{'// 3. Encrypt a native browser File object into chunks'}</code><br/>
                            <code className="text-pink-400">const</code> <code className="text-white">{'{ encryptedBlob, nonce }'} = </code><code className="text-pink-400">await</code> <code className="text-sky-300">encryptFile</code><code className="text-white">(rawFile, fileKey);</code>
                            <br/><br/>
                            <code className="text-slate-400">{'// 4. Send the ciphertexts to the backend'}</code><br/>
                            <code className="text-sky-300">uploadToNest</code><code className="text-white">(encryptedBlob, nonce);</code>
                        </pre>
                    </div>
                </section>
            </motion.div>
        </div>
    );
};

export default FrontendDoc;
