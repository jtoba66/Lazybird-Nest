import { motion } from 'framer-motion';

export const PageLoader = () => {
    return (
        <div className="absolute inset-0 flex items-center justify-center bg-white/10 backdrop-blur-sm z-50">
            <div className="flex flex-col items-center gap-3">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full"
                />
                <motion.p
                    className="text-text-muted font-medium"
                    initial={{ opacity: 0.5 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse" }}
                >
                    Loading...
                </motion.p>
            </div>
        </div>
    );
};
