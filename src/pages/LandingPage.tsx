import Navbar from '../landing/components/Navbar';
import Hero from '../landing/components/Hero';
import Features from '../landing/components/Features';
import SecurityArchitecture from '../landing/components/SecurityArchitecture';
import Pricing from '../landing/components/Pricing';
import FAQ from '../landing/components/FAQ';
import Footer from '../landing/components/Footer';
import SEO from '../components/SEO';

export const LandingPage = () => {
    return (
        <div className="min-h-screen bg-background text-text-main font-outfit selection:bg-primary/20 selection:text-primary overflow-x-hidden">
            <SEO
                title="Secure Cloud Storage & Encrypted File Sharing"
                description="Nest is the world's most secure cloud storage. Encrypted on your device, stored on a decentralized network. Zero knowledge, zero tracking, 100% privacy."
            />
            <Navbar />
            <main>
                <Hero />
                <Features />
                <SecurityArchitecture />
                <FAQ />
                <Pricing />
            </main>
            <Footer />
        </div >
    );
};
