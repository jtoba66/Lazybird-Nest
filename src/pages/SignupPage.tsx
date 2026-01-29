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
            navigate('/nest');
        } catch (err: any) {
            console.error('Signup error:', err);
            setError(err.message || 'Failed to create account. Please try again.');
        } finally {
            setLoading(false);
            setLoadingMessage('');
        }
    };

    return (
        <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 bg-[#0a0a0a] text-white">
            <div className="absolute inset-0 overflow-hidden -z-10">
                <div className="absolute top-1/4 left-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-primary/20 rounded-full blur-[120px] animate-pulse" />
                <div className="absolute bottom-1/4 right-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-secondary/10 rounded-full blur-[120px] animate-pulse delay-700" />
            </div>

            <div className="glass-panel max-w-lg w-full p-6 sm:p-10 animate-in fade-in zoom-in duration-500">
                <div className="mb-8 sm:mb-10 text-center relative">
                    <button
                        onClick={() => navigate('/')}
                        className="absolute left-0 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-white/5 text-text-muted hover:text-primary transition-all group"
                    >
                        <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                    </button>

                    <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white drop-shadow-md">
                        Create your Nest
                    </h1>
                    <p className="mt-2 text-blue-200/80 font-medium">Join the zero-knowledge revolution.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-200 mb-2">
                            Email Address
                        </label>
                        <div className="relative group">
                            <EnvelopeSimple
                                size={20}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors"
                            />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full glass-input pl-12"
                                placeholder="you@example.com"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-200 mb-2">
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
                                className="w-full glass-input pl-12 pr-12"
                                placeholder="••••••••"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                            >
                                {showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-200 mb-2">
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
                                className="w-full glass-input pl-12"
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
                            className="w-4 h-4 rounded border-text-muted/30 bg-white/5 text-primary focus:ring-primary focus:ring-offset-0"
                        />
                        <label htmlFor="terms" className="text-sm text-slate-300 select-none cursor-pointer">
                            I agree to the <a href="/terms" target="_blank" className="text-primary hover:text-blue-300 font-medium transition-colors">Terms & Privacy Policy</a>
                        </label>
                    </div>

                    {/* Zero-Knowledge Disclaimer */}
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="flex items-center gap-2 text-primary">
                            <ShieldCheck size={18} weight="fill" />
                            <span className="text-xs font-bold uppercase tracking-wider">Zero-Knowledge Security</span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-300">
                            Nest uses end-to-end encryption. We do not store your password.
                            <span className="text-white font-semibold"> If you lose your password, your data is permanently irrecoverable.</span>
                            There is no "Forgot Password" reset.
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="glass-button w-full py-3 sm:py-3.5 text-base sm:text-lg font-semibold flex items-center justify-center gap-2"
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
                    <p className="text-slate-400 text-sm">
                        Already have an account?{' '}
                        <button
                            onClick={() => navigate('/login')}
                            className="text-white font-bold hover:text-primary transition-colors"
                        >
                            Sign in
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};
