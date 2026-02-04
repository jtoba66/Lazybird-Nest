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
            "url": "https://app.lazybird.io",
            "logo": "https://app.lazybird.io/nest-logo.png",
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
            "description": "Nest is a secure, zero-knowledge cloud storage solution that encrypts your files on your device before storing them on a decentralized network."
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
                        "text": "Zero‑knowledge is a design goal: your files are encrypted on your device and the service stores encrypted data, not readable content. In practice, that means we cannot view the content of your files."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Who is Nest for?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Anyone who wants private storage for personal videos, documents, and projects."
                    }
                },
                {
                    "@type": "Question",
                    "name": "What file types are supported?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Any file type. Previews may vary by format, but downloads always work."
                    }
                },
                {
                    "@type": "Question",
                    "name": "How does sharing work?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "When you share a file, Nest generates a unique link with a built in security key. This key stays strictly on your recipient's device and is never shared with our servers."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Can I share with friends and family?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Yes. Share links are encrypted and revocable, and recipients decrypt locally using the key in the link fragment."
                    }
                },
                {
                    "@type": "Question",
                    "name": "What if I forget my password?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Nest is built so we don’t have access to your decryption keys on the server. That means if you lose your credentials, we will not be able to restore access to your encrypted data."
                    }
                }
            ]
        }
    ];

    return (
        <div className="min-h-screen bg-background text-text-main font-outfit selection:bg-primary/20 selection:text-primary overflow-x-hidden">
            <SEO
                title="Secure Cloud Storage & Encrypted File Sharing"
                description="Nest is the world's most secure cloud storage. Encrypted on your device, stored on a decentralized network. Zero knowledge, zero tracking, 100% privacy."
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
