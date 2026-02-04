import Navbar from '../landing/components/Navbar';
import Hero from '../landing/components/Hero';
import Features from '../landing/components/Features';
import SecurityArchitecture from '../landing/components/SecurityArchitecture';
import Pricing from '../landing/components/Pricing';
import FAQ from '../landing/components/FAQ';
import Footer from '../landing/components/Footer';
import SEO from '../components/SEO';

export const LandingPage = () => {
    const jsonLd = [
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "LazyBird Nest",
            "url": "https://nest.lazybird.io",
            "logo": "https://nest.lazybird.io/nest-logo.png",
            "description": "Zero-knowledge decentralized cloud storage provider."
        },
        {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "Nest",
            "applicationCategory": "UtilitiesApplication",
            "operatingSystem": "Web",
            "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
            },
            "featureList": "Zero-Knowledge Encryption, Decentralized Storage, Secure File Sharing, Private Vault",
            "description": "Nest is a secure, zero-knowledge cloud storage solution that encrypts your files based on AES-256-GCM and Argon2id."
        },
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "What is zero‑knowledge?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Zero‑knowledge is a design goal your files are encrypted on your device and the service stores encrypted data, not readable content. We cannot view your files."
                    }
                },
                {
                    "@type": "Question",
                    "name": "What if I forget my password?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "We don’t store your decryption keys. If you lose your password (and don’t have recovery enabled), your files can’t be decrypted."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Who is Nest for?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "For creators, teams, and anyone sharing sensitive files."
                    }
                }
            ]
        }
    ];

    return (
        <div className="min-h-screen bg-background text-text-main font-outfit selection:bg-primary/20 selection:text-primary overflow-x-hidden">
            <SEO
                title="Secure Cloud Storage & Encrypted File Sharing"
                description="The private cloud storage for creators, teams, and anyone sharing sensitive files. Zero knowledge, zero tracking, 100% privacy."
                image="/og-image.png"
                jsonLd={jsonLd}
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
