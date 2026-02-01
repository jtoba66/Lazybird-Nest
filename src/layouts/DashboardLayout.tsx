import { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { UploadProgress } from '../components/UploadProgress';
import { QuotaBanner } from '../components/QuotaBanner';
import type { ReactNode } from 'react';

interface DashboardLayoutProps {
    children: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <div className="flex min-h-[100dvh] w-full bg-background md:h-screen md:p-4 gap-0 md:gap-4 overflow-hidden relative">
            {/* Mobile Sidebar Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar Container - Mobile: Fixed Drawer, Desktop: Static Block */}
            <div className={`
                fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-300 ease-in-out md:static md:translate-x-0 md:w-64 md:flex-shrink-0 md:h-full
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <Sidebar onClose={() => setSidebarOpen(false)} />
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 h-full w-full">
                <QuotaBanner />

                {/* Header */}
                <div className="mb-2 pt-2 px-2 md:mb-4 md:pt-0 md:px-0">
                    <Header onMenuClick={() => setSidebarOpen(true)} />
                </div>

                {/* Main Page Content */}
                <main className="flex-1 relative overflow-y-auto flex flex-col custom-scrollbar px-2 md:px-0 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:pb-2">
                    {children}
                </main>
            </div>

            <UploadProgress />
        </div>
    );
};
