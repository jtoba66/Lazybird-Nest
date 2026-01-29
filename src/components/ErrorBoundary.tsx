import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Warning, ArrowClockwise } from '@phosphor-icons/react';
import * as Sentry from "@sentry/react";

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        Sentry.captureException(error, { extra: errorInfo as any });
    }

    private handleReset = () => {
        window.location.href = '/';
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-[#0a0a0a] text-white">
                    <div className="absolute inset-0 overflow-hidden -z-10">
                        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[120px] animate-pulse" />
                        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/10 rounded-full blur-[120px] animate-pulse delay-700" />
                    </div>

                    <div className="glass-panel max-w-md w-full p-8 text-center space-y-6 animate-in fade-in zoom-in duration-500">
                        <div className="w-20 h-20 bg-error/10 rounded-3xl flex items-center justify-center text-error mx-auto shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                            <Warning size={40} weight="fill" />
                        </div>

                        <div className="space-y-2">
                            <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
                            <p className="text-text-muted text-sm leading-relaxed">
                                We've encountered an unexpected UI error. Your data is safe, but the interface needs a quick restart.
                            </p>
                        </div>

                        {import.meta.env.DEV && this.state.error && (
                            <div className="p-4 bg-black/40 rounded-xl text-left overflow-auto max-h-40 border border-white/5">
                                <code className="text-xs text-error/80 break-all font-mono">
                                    {this.state.error.toString()}
                                </code>
                            </div>
                        )}

                        <button
                            onClick={this.handleReset}
                            className="glass-button w-full py-3 flex items-center justify-center gap-2 group transition-all"
                        >
                            <ArrowClockwise size={20} className="group-hover:rotate-180 transition-transform duration-500" />
                            <span>Restart Application</span>
                        </button>

                        <p className="text-[10px] text-text-muted/40 uppercase tracking-widest font-medium">
                            Error Captured by Nest Sentinel
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
