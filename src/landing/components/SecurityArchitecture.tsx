import { LockKey, CloudArrowUp, Database } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import PremiumIcon from './PremiumIcon';

const SecurityArchitecture = () => {
    return (
        <section id="architecture" className="py-32 bg-white relative overflow-hidden border-t border-slate-100">
            {/* Technical Grid Background */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

            <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.8 }}
                className="container mx-auto px-6 relative z-10"
            >
                <div className="text-center mb-24">
                    <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 text-text-main">Zero-Knowledge <span className="text-primary">Architecture</span></h2>
                    <p className="text-text-muted max-w-2xl mx-auto text-xl font-sans">
                        Your data is encrypted on your device before it ever touches our servers. We can't read your files even if we were forced to.
                    </p>
                </div>

                <div className="flex flex-col md:flex-row items-center justify-center gap-12 md:gap-8 max-w-6xl mx-auto">
                    {/* Step 1: Client */}
                    <div className="flex flex-col items-center text-center relative z-10 group flex-1">
                        <div className="mb-8 scale-110">
                            <PremiumIcon icon={LockKey} />
                        </div>
                        <h3 className="text-2xl font-display font-bold mb-3 text-text-main">1. Client-Side Encryption</h3>
                        <p className="text-text-muted text-base leading-relaxed font-sans">Your browser generates a key and encrypts files using AES-256-GCM.</p>
                    </div>

                    {/* Connector 1 */}
                    <div className="h-16 w-0.5 md:w-24 md:h-0.5 bg-slate-200 relative overflow-visible">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-2 text-xs font-mono text-slate-400 uppercase tracking-widest border border-slate-100 rounded-full">
                            TLS
                        </div>
                    </div>

                    {/* Step 2: Upload */}
                    <div className="flex flex-col items-center text-center relative z-10 flex-1">
                        <div className="mb-8 scale-110">
                            <PremiumIcon icon={CloudArrowUp} />
                        </div>
                        <h3 className="text-2xl font-display font-bold mb-3 text-text-main">2. Encrypted Upload</h3>
                        <p className="text-text-muted text-base leading-relaxed font-sans">Only the encrypted blob is transmitted. Server sees random noise.</p>
                    </div>

                    {/* Connector 2 */}
                    <div className="h-16 w-0.5 md:w-24 md:h-0.5 bg-slate-200 relative overflow-visible">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-2 text-xs font-mono text-slate-400 uppercase tracking-widest border border-slate-100 rounded-full">
                            Jkl
                        </div>
                    </div>

                    {/* Step 3: Storage */}
                    <div className="flex flex-col items-center text-center relative z-10 flex-1">
                        <div className="mb-8 scale-110">
                            <PremiumIcon icon={Database} />
                        </div>
                        <h3 className="text-2xl font-display font-bold mb-3 text-text-main">3. Jackal Storage</h3>
                        <p className="text-text-muted text-base leading-relaxed font-sans">Data is chunked and scattered across the decentralized Jackal network.</p>
                    </div>
                </div>


            </motion.div>
        </section>
    );
};

export default SecurityArchitecture;
