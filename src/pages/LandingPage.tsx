import { motion, useScroll, useSpring } from 'framer-motion';
import Navbar from '../landing/components/Navbar';
import Hero from '../landing/components/Hero';
import Features from '../landing/components/Features';
import Architecture from '../landing/components/SecurityArchitecture';
import FAQ from '../landing/components/FAQ';
import Pricing from '../landing/components/Pricing';
import Footer from '../landing/components/Footer';

export const LandingPage = () => {
    const { scrollYProgress } = useScroll();
    const scaleX = useSpring(scrollYProgress, {
        stiffness: 100,
        damping: 30,
        restDelta: 0.001
    });

    return (
        <div className="min-h-screen selection:bg-secondary/30 bg-white">
            <motion.div
                className="fixed top-0 left-0 right-0 h-1 bg-primary origin-left z-[100]"
                style={{ scaleX }}
            />
            <Navbar />
            <main>
                <Hero />
                <Features />
                <Architecture />
                <FAQ />
                <Pricing />
            </main>
            <Footer />
        </div>
    );
};
