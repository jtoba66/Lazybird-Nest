import { useState } from 'react';
import {
    Check,
    Crown,
    Cloud,
    ShieldCheck,
    ShareNetwork,
    Headset,
    ArrowRight
} from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { billingAPI } from '../api/billing';
import { useToast } from '../contexts/ToastContext';
import clsx from 'clsx';

const FeatureItem = ({ label }: { label: string }) => (
    <div className="flex items-center gap-3 text-text-muted">
        <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
            <Check size={12} weight="bold" />
        </div>
        <span className="text-sm font-medium">{label}</span>
    </div>
);

export const PricingPage = () => {
    const { showToast } = useToast();
    const [loading, setLoading] = useState<string | null>(null);

    const handleUpgrade = async () => {
        try {
            setLoading('pro');
            const { url } = await billingAPI.createCheckoutSession();
            window.location.href = url;
        } catch (error) {
            console.error('Upgrade failed:', error);
            showToast('Failed to start checkout. Please try again later.', 'error');
            setLoading(null);
        }
    };

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0 }
    };

    return (
        <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="h-full p-4 md:p-6 lg:p-8 flex flex-col overflow-y-auto custom-scrollbar"
        >
            {/* Header - Compact */}
            <motion.div variants={itemVariants} className="text-center max-w-2xl mx-auto mb-8 md:mb-12">
                <h1 className="text-3xl md:text-4xl font-bold text-text-main mb-2 tracking-tight">
                    Simple, Transparent <span className="text-primary italic">Pricing</span>
                </h1>
                <p className="text-text-muted text-sm md:text-base">
                    All plans include industry standard zero knowledge encryption.
                </p>
            </motion.div>

            {/* Pricing Grid - Identical Card Sizes */}
            <div className="flex-1 flex items-start justify-center min-h-0 mb-8 md:mb-12">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 w-full max-w-5xl items-stretch">
                    {/* Free Tier */}
                    <motion.div
                        variants={itemVariants}
                        whileHover={{ y: -5 }}
                        className="glass-panel p-6 lg:p-8 flex flex-col h-full border-2 border-transparent hover:border-text-muted/10 transition-colors duration-300"
                    >
                        <div className="mb-6">
                            <div className="w-12 h-12 rounded-2xl bg-background flex items-center justify-center text-text-muted mb-4 shadow-sm">
                                <Cloud size={24} weight="duotone" />
                            </div>
                            <h3 className="text-xl font-bold text-text-main mb-1">Free</h3>
                            <div className="flex items-baseline gap-1">
                                <span className="text-3xl sm:text-4xl font-black text-text-main">$0</span>
                                <span className="text-text-muted text-xs font-medium">/ month</span>
                            </div>
                        </div>

                        <div className="space-y-4 mb-8 flex-1">
                            <FeatureItem label="2GB Encrypted Storage" />
                            <FeatureItem label="Zero Knowledge Encryption" />
                            <FeatureItem label="Unlimited Sharing" />
                            <FeatureItem label="Basic Support" />
                        </div>

                        <button
                            disabled
                            className="w-full py-3.5 rounded-xl border-2 border-text-muted/10 text-text-muted font-bold text-sm cursor-not-allowed mt-auto"
                        >
                            Current Plan
                        </button>
                    </motion.div>

                    {/* Pro Tier */}
                    <motion.div
                        variants={itemVariants}
                        whileHover={{ y: -5 }}
                        className="glass-panel p-6 lg:p-8 flex flex-col h-full relative border-2 border-primary/20 shadow-xl shadow-primary/5 hover:border-primary/40 hover:shadow-primary/20 transition-all duration-300"
                    >
                        {/* Badge */}
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-secondary text-white text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg z-10">
                            Recommended
                        </div>

                        <div className="mb-6">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-4 shadow-inner">
                                <Crown size={24} weight="duotone" />
                            </div>
                            <h3 className="text-xl font-bold text-text-main mb-1">Pro</h3>
                            <div className="flex items-baseline gap-1">
                                <span className="text-3xl sm:text-4xl font-black text-text-main">$2.99</span>
                                <span className="text-text-muted text-xs font-medium">/ month</span>
                            </div>
                        </div>

                        <div className="space-y-4 mb-8 flex-1">
                            <FeatureItem label="100GB Encrypted Storage" />
                            <FeatureItem label="Zero Knowledge Encryption" />
                            <FeatureItem label="Unlimited File Sharing" />
                            <FeatureItem label="Priority Support" />
                        </div>

                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleUpgrade}
                            disabled={loading === 'pro'}
                            className={clsx(
                                "w-full py-3.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-bold text-sm shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 group mt-auto relative overflow-hidden",
                                loading === 'pro' && "opacity-70 cursor-wait"
                            )}
                        >
                            <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out"></div>
                            {loading === 'pro' ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <span className="relative z-10">Upgrade to Pro</span>
                                    <ArrowRight size={16} weight="bold" className="group-hover:translate-x-1 transition-transform relative z-10" />
                                </>
                            )}
                        </motion.button>
                    </motion.div>
                </div>
            </div>

            {/* Trust Badges - More Compact */}
            <motion.div variants={itemVariants} className="max-w-5xl mx-auto w-full pt-6 border-t border-text-muted/10">
                <div className="grid grid-cols-3 gap-4">
                    <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center text-center group cursor-default">
                        <ShieldCheck size={24} weight="duotone" className="text-primary mb-2 opacity-80 group-hover:opacity-100 transition-opacity" />
                        <span className="text-[10px] font-bold text-text-main uppercase tracking-wider">Military-Grade</span>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center text-center border-x border-text-muted/10 group cursor-default">
                        <ShareNetwork size={24} weight="duotone" className="text-primary mb-2 opacity-80 group-hover:opacity-100 transition-opacity" />
                        <span className="text-[10px] font-bold text-text-main uppercase tracking-wider">Always On</span>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center text-center group cursor-default">
                        <Headset size={24} weight="duotone" className="text-primary mb-2 opacity-80 group-hover:opacity-100 transition-opacity" />
                        <span className="text-[10px] font-bold text-text-main uppercase tracking-wider">24/7 Support</span>
                    </motion.div>
                </div>
            </motion.div>
        </motion.div>
    );
};
