import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface TiltCardProps {
    children: React.ReactNode;
    className?: string;
}

const TiltCard: React.FC<TiltCardProps> = ({ children, className = "" }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);

    const x = useMotionValue(0);
    const y = useMotionValue(0);

    // Mouse tracking physics
    const mouseX = useSpring(x, { stiffness: 500, damping: 40 });
    const mouseY = useSpring(y, { stiffness: 500, damping: 40 });

    const rotateX = useTransform(mouseY, [-0.5, 0.5], ["7deg", "-7deg"]);
    const rotateY = useTransform(mouseX, [-0.5, 0.5], ["-7deg", "7deg"]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!ref.current) return;

        const rect = ref.current.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        const mouseXPos = e.clientX - rect.left;
        const mouseYPos = e.clientY - rect.top;

        const xPct = mouseXPos / width - 0.5;
        const yPct = mouseYPos / height - 0.5;

        x.set(xPct);
        y.set(yPct);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        x.set(0);
        y.set(0);
    };

    return (
        <motion.div
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={handleMouseLeave}
            style={{
                rotateX,
                rotateY,
                transformStyle: "preserve-3d",
            }}
            className={`relative transform-gpu ${className}`}
        >
            <div
                style={{
                    transform: "translateZ(50px)",
                    transformStyle: "preserve-3d",
                }}
                className="relative h-full bg-white/50 backdrop-blur-xl border border-white/60 rounded-[2.5rem] shadow-xl p-10 overflow-hidden group"
            >
                {/* Spotlight Effect */}
                <motion.div
                    className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300 group-hover:opacity-100 z-0"
                    style={{
                        background: useTransform(
                            [mouseX, mouseY],
                            ([latestX, latestY]: any[]) => {
                                const x = Number(latestX);
                                const y = Number(latestY);
                                return `radial-gradient(600px circle at ${x * 100 + 50}% ${y * 100 + 50}%, rgba(141, 169, 196, 0.15), transparent 40%)`
                            }
                        ),
                    }}
                />

                {/* Content Container */}
                <div className="relative z-10 h-full flex flex-col">
                    {children}
                </div>

                {/* Border Gradient on Hover */}
                <div className="absolute inset-0 rounded-[2.5rem] border-2 border-transparent group-hover:border-primary/10 transition-colors duration-300 pointer-events-none" />
            </div>

            {/* Back glow for depth */}
            <motion.div
                className="absolute inset-4 bg-primary/20 blur-[60px] -z-10 transition-opacity duration-500"
                animate={{ opacity: isHovered ? 0.6 : 0 }}
            />
        </motion.div>
    );
};

export default TiltCard;
