import { TwitterLogo, GithubLogo } from '@phosphor-icons/react';

const Footer = () => {
    return (
        <footer className="py-24 border-t border-slate-200 bg-white">
            <div className="container mx-auto px-6">
                <div className="flex flex-col md:flex-row justify-between items-start gap-12 mb-20">
                    <div className="flex flex-col gap-6 max-w-sm">
                        <div className="flex items-center gap-3">
                            <img src="/nest-logo.png" alt="Nest Logo" className="h-8 w-auto opacity-90" />
                            <span className="text-2xl font-display font-bold tracking-tight text-text-main">Nest</span>
                        </div>
                        <p className="text-text-muted leading-relaxed font-sans">
                            The secure layer for your digital life.
                            Decentralized, encrypted, and yours.
                        </p>
                        <div className="flex gap-4 mt-2">
                            <a href="https://x.com/LazyBird_io" target="_blank" rel="noopener noreferrer" aria-label="Follow us on X (Twitter)" className="p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-text-muted hover:text-text-main transition-colors border border-slate-100">
                                <TwitterLogo size={20} weight="fill" />
                            </a>
                            <a href="https://github.com/LazyBird-io" target="_blank" rel="noopener noreferrer" aria-label="View our source on GitHub" className="p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-text-muted hover:text-text-main transition-colors border border-slate-100">
                                <GithubLogo size={20} weight="fill" />
                            </a>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-12 w-full md:w-auto">
                        <div>
                            <h4 className="font-display font-bold mb-6 text-text-main uppercase text-sm tracking-wider">Product</h4>
                            <ul className="space-y-4 text-text-muted text-sm font-medium font-sans">
                                <li><a href="#features" className="hover:text-primary transition-colors">Features</a></li>
                                <li><a href="#architecture" className="hover:text-primary transition-colors">Architecture</a></li>
                                <li><a href="#faq" className="hover:text-primary transition-colors">FAQ</a></li>
                                <li><a href="#pricing" className="hover:text-primary transition-colors">Pricing</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-display font-bold mb-6 text-text-main uppercase text-sm tracking-wider">Resources</h4>
                            <ul className="space-y-4 text-text-muted text-sm font-medium font-sans">
                                <li className="flex items-center gap-2 opacity-40 cursor-not-allowed">
                                    <span>Documentation</span>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 font-bold uppercase tracking-tighter">Soon</span>
                                </li>
                                <li className="flex items-center gap-2 opacity-40 cursor-not-allowed">
                                    <span>API</span>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 font-bold uppercase tracking-tighter">Soon</span>
                                </li>
                                <li className="flex items-center gap-2 opacity-40 cursor-not-allowed">
                                    <span>Status</span>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 font-bold uppercase tracking-tighter">Soon</span>
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-display font-bold mb-6 text-text-main uppercase text-sm tracking-wider">Company</h4>
                            <ul className="space-y-4 text-text-muted text-sm font-medium font-sans">
                                <li><a href="#" className="hover:text-primary transition-colors">About</a></li>
                                <li className="flex items-center gap-2 opacity-40 cursor-not-allowed">
                                    <span>Blog</span>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 font-bold uppercase tracking-tighter">Soon</span>
                                </li>
                                <li className="flex items-center gap-2 opacity-40 cursor-not-allowed">
                                    <span>Contact</span>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 font-bold uppercase tracking-tighter">Soon</span>
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-display font-bold mb-6 text-text-main uppercase text-sm tracking-wider">Legal</h4>
                            <ul className="space-y-4 text-text-muted text-sm font-medium font-sans">
                                <li><a href="https://nest.lazybird.io/terms" className="hover:text-primary transition-colors">Privacy</a></li>
                                <li><a href="https://nest.lazybird.io/terms" className="hover:text-primary transition-colors">Terms</a></li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-text-light text-sm pt-8 border-t border-slate-100 font-sans">
                    <div>&copy; 2026 LazyBird Inc.</div>
                    <div className="flex gap-6">
                        <span>Designed in California</span>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
