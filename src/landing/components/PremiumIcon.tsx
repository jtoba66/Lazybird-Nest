import type { IconProps } from '@phosphor-icons/react';
import React from 'react';

interface PremiumIconProps extends IconProps {
    icon: React.ComponentType<IconProps>;
    className?: string;
}

const PremiumIcon: React.FC<PremiumIconProps> = ({ icon: Icon, className, ...props }) => {
    return (
        <div className={`relative group inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-white to-slate-50 border border-slate-200 shadow-premium transition-transform duration-300 hover:scale-105 ${className}`}>
            {/* Inner Glow to match brand */}
            <div className="absolute inset-0 rounded-2xl bg-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            {/* Icon */}
            <Icon
                weight="duotone"
                size={32}
                {...props}
                className="text-primary group-hover:text-text-main transition-colors duration-300 relative z-10"
            />

            {/* Technical corner accents */}
            <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-slate-200 group-hover:bg-secondary/50 transition-colors" />
            <div className="absolute bottom-2 left-2 w-1 h-1 rounded-full bg-slate-200 group-hover:bg-secondary/50 transition-colors" />
        </div>
    );
};

export default PremiumIcon;
