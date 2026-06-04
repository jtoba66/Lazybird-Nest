import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, FileCode, MagnifyingGlass, BookOpen } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import TopNav from '../landing/components/TopNav';
import Footer from '../landing/components/Footer';

const SecurityPage = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="min-h-screen bg-slate-50 font-sans selection:bg-primary selection:text-white">
            <TopNav />

            {/* Hero Section */}
            <section className="pt-32 pb-20 px-6 max-w-4xl mx-auto text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-semibold mb-8"
                >
                    <ShieldCheck weight="fill" size={18} />
                    Nest Security Center
                </motion.div>
                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-4xl md:text-6xl font-display font-bold text-slate-900 tracking-tight mb-6"
                >
                    Radical Transparency.<br />Zero Compromises.
                </motion.h1>
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed"
                >
                    Trust isn't given; it's proven. We've open-sourced our entire zero-knowledge cryptography engine so you never have to take our word for it.
                </motion.p>
            </section>

            {/* Content Sections */}
            <section className="px-6 py-12 max-w-4xl mx-auto space-y-24">
                
                {/* 1. Open Source Crypto */}
                <div className="grid md:grid-cols-2 gap-12 items-center">
                    <div>
                        <div className="h-12 w-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mb-6">
                            <FileCode size={24} weight="fill" />
                        </div>
                        <h2 className="text-2xl font-bold font-display text-slate-900 mb-4">Open-Source Engine</h2>
                        <p className="text-slate-600 mb-6 leading-relaxed">
                            The heart of Nest is <code className="px-1.5 py-0.5 rounded bg-slate-200 text-sm">@lazybird-inc/nest-crypto</code>. It handles key derivation, file encryption, and master key wrapping using Argon2id and XChaCha20-Poly1305.
                        </p>
                        <p className="text-slate-600 mb-6 leading-relaxed">
                            We load this exact engine in your browser directly from a public CDN using Subresource Integrity (SRI) hashes. This mathematically proves that the engine running in your browser matches the public, auditable source code exactly.
                        </p>
                        <a 
                            href="https://github.com/Lazybird-inc/nest-crypto" 
                            target="_blank" 
                            rel="noreferrer"
                            className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium transition-colors"
                        >
                            View Source Code
                        </a>
                    </div>
                    <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                        <pre className="text-xs text-slate-500 overflow-x-auto">
                            <code>
{`<!-- Loaded in Nest's index.html -->
<script 
  src="https://unpkg.com/@lazybird-inc/nest-crypto" 
  integrity="sha384-..."
></script>`}
                            </code>
                        </pre>
                    </div>
                </div>

                {/* 2. Private Auditor Program */}
                <div className="bg-primary/5 border border-primary/20 rounded-[2.5rem] p-8 md:p-12 relative overflow-hidden">
                    <div className="relative z-10 max-w-2xl">
                        <div className="h-12 w-12 rounded-2xl bg-white text-primary flex items-center justify-center shadow-sm mb-6">
                            <MagnifyingGlass size={24} weight="bold" />
                        </div>
                        <h2 className="text-2xl md:text-3xl font-bold font-display text-slate-900 mb-4">Private Auditor Program</h2>
                        <p className="text-slate-600 mb-6 leading-relaxed">
                            While our cryptography engine is public, the frontend application (React, Tailwind, UI) remains closed-source. 
                            To bridge the trust gap, we invite verified security researchers to audit the entire Nest frontend application under a Responsible Disclosure NDA.
                        </p>
                        <p className="text-slate-600 mb-8 font-medium">
                            If you discover a vulnerability, please do not open a public issue. Email us directly.
                        </p>
                        <div className="flex flex-wrap gap-4">
                            <a 
                                href="mailto:admin@lazybird.io?subject=Security Audit Application" 
                                className="inline-flex items-center justify-center h-12 px-6 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold transition-all"
                            >
                                Apply to Audit
                            </a>
                            <a 
                                href="mailto:admin@lazybird.io?subject=Vulnerability Disclosure" 
                                className="inline-flex items-center justify-center h-12 px-6 rounded-xl bg-white hover:bg-slate-50 text-slate-700 font-semibold border border-slate-200 transition-all"
                            >
                                Report Vulnerability
                            </a>
                        </div>
                    </div>
                </div>

                {/* 3. Published Audits */}
                <div className="text-center max-w-2xl mx-auto">
                    <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-slate-100 text-slate-500 mb-6">
                        <BookOpen size={24} />
                    </div>
                    <h2 className="text-2xl font-bold font-display text-slate-900 mb-4">Published Audit Reports</h2>
                    <p className="text-slate-600 mb-8">
                        As third-party audits are completed by independent researchers, we will publish the executive summaries and technical findings here.
                    </p>
                    
                    <div className="p-8 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400">
                        No public audit reports have been published yet.
                    </div>
                </div>

            </section>

            <Footer />
        </div>
    );
};

export default SecurityPage;
export { SecurityPage };
