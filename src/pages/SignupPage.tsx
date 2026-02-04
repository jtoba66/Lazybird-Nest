import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LockKey, EnvelopeSimple, Eye, EyeSlash, ShieldCheck, ArrowLeft } from '@phosphor-icons/react';

export const SignupPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');

    const navigate = useNavigate();
    const { signup } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters long');
            return;
        }

        setLoading(true);
        setLoadingMessage('Generating local keys...');

        try {
            await signup({ email, password });
            navigate('/dashboard');
        } catch (err: any) {
            console.error('Signup error:', err);
            setError(err.message || 'Failed to create account. Please try again.');
        } finally {
            setLoading(false);
            setLoadingMessage('');
        }
    };

    return (
        <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
            {/* Background Gradients (Subtle) */}
            <div className="absolute top-0 left-0 right-0 h-full overflow-hidden -z-10 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 rounded-full blur-[100px]" />
            </div>

            <div className="glass-panel max-w-lg w-full p-6 sm:p-10 animate-in fade-in zoom-in duration-500 border-white/60 shadow-xl">
                <div className="mb-8 sm:mb-10 text-center relative">
                    <button
                        onClick={() => navigate('/')}
                        className="absolute left-0 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-black/5 text-text-muted hover:text-primary transition-all group"
                    >
                        <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                    </button>

                    <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-text-main drop-shadow-sm">
                        Create your Nest
                    </h1>
                    <p className="mt-2 text-text-muted font-medium">Join the zero-knowledge revolution.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-text-main mb-2">
                            Email Address
                        </label>
                        <div className="relative group">
                            <EnvelopeSimple
                                size={20}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors"
                            />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full glass-input pl-12 bg-white/50 focus:bg-white"
                                placeholder="you@example.com"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-text-main mb-2">
                            Password
                        </label>
                        <div className="relative group">
                            <LockKey
                                size={20}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors"
                            />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full glass-input pl-12 pr-12 bg-white/50 focus:bg-white"
                                placeholder="••••••••"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
                            >
                                {showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-text-main mb-2">
                            Confirm Password
                        </label>
                        <div className="relative group">
                            <LockKey
                                size={20}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors"
                            />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full glass-input pl-12 bg-white/50 focus:bg-white"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="bg-error/10 border border-error/20 text-error rounded-xl p-4 text-sm font-medium animate-shake">
                            {error}
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="terms"
                            required
                            className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary focus:ring-offset-0"
                        />
                        <label htmlFor="terms" className="text-sm text-text-muted select-none cursor-pointer">
                            I agree to the <a href="/terms" target="_blank" className="text-primary hover:text-accent-secondary font-bold transition-colors">Terms & Privacy Policy</a>
                        </label>
                    </div>

                    {/* Zero-Knowledge Disclaimer */}
                    <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 space-y-2">
                        <div className="flex items-center gap-2 text-primary">
                            <ShieldCheck size={18} weight="fill" />
                            <span className="text-xs font-bold uppercase tracking-wider">Zero-Knowledge Security</span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-text-muted">
                            Nest uses end-to-end encryption. We do not store your password.
                            <span className="text-text-main font-bold"> If you lose your password, your data is permanently irrecoverable.</span>
                            There is no "Forgot Password" reset.
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="glass-button w-full py-3 sm:py-3.5 text-base sm:text-lg font-bold flex items-center justify-center gap-2 shadow-xl hover:shadow-2xl hover:-translate-y-0.5"
                    >
                        {loading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>{loadingMessage || 'Processing...'}</span>
                            </>
                        ) : (
                            'Create Account'
                        )}
                    </button>
                </form>

                <div className="mt-6 sm:mt-8 text-center">
                    <p className="text-text-muted text-sm">
                        Already have an account?{' '}
                        <button
                            onClick={() => navigate('/login')}
                            className="text-text-main font-bold hover:text-primary transition-colors"
                        >
                            Sign in
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};
