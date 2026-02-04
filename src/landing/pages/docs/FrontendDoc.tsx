import { motion } from 'framer-motion';

const FrontendDoc = () => {
    return (
        <div className="max-w-4xl text-zinc-100">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <h1 className="text-4xl font-bold mb-8">Frontend & Encryption Logic</h1>

                <p className="text-lg text-zinc-400 mb-12 leading-relaxed">
                    The Nest frontend is the single point of trust in our system. It is responsible for all cryptographic operations, ensuring that cleartext data never leaves your device.
                </p>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-white">Cryptographic Foundations</h2>
                    <p className="text-zinc-400">We utilize WebAssembly (WASM) for high-performance crypto:</p>
                    <ul className="text-zinc-500 space-y-2 mt-4">
                        <li><strong className="text-zinc-300">libsodium-wrappers</strong>: Authenticated encryption (AEAD) and secret streams.</li>
                        <li><strong className="text-zinc-300">hash-wasm</strong>: High-speed Argon2id implementation.</li>
                    </ul>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-6 text-white">High-Performance Chunking</h2>
                    <div className="relative p-8 rounded-3xl bg-zinc-900 border border-zinc-800 overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-3xl -mr-16 -mt-16" />
                        <h3 className="text-xl font-bold mb-4 text-indigo-400 italic">Streaming Encryption</h3>
                        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                            To handle files up to 10GB without crashing the browser, Nest employs a dual-layer chunking strategy. Data is streamed directly from disk to the encryption engine in 64MB memory buffers.
                        </p>
                        <div className="flex gap-4">
                            <span className="px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-[10px] font-bold uppercase tracking-wider">Resumable</span>
                            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">Parallel</span>
                            <span className="px-3 py-1 rounded-full bg-sky-500/10 text-sky-400 text-[10px] font-bold uppercase tracking-wider">Memory-Safe</span>
                        </div>
                    </div>
                </section>
            </motion.div>
        </div>
    );
};

export default FrontendDoc;
