import { motion } from 'framer-motion';
import SEO from '../../../components/SEO';

const APIDoc = () => {
    return (
        <div className="max-w-4xl text-text-main">
            <SEO
                title="API Reference"
                description="Complete REST API reference for Nest. Auth, File Uploads, and Storage endpoints."
            />
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <h1 className="text-4xl font-bold mb-8 text-text-main">API Reference</h1>

                <p className="text-lg text-text-muted mb-12 leading-relaxed">
                    The Nest API is a JSON REST interface designed for speed and security. All endpoints (except public sharing and salt retrieval) require a <strong className="font-bold">Bearer JWT Token</strong> in the `Authorization` header.
                </p>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-6 text-text-main border-l-4 border-primary pl-4">Authentication</h2>

                    <div className="space-y-8">
                        <div>
                            <div className="flex items-center gap-3 mb-3">
                                <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 font-bold text-xs uppercase">POST</span>
                                <code className="text-primary font-bold text-lg">/auth/salt</code>
                            </div>
                            <p className="text-sm text-text-muted mb-4">Retrieves pre-derivation parameters for a specific email.</p>
                            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-lg">
                                <pre className="text-xs text-emerald-400 whitespace-pre-wrap">
                                    {`{
  "salt": "base64_salt",
  "kdfParams": "{\\"algorithm\\":\\"argon2id\\",...}",
  "encryptedMasterKey": "wrapped_blob"
}`}
                                </pre>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center gap-3 mb-3">
                                <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 font-bold text-xs uppercase">POST</span>
                                <code className="text-primary font-bold text-lg">/auth/login</code>
                            </div>
                            <p className="text-sm text-text-muted mb-4">Authenticates a user session and returns vault keys.</p>
                        </div>
                    </div>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-6 text-text-main border-l-4 border-sky-500 pl-4">Files & Folders</h2>

                    <div className="space-y-8">
                        <div>
                            <div className="flex items-center gap-3 mb-3">
                                <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 font-bold text-xs uppercase">POST</span>
                                <code className="text-sky-600 font-bold text-lg">/files/upload</code>
                            </div>
                            <p className="text-sm text-text-muted mb-4">Uploads an encrypted file blob to the network.</p>
                        </div>

                        <div>
                            <div className="flex items-center gap-3 mb-3">
                                <span className="px-2 py-1 rounded bg-sky-500/10 text-sky-600 font-bold text-xs uppercase">GET</span>
                                <code className="text-sky-600 font-bold text-lg">/files/list</code>
                            </div>
                            <p className="text-sm text-text-muted mb-4">Lists file metadata (encrypted handles only).</p>
                        </div>
                    </div>
                </section>
            </motion.div>
        </div>
    );
};

export default APIDoc;
