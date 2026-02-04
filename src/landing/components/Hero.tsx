import { ArrowRight } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { lazy, Suspense } from 'react';

const Nest3D = lazy(() => import('./Nest3D'));


const Hero = () => {
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.2,
                delayChildren: 0.3
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 30 },
        visible: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.8, ease: [0.04, 0.62, 0.23, 0.98] as any }
        }
    };

    return (
        <section className="relative min-h-screen flex items-center overflow-hidden bg-background pt-32 pb-20 lg:pt-0 lg:pb-0">
            {/* Background Elements */}
            <div className="absolute inset-0 z-0 bg-mesh opacity-60" />

            <div className="container mx-auto px-6 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    {/* Left Column: Content */}
                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        animate="visible"
                        className="text-center lg:text-left pt-10 lg:pt-0"
                    >
                        <motion.h1
                            variants={itemVariants}
                            className="text-5xl md:text-7xl lg:text-8xl font-display font-extrabold tracking-tight mb-8 leading-[1.05] text-text-main"
                        >
                            Absolute <span className="text-primary relative inline-block">
                                Privacy
                                <svg className="absolute w-full h-3 -bottom-1 left-0 text-secondary/30" viewBox="0 0 100 10" preserveAspectRatio="none">
                                    <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="8" fill="none" />
                                </svg>
                            </span>
                            <br /> by Design.
                        </motion.h1>

                        <motion.div
                            variants={itemVariants}
                            className="max-w-xl mx-auto lg:mx-0 mb-16 relative z-10"
                        >
                            <p className="text-xl text-text-muted leading-relaxed font-display font-medium mb-8">
                                For creators, teams, and anyone sharing sensitive files.
                            </p>

                            <div className="relative inline-block group cursor-default p-4">
                                {/* Layer 1: Main organic liquid splash */}
                                <motion.div
                                    animate={{
                                        borderRadius: [
                                            "66% 34% 75% 25% / 54% 28% 72% 46%",
                                            "34% 66% 25% 75% / 68% 42% 58% 32%",
                                            "78% 22% 44% 56% / 24% 76% 24% 76%",
                                            "20% 80% 60% 40% / 70% 30% 80% 20%",
                                            "66% 34% 75% 25% / 54% 28% 72% 46%"
                                        ],
                                        scale: [1, 1.1, 0.95, 1.05, 1],
                                        rotate: [0, 5, -3, 2, 0]
                                    }}
                                    transition={{ duration: 7, repeat: Infinity, ease: "linear" } as any}
                                    className="absolute inset-0 bg-gradient-to-br from-white/60 via-blue-100/40 to-secondary/30 backdrop-blur-2xl shadow-[0_20px_50px_rgba(141,169,196,0.3)] transition-transform duration-700 group-hover:scale-110"
                                />

                                {/* Layer 2: Shimmer overlay */}
                                <motion.div
                                    animate={{
                                        borderRadius: ["20% 80% 40% 60% / 50% 30% 70% 50%", "80% 20% 70% 30% / 30% 50% 50% 70%", "20% 80% 40% 60% / 50% 30% 70% 50%"],
                                        opacity: [0.3, 0.7, 0.3],
                                    }}
                                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" } as any}
                                    className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/80 to-transparent blur-xl mix-blend-overlay"
                                />

                                {/* Subtitle text inside the splash */}
                                <span className="relative z-10 block font-display font-black text-text-main italic text-lg md:text-2xl tracking-tighter leading-none px-6 py-2 select-none">
                                    Your files. Your keys. <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent not-italic font-extrabold">We see nothing.</span>
                                </span>
                            </div>
                        </motion.div>

                        <motion.div
                            variants={itemVariants}
                            className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start"
                        >
                            <Link to="/signup" className="w-full sm:w-auto px-8 py-4 bg-text-main hover:bg-black text-white rounded-2xl font-display font-bold text-lg transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1 flex items-center justify-center gap-2 group">
                                Get Started
                                <ArrowRight className="group-hover:translate-x-1 transition-transform" weight="bold" />
                            </Link>
                        </motion.div>
                    </motion.div>

                    {/* Right Column: 3D Visual */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 1.2, delay: 0.6, ease: [0.04, 0.62, 0.23, 0.98] as any }}
                        className="relative h-[28rem] md:h-[36rem] lg:h-[42rem] flex items-center justify-center w-full"
                    >
                        <Suspense fallback={
                            <div className="relative w-64 h-64 md:w-80 md:h-80 flex items-center justify-center">
                                <img
                                    src="/nest-logo.png"
                                    alt="Loading Nest..."
                                    className="w-full h-full object-contain animate-pulse opacity-50"
                                />
                            </div>
                        }>
                            <Nest3D />
                        </Suspense>
                    </motion.div>
                </div>
            </div>
        </section>
    );
};

export default Hero;
