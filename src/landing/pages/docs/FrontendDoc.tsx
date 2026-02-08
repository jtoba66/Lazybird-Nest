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
            </motion.div>
        </div>
    );
};

export default FrontendDoc;
