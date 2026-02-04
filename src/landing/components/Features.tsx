import { ShareNetwork, HardDrives, Fingerprint, Lightning } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

const Features = () => {
    const features = [
        {
            icon: ShareNetwork,
            title: "Secure Sharing",
            description: "Share files with secure, encrypted links. Only the recipient with the link can decrypt the content.",
        },
        {
            icon: HardDrives,
            title: "Decentralized Storage",
            description: "Your files are split into encrypted chunks and stored redundantly across a global network.",
        },
        {
            icon: Fingerprint,
            title: "Client-Side Encryption",
            description: "AES-256-GCM (streaming) encryption. Keys derived via Argon2id. We never see your password or files.",
        },
        {
            icon: Lightning,
            title: "Blazing Fast",
            description: "Optimized streaming encryption and decentralized delivery network for high performance access.",
        }
    ];

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.15
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, x: -20 },
        visible: {
            opacity: 1,
            x: 0,
            transition: { duration: 0.6, ease: "easeOut" } as any
        }
    };

    return (
        <section id="features" className="py-32 relative overflow-hidden bg-background">
            <div className="container mx-auto px-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.8 }}
                    className="text-center max-w-3xl mx-auto mb-20"
                >
                    <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 text-text-main">
                        Built for <span className="text-primary">Privacy</span>.
                        <br />Designed for <span className="text-text-main">Speed</span>.
                    </h2>
                    <p className="text-text-muted text-xl leading-relaxed font-sans">
                        Enterprise grade security meets consumer grade usability.
                        No complex keys to manage. If you lose your password, your data is lost forever because we cannot decrypt it for you.
                    </p>
                </motion.div>

                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-50px" }}
                    className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-16"
                >
                    {features.map((feature, idx) => (
                        <motion.div
                            key={idx}
                            variants={itemVariants}
                            className="relative group p-4 pl-8 border-l-2 border-slate-100 hover:border-primary transition-colors duration-300"
                        >
                            <h3 className="text-2xl font-display font-bold mb-3 text-slate-900">{feature.title}</h3>
                            <p className="text-lg text-slate-500 font-sans leading-relaxed">{feature.description}</p>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </section>
    );
};

export default Features;
