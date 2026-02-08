import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { ArrowLeft, Scroll, LockKey, Gavel, Handshake } from '@phosphor-icons/react';
import SEO from '../components/SEO';

export const TermsPage = () => {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (location.pathname === '/privacy') {
            const el = document.getElementById('privacy-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
    }, [location.pathname]);

    const isPrivacy = location.pathname === '/privacy';
    const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';
    const description = isPrivacy
        ? 'Read our Privacy Policy. Zero-knowledge encryption means we cannot see your files.'
        : 'Read our Terms of Service. Understand your rights and responsibilities when using Nest.';
    const canonical = isPrivacy ? 'https://nest.lazybird.io/privacy' : 'https://nest.lazybird.io/terms';

    return (
        <div className="min-h-[100dvh] bg-background text-text-main p-4 sm:p-6 md:p-12 overflow-y-auto custom-scrollbar">
            <SEO title={title} description={description} canonical={canonical} />
            <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Header */}
                <div className="mb-6 sm:mb-8 flex items-center gap-4">
                    <button
                        onClick={() => navigate("/")}
                        className="p-2 rounded-xl hover:bg-white/10 transition-colors text-text-muted hover:text-text-main"
                    >
                        <ArrowLeft size={24} weight="bold" />
                    </button>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
                            <Scroll size={32} className="text-primary scale-90 sm:scale-100" weight="duotone" />
                            Use Terms & Privacy
                        </h1>
                        <p className="text-text-muted mt-1">Unified Legal Agreement • Last Updated: January 2026</p>
                    </div>
                </div>

                {/* Content */}
                <div className="glass-panel p-5 sm:p-8 md:p-12 prose prose-sm sm:prose-base prose-invert max-w-none prose-headings:text-text-main prose-p:text-text-muted prose-strong:text-text-main prose-a:text-primary hover:prose-a:text-secondary prose-li:text-text-muted">

                    <div className="bg-primary/10 border border-primary/20 p-6 rounded-xl mb-12 not-prose">
                        <h3 className="font-bold text-text-main text-lg m-0 mb-1">Agreement to Terms</h3>
                        <p className="text-text-muted text-sm m-0">By accessing or using Nest, you agree to be bound by these unified Terms of Service and Privacy Policy.</p>
                    </div>

                    {/* Section 1: Core Service Terms (From Landing) */}
                    <div className="flex items-center gap-2 mb-4 not-prose">
                        <Handshake size={24} className="text-secondary" weight="duotone" />
                        <h2 className="text-2xl font-bold text-text-main m-0">Part I: Service Usage</h2>
                    </div>
                    <hr className="border-text-muted/20 mb-8" />

                    <h3>1. Usage License & Acceptable Use</h3>
                    <p>
                        LazyBird grants you a revocable, non-exclusive, non-transferable, limited license to use Nest strictly in accordance with these terms.
                        You agree <strong>not to use the Service specifically to host illegal content, malware, or content that infringes on intellectual property rights.</strong>
                    </p>

                    <h3>2. Decentralized Nature</h3>
                    <p>
                        You acknowledge that our services interact with decentralized networks (such as Jackal Protocol).
                        <strong>Jackal Protocol operates through independent storage providers that LazyBird Inc. does not own or control.</strong>{" "}
                        While we aim for high availability, we cannot guarantee that files stored on decentralized infrastructure will remain accessible indefinitely.
                        LazyBird cannot reverse transactions, recover lost private keys, or restore access to encrypted data if you lose your credentials.
                        You are solely responsible for your wallet and account security.
                    </p>

                    <h3>3. Subscription & Refunds</h3>
                    <p>
                        Payments for premium services (LazyBird Studio and Nest Pro) are securely processed via Stripe.
                        We are committed to satisfaction and offer refunds for these services if requested within 14 days of purchase.
                        Please contact <a href="mailto:admin@lazybird.io">admin@lazybird.io</a> to initiate a refund request.
                    </p>

                    {/* Section 2: Privacy & Data (From Landing + Nest Specifics) */}
                    <div id="privacy-section" className="flex items-center gap-2 mt-12 mb-4 not-prose scroll-mt-24">
                        <LockKey size={24} className="text-primary" weight="duotone" />
                        <h2 className="text-2xl font-bold text-text-main m-0">Part II: Privacy & Encryption</h2>
                    </div>
                    <hr className="border-text-muted/20 mb-8" />

                    <h3>4. Zero-Knowledge Architecture</h3>
                    <p>
                        Nest employs a Zero-Knowledge (Host-Proof) architecture. Your password never leaves your device.
                        Encryption keys are derived client-side (using Argon2id), ensuring <strong>we cannot access your raw password or decrypt your private files.</strong>
                    </p>
                    <div className="bg-error/10 border border-error/20 p-4 rounded-xl my-4 not-prose">
                        <strong className="text-error block mb-1">CRITICAL NOTICE:</strong>
                        <p className="text-text-muted text-sm m-0">
                            <strong>LazyBird Inc. does not store or recover user encryption keys.</strong>
                            If you lose your key (password and recovery phrase), your files cannot be restored by anyone, including us.
                        </p>
                    </div>

                    <h3>5. Data Privacy</h3>
                    <p>
                        Unlike traditional platforms, we do not monetize your data or track your personal usage habits.
                        Files uploaded to Nest are privately encrypted (XChaCha20-Poly1305) and can only be decrypted by you.
                    </p>

                    {/* Section 3: Liability & Legal (The 10 New Clauses) */}
                    <div className="flex items-center gap-2 mt-12 mb-4 not-prose">
                        <Gavel size={24} className="text-text-muted" weight="duotone" />
                        <h2 className="text-2xl font-bold text-text-main m-0">Part III: Liability & Legal Disclaimers</h2>
                    </div>
                    <hr className="border-text-muted/20 mb-8" />

                    <h3>6. No Data Guarantee & Backups</h3>
                    <p>
                        <strong>LazyBird Inc. does not guarantee the storage, integrity, or availability of any files uploaded by users.</strong>{" "}
                        Users acknowledge that they are <strong>solely responsible for backing up their data.</strong>{" "}
                        LazyBird Inc. is not a backup service provider and is not liable for any loss resulting from a failure to maintain independent backups.
                    </p>

                    <h3>7. Limitation of Liability</h3>
                    <p>
                        To the maximum extent permitted by law, <strong>LazyBird Inc.’s total liability for any claim arising from the use of the service shall not exceed the total amount paid by the user in the past 12 months.</strong>{" "}
                        This limit applies regardless of the form of action, whether in contract, tort (including negligence), strict liability, or otherwise.
                    </p>

                    <h3>8. No Consequential Damages</h3>
                    <p>
                        <strong>LazyBird Inc. shall not be liable for any indirect, incidental, special, exemplary, or consequential damages,</strong>{" "}
                        including but not limited to loss of data, revenue, profits, business interruption, or goodwill, arising out of or in connection with the use or inability to use the Service.
                    </p>

                    <h3>9. Service Availability & Modification</h3>
                    <p>
                        Our services, including those relying on decentralized networks, may be subject to interruptions, delays, or errors.{" "}
                        <strong>LazyBird Inc. does not guarantee continuous or error-free operation of the platform.</strong>{" "}
                        We reserve the right to modify, suspend, or discontinue any part of the Service at any time without liability.
                    </p>

                    <h3>10. Force Majeure</h3>
                    <p>
                        LazyBird Inc. is not responsible for failures outside its reasonable control, including but not limited to{" "}
                        network outages, provider failures, cyberattacks, government action, war, or natural disasters.
                    </p>

                    <h3>11. Access Layer Clarification</h3>
                    <p>
                        <strong>LazyBird Nest is an access layer and interface to decentralized storage protocols.</strong>{" "}
                        LazyBird Inc. does not own, operate, or control the underlying storage infrastructure and is not the custodian of user data stored on third-party decentralized networks.
                        Nest provides file encryption, organization, and gateway services only.
                    </p>

                    <h3>12. Data Loss Acknowledgment</h3>
                    <p>
                        By using Nest, you explicitly acknowledge that <strong>data may become corrupted, inaccessible, or lost,</strong>{" "}
                        including due to network issues, software bugs, third-party infrastructure failures, or user error.
                    </p>

                    <h3>13. Arbitration & Class Action Waiver</h3>
                    <p>
                        <strong>Any dispute arising from the use of Nest will be resolved exclusively through binding arbitration, not in court.</strong>{" "}
                        You and LazyBird Inc. agree to waive any right to a jury trial or to participate in a class action lawsuit.
                    </p>

                    <div className="mt-12 pt-8 border-t border-text-muted/20 text-center">
                        <p className="text-text-muted text-sm">
                            Questions? Contact us at <a href="mailto:admin@lazybird.io">admin@lazybird.io</a>
                        </p>
                    </div>

                </div>
            </div>
        </div>
    );
};
