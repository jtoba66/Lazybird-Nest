import { SignOut, List } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
    onMenuClick?: () => void;
}

export const Header = ({ onMenuClick }: HeaderProps) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <header className="h-14 md:h-16 glass-panel flex items-center justify-between px-4 md:px-6">
            <div className="flex items-center gap-4 flex-1">
                <button
                    onClick={onMenuClick}
                    className="p-2 -ml-2 text-text-main hover:bg-black/5 rounded-lg md:hidden"
                >
                    <List size={24} weight="bold" />
                </button>
                <div className="text-sm text-text-muted truncate hidden md:block">
                    Signed in as <span className="text-text-main font-medium">{user?.email}</span>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 p-2 text-text-muted hover:text-error hover:bg-error/10 rounded-xl transition-all"
                >
                    <SignOut size={20} />
                    <span className="text-sm font-medium hidden md:inline">Sign Out</span>
                </button>
            </div>
        </header>
    );
};
