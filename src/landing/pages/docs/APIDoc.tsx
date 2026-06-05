import { motion } from 'framer-motion';
import SEO from '../../../components/SEO';

const APIDoc = () => {
    return (
        <div className="max-w-4xl text-text-main">
            <SEO
                title="API Reference"
                description="Complete REST API reference for Nest. Auth, File Uploads, and Storage endpoints."
                canonical="https://nest.lazybird.io/docs/api"
            />
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <h1 className="text-4xl font-bold mb-8 text-text-main">REST API Reference</h1>

                <p className="text-lg text-text-muted mb-12 leading-relaxed">
                    The Nest API is a JSON REST interface designed for speed, security, and zero-knowledge paradigms. All endpoints (except public sharing and salt retrieval) require a <strong className="font-bold">Bearer JWT Token</strong> in the <code>Authorization</code> header.
                </p>

                {/* Authentication Section */}
                <section className="mb-16">
                    <h2 className="text-2xl font-bold mb-8 text-text-main border-l-4 border-primary pl-4">Authentication</h2>

                    <div className="space-y-12">
                        {/* /auth/salt */}
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 font-bold text-xs uppercase tracking-wider">POST</span>
                                <code className="text-primary font-bold text-lg">/auth/salt</code>
                            </div>
                            <p className="text-sm text-text-muted mb-6 leading-relaxed">
                                Retrieves the pre-derivation parameters for a specific email. Because the server does not store passwords, clients must request the unique salt for an email address to derive the <code>AuthHash</code> locally before attempting to log in.
                            </p>
                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Request Body</h4>
                                    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                                        <pre className="text-xs text-sky-400 whitespace-pre-wrap">
{`{
  "email": "user@example.com"
}`}
                                        </pre>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Response (200 OK)</h4>
                                    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                                        <pre className="text-xs text-emerald-400 whitespace-pre-wrap">
{`{
  "salt": "base64_encoded_salt",
  "kdfParams": "{\\"algorithm\\":\\"argon2id\\",\\"memoryCost\\":65536}",
  "encryptedMasterKey": "wrapped_blob",
  "masterKeyNonce": "nonce_blob"
}`}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* /auth/login */}
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 font-bold text-xs uppercase tracking-wider">POST</span>
                                <code className="text-primary font-bold text-lg">/auth/login</code>
                            </div>
                            <p className="text-sm text-text-muted mb-6 leading-relaxed">
                                Authenticates a user session using the client-derived <code>AuthHash</code>. Returns a JWT access token valid for 24 hours.
                            </p>
                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Request Body</h4>
                                    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                                        <pre className="text-xs text-sky-400 whitespace-pre-wrap">
{`{
  "email": "user@example.com",
  "authHash": "blake2b_hex_string"
}`}
                                        </pre>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Response (200 OK)</h4>
                                    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                                        <pre className="text-xs text-emerald-400 whitespace-pre-wrap">
{`{
  "token": "jwt_token_string",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "role": "user"
  }
}`}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
                {/* Folders Section */}
                <section className="mb-16">
                    <h2 className="text-2xl font-bold mb-8 text-text-main border-l-4 border-purple-500 pl-4">Folders API</h2>

                    <div className="space-y-12">
                        {/* /folders/create */}
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 font-bold text-xs uppercase tracking-wider">POST</span>
                                <code className="text-purple-600 font-bold text-lg">/folders/create</code>
                            </div>
                            <p className="text-sm text-text-muted mb-6 leading-relaxed">
                                Creates a new folder. Because folder names are encrypted, the server only receives an opaque payload to append to the metadata tree.
                            </p>
                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Request Body</h4>
                                    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                                        <pre className="text-xs text-sky-400 whitespace-pre-wrap">
{`{
  "parentId": "optional_parent_uuid",
  "encryptedMetadata": "updated_json_blob"
}`}
                                        </pre>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Response (201 Created)</h4>
                                    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                                        <pre className="text-xs text-emerald-400 whitespace-pre-wrap">
{`{
  "success": true,
  "folderId": "new_uuid"
}`}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* /folders/list */}
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="px-2 py-1 rounded bg-sky-500/10 text-sky-600 font-bold text-xs uppercase tracking-wider">GET</span>
                                <code className="text-purple-600 font-bold text-lg">/folders/list</code>
                            </div>
                            <p className="text-sm text-text-muted mb-6 leading-relaxed">
                                Retrieves the encrypted metadata blob containing the user's directory structure. The client is responsible for downloading this blob, decrypting it with the Master Key, and rendering the folder tree.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Files Section */}
                <section className="mb-16">
                    <h2 className="text-2xl font-bold mb-8 text-text-main border-l-4 border-sky-500 pl-4">Files & Storage</h2>

                    <div className="space-y-12">
                        {/* /files/upload */}
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 font-bold text-xs uppercase tracking-wider">POST</span>
                                <code className="text-sky-600 font-bold text-lg">/files/upload</code>
                            </div>
                            <p className="text-sm text-text-muted mb-6 leading-relaxed">
                                Uploads an encrypted file blob to the network. This endpoint requires <code>multipart/form-data</code>. The server never sees the plaintext file name; it only sees the encrypted ciphertexts and nonces.
                            </p>
                            
                            <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">cURL Example</h4>
                            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 mb-6 overflow-x-auto">
                                <pre className="text-xs text-amber-400 whitespace-pre-wrap">
{`curl -X POST https://api.nest.lazybird.io/files/upload \\
  -H "Authorization: Bearer <JWT_TOKEN>" \\
  -F "file=@encrypted_blob.bin" \\
  -F "folderId=5" \\
  -F "encryptedKey=base64_wrapped_file_key" \\
  -F "keyNonce=base64_nonce" \\
  -F "metadata=encrypted_json_metadata"`}
                                </pre>
                            </div>
                        </div>

                        {/* /files/metadata */}
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-600 font-bold text-xs uppercase tracking-wider">PATCH</span>
                                <code className="text-amber-600 font-bold text-lg">/files/metadata</code>
                            </div>
                            <p className="text-sm text-text-muted mb-6 leading-relaxed">
                                Updates the encrypted metadata blob for the user. This is called whenever a file or folder is renamed, moved, or deleted, ensuring the server stays blind to the directory structure.
                            </p>
                        </div>
                    </div>
                </section>
            </motion.div>
        </div>
    );
};

export default APIDoc;
