import { ShareNetwork, HardDrives, Fingerprint, Lightning } from '@phosphor-icons/react';

const Features = () => {
    const features = [
        {
            icon: ShareNetwork,
            title: "Secure Sharing",
            description: "Share files with secure, encrypted links. Only the recipient with the link can decrypt the content.",
        },
        {
            icon: HardDrives,
            title: "10GB+ File Support",
            description: "Upload massive files with our chunking engine. Resumable uploads ensure you never lose progress.",
        },
        {
            icon: Fingerprint,
            title: "Metadata Encryption",
            description: "We encrypt everything. Filenames, folder structures, and file types are invisible to the server.",
        },
        {
            icon: Lightning,
            title: "Blazing Fast",
            description: "Optimized streaming encryption and decentralized delivery network for high performance access.",
        }
    ];

    return (
        <section id="features" className="py-32 relative overflow-hidden bg-background">
            <div className="container mx-auto px-6">
                <div className="text-center max-w-3xl mx-auto mb-20">
                    <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 text-text-main">
                        Built for <span className="text-primary">Privacy</span>.
                        <br />Designed for <span className="text-text-main">Speed</span>.
                    </h2>
                    <p className="text-text-muted text-xl leading-relaxed font-sans">
                        Enterprise grade security meets consumer grade usability.
                        No complex keys to manage, just login and go.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-16">
                    {features.map((feature, idx) => (
                        <div key={idx} className="relative group p-4 pl-8 border-l-2 border-slate-100 hover:border-primary transition-colors duration-300">
                            <h3 className="text-2xl font-display font-bold mb-3 text-slate-900">{feature.title}</h3>
                            <p className="text-lg text-slate-500 font-sans leading-relaxed">{feature.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default Features;
