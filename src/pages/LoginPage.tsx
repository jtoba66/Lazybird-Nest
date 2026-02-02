import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LockKey, EnvelopeSimple, Eye, EyeSlash } from '@phosphor-icons/react';

export const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');

    const { login, setMasterKey } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        setLoadingMessage('Securing connection...');

        try {
            // 0. Import Crypto Libs
            const {
                deriveRootKey,
                deriveAuthHash,
                fromBase64
            } = await import('../crypto/v2');
            const { authAPI } = await import('../api/auth');

            // 1. Get Salt from Server
            const { salt: saltBase64, kdfParams: kdfParamsJson } = await authAPI.getSalt(email);
            const salt = fromBase64(saltBase64);
            const kdfParams = JSON.parse(kdfParamsJson);

            // 2. Derive Root Key
            setLoadingMessage('Deriving keys...');
            await new Promise(r => setTimeout(r, 50)); // Render UI
            const rootKey = await deriveRootKey(password, salt, kdfParams);

            // 3. Authenticate
            setLoadingMessage('Authenticating...');
            const authHash = deriveAuthHash(rootKey);
            await login({ email, authHash, rootKey });

            // 4. Decrypt Master Key (Handled internally by AuthContext.login)
            // The context will update the state and localStorage automatically.

            navigate('/');

        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.error || 'Login failed');
            setMasterKey(null);
        } finally {
            setLoading(false);
            setLoadingMessage('');
        }
    };

    return (
        <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
            {/* Background Orbs */}
            <div className="absolute top-1/4 left-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-primary/20 rounded-full blur-3xl -z-10 animate-pulse-glow" />
            <div className="absolute bottom-1/4 right-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-secondary/20 rounded-full blur-3xl -z-10 animate-pulse-glow delay-100" />

            <div className="w-full max-w-md animate-scale-in">
                <div className="text-center mb-8">
                    <div className="w-24 h-24 sm:w-32 sm:h-32 flex items-center justify-center mx-auto mb-2 transform rotate-3 hover:rotate-6 transition-all duration-500 group">
                        import logoImg from '../assets/nest-logo.png';

                        // ... (in component)
                        <div className="w-24 h-24 sm:w-32 sm:h-32 flex items-center justify-center mx-auto mb-2 transform rotate-3 hover:rotate-6 transition-all duration-500 group">
                            <img src={logoImg} alt="Nest Logo" className="w-full h-full object-contain mix-blend-screen scale-150 group-hover:scale-[1.65] transition-transform duration-700" />
                        </div>
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight drop-shadow-md">Welcome Back</h1>
                    <p className="text-slate-400 text-base sm:text-lg">Sign in to your Nest account</p>
                </div>

                <div className="glass-panel p-6 sm:p-8 md:p-10">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-200 mb-2">
                                Email
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
                                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors"
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
                            <div className="mt-3 text-right">
                                <Link to="/forgot-password" className="text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors">
                                    Forgot password?
                                </Link>
                            </div>
                        </div>

                        {error && (
                            <div className="bg-error/10 border border-error/20 text-error rounded-xl p-4 text-sm font-medium animate-shake">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="glass-button w-full py-3 sm:py-3.5 text-base sm:text-lg font-semibold flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>{loadingMessage || 'Authenticating...'}</span>
                                </>
                            ) : (
                                'Sign In'
                            )}
                        </button>
                    </form>

                    <div className="mt-6 sm:mt-8">
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-slate-400 text-sm text-center">
                            <span>
                                Don't have an account?{' '}
                                <button
                                    onClick={() => navigate('/signup')}
                                    className="text-white font-bold hover:text-primary transition-colors"
                                >
                                    Sign up
                                </button>
                            </span>
                            <span className="text-slate-600 hidden sm:inline">|</span>
                            <Link to="/terms" className="text-slate-400 hover:text-white transition-colors whitespace-nowrap">
                                Terms & Privacy Policy
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
