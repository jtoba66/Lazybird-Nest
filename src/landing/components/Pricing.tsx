import { Check, ArrowRight } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import clsx from 'clsx';

const PricingCard = ({
    title,
    price,
    period,
    features,
    isRecommended = false,
    buttonText = 'Get Started'
}: {
    title: string;
    price: string;
    period: string;
    features: string[];
    isRecommended?: boolean;
    buttonText?: string;
}) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className={`relative p-8 rounded-3xl border ${isRecommended
            ? 'bg-white border-primary shadow-2xl shadow-primary/10'
            : 'bg-white/50 border-slate-100 shadow-premium'
            } flex flex-col h-full group hover:shadow-premium-hover transition-all duration-300`}
    >
        {isRecommended && (
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary text-white text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg">
                Recommended
            </div>
        )}

        <div className="mb-8">
            <h3 className="text-2xl font-display font-bold text-text-main mb-2 tracking-tight uppercase">{title}</h3>
            <div className="flex items-baseline gap-1">
                <span className="text-5xl font-display font-black text-text-main">{price}</span>
                <span className="text-text-muted text-sm font-medium font-sans">/ {period}</span>
            </div>
            <div className={`w-12 h-1 mt-6 transition-colors duration-300 ${isRecommended ? 'bg-primary' : 'bg-slate-100 group-hover:bg-text-main'}`} />
        </div>

        <ul className="space-y-4 mb-10 flex-1">
            {features.map((feature, i) => (
                <li key={i} className="flex items-center gap-3 text-text-muted font-sans font-medium">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isRecommended ? 'bg-primary/10 text-primary' : 'bg-text-main/5 text-text-main'}`}>
                        <Check size={12} weight="bold" />
                    </div>
                    <span>{feature}</span>
                </li>
            ))}
        </ul>

        <a
            href="https://nest.lazybird.io/signup"
            className={`w-full py-4 rounded-2xl font-display font-bold text-lg transition-all flex items-center justify-center gap-2 group ${isRecommended
                ? 'bg-text-main text-white hover:bg-black shadow-lg hover:shadow-xl hover:-translate-y-1'
                : 'bg-white text-text-main border border-slate-200 hover:border-slate-300 shadow-premium'
                }`}>
            {buttonText}
            <ArrowRight size={20} weight="bold" className="group-hover:translate-x-1 transition-transform" />
        </a>
    </motion.div>
);

const Pricing = () => {
    const [isYearly, setIsYearly] = useState(true);

    return (
        <section id="pricing" className="py-32 bg-white relative overflow-hidden border-t border-slate-100">
            <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.8 }}
                className="container mx-auto px-6 relative z-10"
            >
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 text-text-main uppercase tracking-tight">
                        Simple <span className="text-primary italic">Pricing</span>.
                    </h2>
                    <p className="text-text-muted text-xl leading-relaxed font-sans mb-8">
                        Zero compromises on security. Choose the plan that fits your needs.
                    </p>
                    
                    {/* Billing Toggle */}
                    <div className="flex flex-col items-center justify-center gap-3">
                        <div className="relative flex items-center p-1 bg-slate-100 rounded-full border border-slate-200/60 shadow-inner">
                            <div 
                                className="absolute top-1 bottom-1 w-[100px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] transition-transform duration-300 ease-out"
                                style={{ transform: isYearly ? 'translateX(100px)' : 'translateX(0)' }}
                            />
                            
                            <button 
                                onClick={() => setIsYearly(false)}
                                className={clsx(
                                    "relative z-10 w-[100px] py-1.5 text-sm font-bold transition-colors font-sans", 
                                    !isYearly ? "text-text-main" : "text-text-muted hover:text-text-main"
                                )}
                            >
                                Monthly
                            </button>
                            <button 
                                onClick={() => setIsYearly(true)}
                                className={clsx(
                                    "relative z-10 w-[100px] py-1.5 text-sm font-bold transition-colors font-sans", 
                                    isYearly ? "text-text-main" : "text-text-muted hover:text-text-main"
                                )}
                            >
                                Yearly
                            </button>
                        </div>
                        
                        <div className={clsx(
                            "bg-primary/10 text-primary text-[10px] px-3 py-1 rounded-full uppercase tracking-widest font-black transition-opacity duration-300",
                            isYearly ? "opacity-100" : "opacity-0"
                        )}>
                            2 Months Free
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    <PricingCard
                        title="Free"
                        price="$0"
                        period="forever"
                        features={[
                            "2GB Encrypted Storage",
                            "Zero Knowledge Encryption",
                            "Unlimited Sharing",
                            "Standard Support"
                        ]}
                    />
                    <PricingCard
                        title="Pro"
                        price={isYearly ? "$29.99" : "$2.99"}
                        period={isYearly ? "year" : "month"}
                        isRecommended={true}
                        buttonText="Start 7 Day Free Trial"
                        features={[
                            "100GB Encrypted Storage",
                            "Zero Knowledge Encryption",
                            "Unlimited File Sharing",
                            "Priority Support"
                        ]}
                    />
                    <PricingCard
                        title="Max"
                        price={isYearly ? "$129.99" : "$12.99"}
                        period={isYearly ? "year" : "month"}
                        buttonText="Start 7 Day Free Trial"
                        features={[
                            "500GB Encrypted Storage",
                            "Zero Knowledge Encryption",
                            "Unlimited File Sharing",
                            "VIP Support"
                        ]}
                    />
                </div>
            </motion.div>
        </section>
    );
};

export default Pricing;
