import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, EnvelopeSimple } from '@phosphor-icons/react';
import nestLogo from '../assets/nest-logo.png';

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
                {/* Background Orbs - Match Login/Form View positions */}
                <div className="absolute top-1/4 left-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-primary/20 rounded-full blur-3xl -z-10 animate-pulse-glow" />
                <div className="absolute bottom-1/4 right-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-secondary/20 rounded-full blur-3xl -z-10 animate-pulse-glow delay-100" />

                <div className="w-full max-w-md animate-scale-in">
                    {/* Header Outside Glass Card */}
                    <div className="text-center mb-8">
                        <div className="w-24 h-24 sm:w-32 sm:h-32 flex items-center justify-center mx-auto mb-2 transform rotate-3 hover:rotate-6 transition-all duration-500 group">
                            <img src={nestLogo} alt="Nest Logo" className="w-full h-full object-contain mix-blend-screen scale-150 group-hover:scale-[1.65] transition-transform duration-700" />
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 mb-3 tracking-tight drop-shadow-sm">Check your email</h1>
                        <p className="text-slate-500 text-base sm:text-lg">We've sent reset instructions for your account</p>
                    </div>

                    {/* Standard Glass Panel */}
                    <div className="glass-panel p-6 sm:p-8 md:p-10 text-center">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white/40 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-white/40">
                            <EnvelopeSimple size={40} weight="duotone" className="text-slate-700 drop-shadow-sm" />
                        </div>

                        <div className="mb-8">
                            <p className="text-slate-600 text-lg font-medium mb-1">Sent to:</p>
                            <strong className="text-slate-800 font-bold text-xl tracking-tight break-all">{email}</strong>
                        </div>

                        <Link
                            to="/login"
                            className="glass-button w-full py-3 sm:py-3.5 text-base sm:text-lg font-semibold flex items-center justify-center gap-2"
                        >
                            <ArrowLeft size={20} weight="bold" />
                            Back to login
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
            {/* Background Orbs */}
            <div className="absolute top-1/4 left-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-primary/20 rounded-full blur-3xl -z-10 animate-pulse-glow" />
            <div className="absolute bottom-1/4 right-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-secondary/20 rounded-full blur-3xl -z-10 animate-pulse-glow delay-100" />

            <div className="w-full max-w-md animate-scale-in">
                <div className="text-center mb-8">
                    <div className="w-24 h-24 sm:w-32 sm:h-32 flex items-center justify-center mx-auto mb-2 transform rotate-3 hover:rotate-6 transition-all duration-500 group">
                        <img src={nestLogo} alt="Nest Logo" className="w-full h-full object-contain mix-blend-screen scale-150 group-hover:scale-[1.65] transition-transform duration-700" />
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 mb-3 tracking-tight drop-shadow-sm">Forgot password?</h1>
                    <p className="text-slate-500 text-base sm:text-lg">Enter your email to reset your password</p>
                </div>

                <div className="glass-panel p-6 sm:p-8 md:p-10">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                                Email Address
                            </label>
                            <div className="relative group">
                                <EnvelopeSimple
                                    size={20}
                                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors"
                                />
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    disabled={loading}
                                    className="w-full glass-input pl-12"
                                    placeholder="you@example.com"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !email}
                            className="glass-button w-full py-3 sm:py-3.5 text-base sm:text-lg font-semibold"
                        >
                            {loading ? 'Sending instruction...' : 'Send reset instructions'}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <Link to="/login" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors group text-sm font-medium">
                            <ArrowLeft size={16} weight="bold" className="group-hover:-translate-x-1 transition-transform" />
                            <span>Back to login</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};
