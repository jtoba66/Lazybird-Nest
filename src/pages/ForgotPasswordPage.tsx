import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, EnvelopeSimple } from '@phosphor-icons/react';

export const ForgotPasswordPage = () => {
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { authAPI } = await import('../api/auth');
            await authAPI.forgotPassword(email);
            setSubmitted(true);
        } catch (error: any) {
            console.error('Password reset request failed:', error);
            alert(error.response?.data?.error || 'Failed to send reset email');
        } finally {
            setLoading(false);
        }
    };

    if (submitted) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
                <div className="absolute top-1/2 left-1/2 w-72 h-72 sm:w-96 sm:h-96 bg-primary/20 rounded-full blur-3xl -z-10 animate-pulse-glow transform -translate-x-1/2 -translate-y-1/2" />

                <div className="glass-panel p-6 sm:p-10 w-full max-w-md text-center animate-scale-in">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/10">
                        <EnvelopeSimple size={40} weight="duotone" className="text-green-500" />
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3 drop-shadow-md">Check your email</h2>
                    <p className="text-base sm:text-lg text-slate-300 mb-6 sm:mb-8 leading-relaxed">
                        We've sent simple password reset instructions to <strong className="text-white">{email}</strong>
                    </p>
                    <Link
                        to="/login"
                        className="glass-button w-full py-3 sm:py-3.5 flex items-center justify-center gap-2 text-base font-semibold"
                    >
                        <ArrowLeft size={18} weight="bold" />
                        Back to login
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
            {/* Background Orbs */}
            <div className="absolute top-1/4 right-3/4 w-72 h-72 sm:w-96 sm:h-96 bg-primary/20 rounded-full blur-3xl -z-10 animate-pulse-glow" />
            <div className="absolute bottom-1/3 left-2/3 w-64 h-64 sm:w-80 sm:h-80 bg-secondary/20 rounded-full blur-3xl -z-10 animate-pulse-glow delay-200" />

            <div className="glass-panel p-6 sm:p-8 md:p-10 w-full max-w-md animate-scale-in">
                <div className="mb-8">
                    <Link to="/login" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-6 group">
                        <ArrowLeft size={16} weight="bold" className="group-hover:-translate-x-1 transition-transform" />
                        <span className="text-sm font-medium">Back to login</span>
                    </Link>
                    <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3 tracking-tight drop-shadow-md">Forgot password?</h1>
                    <p className="text-slate-400 text-base sm:text-lg">
                        Enter your email address and we'll send you instructions to reset your password.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="email" className="block text-sm font-semibold text-slate-200 mb-2 ml-1">
                            Email Address
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                            className="glass-input w-full"
                            placeholder="you@example.com"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !email}
                        className="glass-button w-full py-3 sm:py-3.5 text-base sm:text-lg font-semibold"
                    >
                        {loading ? 'Sending instruction...' : 'Send reset instructions'}
                    </button>
                </form>
            </div>
        </div>
    );
};
