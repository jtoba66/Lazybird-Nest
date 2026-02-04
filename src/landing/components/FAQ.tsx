import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CaretDown } from '@phosphor-icons/react';

const FAQItem = ({ question, answer }: { question: string; answer: string }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="border-b border-slate-200/60">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full py-6 md:py-8 flex items-center justify-between text-left group transition-all"
            >
                <h3 className="text-lg md:text-xl font-display font-bold text-text-main group-hover:text-primary transition-colors pr-8">
                    {question}
                </h3>
                <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" } as any}
                    className="flex-shrink-0 text-text-muted group-hover:text-primary transition-colors"
                >
                    <CaretDown size={24} weight="bold" />
                </motion.div>
            </button>
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] } as any}
                        className="overflow-hidden"
                    >
                        <div className="pb-8 pr-12 text-base md:text-lg text-text-muted font-sans leading-relaxed">
                            {answer}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const FAQ = () => {
    const faqs = [
        {
            question: "What is zero‑knowledge?",
            answer: "Zero‑knowledge is a design goal your files are encrypted on your device and the service stores encrypted data, not readable content. In practice, that means we cannot view the content of your files."
        },
        {
            question: "Who is Nest for?",
            answer: "Anyone who wants private storage for personal videos, documents, and projects."
        },
        {
            question: "What file types are supported?",
            answer: "Any file type. Previews may vary by format, but downloads always work."
        },
        {
            question: "How does sharing work?",
            answer: "When you share a file, Nest generates a unique link with a built in security key. This key stays strictly on your recipient's device and is never shared with our servers. You are always in control and can revoke access to any shared link instantly."
        },
        {
            question: "Can I share with friends and family?",
            answer: "Yes. Share links are encrypted and revocable, and recipients decrypt locally using the key in the link fragment."
        },
        {
            question: "What if I forget my password?",
            answer: "Nest is built so we don’t have access to your decryption keys on the server. That means if you lose your credentials, we will not be able to restore access to your encrypted data. See the Terms for details."
        }
    ];

    return (
        <section id="faq" className="py-32 bg-white relative overflow-hidden">
            <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.8 }}
                className="container mx-auto px-6 relative z-10"
            >
                <div className="max-w-4xl mx-auto">
                    <div className="text-left mb-12 border-b border-text-main pb-8">
                        <h2 className="text-4xl md:text-5xl font-display font-extrabold tracking-tight text-text-main uppercase">
                            FAQ<span className="text-primary italic">.</span>
                        </h2>
                    </div>

                    <div className="flex flex-col">
                        {faqs.map((faq, idx) => (
                            <FAQItem
                                key={idx}
                                question={faq.question}
                                answer={faq.answer}
                            />
                        ))}
                    </div>
                </div>
            </motion.div>
        </section>
    );
};

export default FAQ;
