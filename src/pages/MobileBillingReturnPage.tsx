import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const TARGET_MESSAGES: Record<string, { title: string; body: string; fallbackPath: string }> = {
    'checkout-success': {
        title: 'Returning to Nest',
        body: 'Your checkout completed. Nest is reopening so the Android app can refresh your subscription.',
        fallbackPath: '/settings'
    },
    'checkout-cancel': {
        title: 'Checkout canceled',
        body: 'Nest is reopening so you can continue from the app.',
        fallbackPath: '/pricing'
    },
    'portal-return': {
        title: 'Returning from billing',
        body: 'Nest is reopening so the Android app can refresh account billing details.',
        fallbackPath: '/settings'
    }
};

export const MobileBillingReturnPage = () => {
    const [searchParams] = useSearchParams();
    const [attemptedOpen, setAttemptedOpen] = useState(false);
    const target = searchParams.get('target') ?? 'portal-return';
    const sessionId = searchParams.get('session_id');
    const message = TARGET_MESSAGES[target] ?? TARGET_MESSAGES['portal-return'];

    const appUrl = useMemo(() => {
        const params = new URLSearchParams();
        params.set('target', target);
        if (sessionId) {
            params.set('session_id', sessionId);
        }
        return `nest://billing-return?${params.toString()}`;
    }, [sessionId, target]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setAttemptedOpen(true);
            window.location.replace(appUrl);
        }, 250);
        return () => window.clearTimeout(timer);
    }, [appUrl]);

    return (
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
            <div className="max-w-lg w-full rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-8 space-y-6 shadow-2xl">
                <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Nest Android</p>
                    <h1 className="text-3xl font-semibold tracking-tight">{message.title}</h1>
                    <p className="text-sm text-slate-300 leading-6">{message.body}</p>
                </div>

                <div className="space-y-3">
                    <a
                        href={appUrl}
                        className="block w-full rounded-2xl bg-white text-slate-950 text-center font-semibold px-5 py-4"
                    >
                        Open Nest app
                    </a>
                    <a
                        href={message.fallbackPath}
                        className="block w-full rounded-2xl border border-white/15 text-center font-medium px-5 py-4 text-slate-200"
                    >
                        Continue on web
                    </a>
                </div>

                <p className="text-xs text-slate-500">
                    {attemptedOpen
                        ? 'If the app did not open automatically, use the button above.'
                        : 'Preparing the Android handoff.'}
                </p>
            </div>
        </div>
    );
};
