import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LockKey, EnvelopeSimple, Eye, EyeSlash } from '@phosphor-icons/react';
import logoImg from '../assets/nest-logo.png';

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

            navigate('/dashboard');

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
            {/* Background Gradients (Subtle) */}
            <div className="absolute top-0 left-0 right-0 h-full overflow-hidden -z-10 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 rounded-full blur-[100px]" />
            </div>

            <div className="w-full max-w-md animate-scale-in">
                <div className="text-center mb-8">
                    <div className="w-24 h-24 sm:w-32 sm:h-32 flex items-center justify-center mx-auto mb-2 transform rotate-3 hover:rotate-6 transition-all duration-500 group">
                        <img src={logoImg} alt="Nest Logo" className="w-full h-full object-contain mix-blend-multiply scale-150 group-hover:scale-[1.65] transition-transform duration-700" />
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-bold text-text-main mb-3 tracking-tight drop-shadow-sm">Welcome Back</h1>
                    <p className="text-text-muted text-base sm:text-lg">Sign in to your Nest account</p>
                </div>

                <div className="glass-panel p-6 sm:p-8 md:p-10 border-white/60 shadow-xl">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-bold text-text-main mb-2">
                                Email
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
                            <div className="mt-3 text-right">
                                <Link to="/forgot-password" className="text-sm text-accent-secondary hover:text-primary font-bold transition-colors">
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
                            className="glass-button w-full py-3 sm:py-3.5 text-base sm:text-lg font-bold flex items-center justify-center gap-2 shadow-xl hover:shadow-2xl hover:-translate-y-0.5"
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
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-text-muted text-sm text-center">
                            <span>
                                Don't have an account?{' '}
                                <button
                                    onClick={() => navigate('/signup')}
                                    className="text-text-main font-bold hover:text-primary transition-colors"
                                >
                                    Sign up
                                </button>
                            </span>
                            <span className="text-slate-300 hidden sm:inline">|</span>
                            <Link to="/terms" className="text-text-muted hover:text-text-main transition-colors whitespace-nowrap">
                                Terms & Privacy Policy
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
