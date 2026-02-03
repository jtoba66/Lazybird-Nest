import Navbar from '../landing/components/Navbar';
import Hero from '../landing/components/Hero';
import Features from '../landing/components/Features';
import Architecture from '../landing/components/SecurityArchitecture';
import FAQ from '../landing/components/FAQ';
import Pricing from '../landing/components/Pricing';
import Footer from '../landing/components/Footer';

export const LandingPage = () => {
    return (
        <div className="min-h-screen selection:bg-secondary/30 bg-white">
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
