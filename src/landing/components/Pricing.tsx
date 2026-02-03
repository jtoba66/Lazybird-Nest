import { Check, ArrowRight } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

const PricingCard = ({
    title,
    price,
    features,
    isRecommended = false
}: {
    title: string;
    price: string;
    features: string[];
    isRecommended?: boolean;
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
                <span className="text-text-muted text-sm font-medium font-sans">/ month</span>
            </div>
            <div className="w-12 h-1 bg-slate-100 mt-6 group-hover:bg-primary transition-colors duration-300" />
        </div>

        <ul className="space-y-4 mb-10 flex-1">
            {features.map((feature, i) => (
                <li key={i} className="flex items-center gap-3 text-text-muted font-sans font-medium">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                        <Check size={12} weight="bold" />
                    </div>
                    <span>{feature}</span>
                </li>
            ))}
        </ul>

        <button className={`w-full py-4 rounded-2xl font-display font-bold text-lg transition-all flex items-center justify-center gap-2 group ${isRecommended
            ? 'bg-text-main text-white hover:bg-black shadow-lg hover:shadow-xl hover:-translate-y-1'
            : 'bg-white text-text-main border border-slate-200 hover:border-slate-300 shadow-premium'
            }`}>
            {isRecommended ? 'Get Pro' : 'Get Started'}
            <ArrowRight size={20} weight="bold" className="group-hover:translate-x-1 transition-transform" />
        </button>
    </motion.div>
);

const Pricing = () => {
    return (
        <section id="pricing" className="py-32 bg-white relative overflow-hidden border-t border-slate-100">
            <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.8 }}
                className="container mx-auto px-6 relative z-10"
            >
                <div className="text-center max-w-3xl mx-auto mb-20">
                    <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 text-text-main uppercase tracking-tight">
                        Simple <span className="text-primary italic">Pricing</span>.
                    </h2>
                    <p className="text-text-muted text-xl leading-relaxed font-sans">
                        Zero compromises on security. Choose the plan that fits your needs.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                    <PricingCard
                        title="Free"
                        price="$0"
                        features={[
                            "2GB Encrypted Storage",
                            "Zero Knowledge Encryption",
                            "Unlimited Sharing",
                            "Standard Support"
                        ]}
                    />
                    <PricingCard
                        title="Pro"
                        price="$2.99"
                        isRecommended={true}
                        features={[
                            "100GB Encrypted Storage",
                            "Zero Knowledge Encryption",
                            "Unlimited File Sharing",
                            "Priority Support"
                        ]}
                    />
                </div>
            </motion.div>
        </section>
    );
};

export default Pricing;
