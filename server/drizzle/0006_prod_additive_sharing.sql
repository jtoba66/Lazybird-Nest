-- 0006_prod_additive_sharing.sql
-- IDEMPOTENT, ADDITIVE-ONLY migration to bring the live (drifted) prod DB up to the
-- feat/advanced-sharing schema. Computed by diffing a schema-only replica of prod
-- against the branch target. Adds 10 tables, 11 columns, 8 indexes. Touches NO existing
-- rows; contains NO DROP/ALTER-DROP/TRUNCATE/DELETE. Verified prod is a clean subset.
BEGIN;

-- ---- New columns on existing tables (defaults backfill existing rows safely) ----
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS "encrypted_filename"    text;
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS "encrypted_mime_type"   text;
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS "file_origin"           text DEFAULT 'private' NOT NULL;
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS "share_custom_slug"     text;
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS "share_download_count"  integer DEFAULT 0 NOT NULL;
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS "share_expires_at"      timestamp;
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS "share_max_downloads"   integer;
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS "share_password_hash"   text;
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS "upload_session_id"     text;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS "deleted_at"            timestamp;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS "encrypted_folder_name" text;

-- ---- 10 new tables (with their PKs / FKs / own indexes) ----
--
--






--
--

CREATE TABLE IF NOT EXISTS public.collab_access_list (
    id integer NOT NULL,
    collab_id integer NOT NULL,
    email text NOT NULL,
    added_at timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE SEQUENCE IF NOT EXISTS public.collab_access_list_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
--

ALTER SEQUENCE public.collab_access_list_id_seq OWNED BY public.collab_access_list.id;


--
--

CREATE TABLE IF NOT EXISTS public.collab_folders (
    id integer NOT NULL,
    user_id integer NOT NULL,
    folder_id integer NOT NULL,
    name text NOT NULL,
    token text NOT NULL,
    host_encrypted_collab_key bytea NOT NULL,
    host_collab_key_nonce bytea NOT NULL,
    link_encrypted_collab_key bytea NOT NULL,
    link_collab_key_nonce bytea NOT NULL,
    require_pin boolean DEFAULT false NOT NULL,
    pin_hash text,
    strict_mode boolean DEFAULT false NOT NULL,
    activity_notifications boolean DEFAULT true NOT NULL,
    custom_slug text,
    expires_at timestamp without time zone,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE SEQUENCE IF NOT EXISTS public.collab_folders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
--

ALTER SEQUENCE public.collab_folders_id_seq OWNED BY public.collab_folders.id;


--
--

CREATE TABLE IF NOT EXISTS public.collab_guest_sessions (
    id integer NOT NULL,
    collab_id integer NOT NULL,
    email text NOT NULL,
    session_token text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE SEQUENCE IF NOT EXISTS public.collab_guest_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
--

ALTER SEQUENCE public.collab_guest_sessions_id_seq OWNED BY public.collab_guest_sessions.id;


--
--

CREATE TABLE IF NOT EXISTS public.collab_otp_sessions (
    id integer NOT NULL,
    collab_id integer NOT NULL,
    email text NOT NULL,
    code_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    verified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE SEQUENCE IF NOT EXISTS public.collab_otp_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
--

ALTER SEQUENCE public.collab_otp_sessions_id_seq OWNED BY public.collab_otp_sessions.id;


--
--

CREATE TABLE IF NOT EXISTS public.drop_zone_files (
    id integer NOT NULL,
    drop_zone_id integer NOT NULL,
    encrypted_file_key bytea NOT NULL,
    file_key_nonce bytea NOT NULL,
    storage_key text NOT NULL,
    file_size bigint NOT NULL,
    uploaded_at timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE SEQUENCE IF NOT EXISTS public.drop_zone_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
--

ALTER SEQUENCE public.drop_zone_files_id_seq OWNED BY public.drop_zone_files.id;


--
--

CREATE TABLE IF NOT EXISTS public.drop_zones (
    id integer NOT NULL,
    user_id integer NOT NULL,
    folder_id integer NOT NULL,
    name text NOT NULL,
    token text NOT NULL,
    drop_public_key bytea NOT NULL,
    encrypted_drop_private_key bytea NOT NULL,
    drop_private_key_nonce bytea NOT NULL,
    require_pin boolean DEFAULT false NOT NULL,
    pin_hash text,
    upload_notifications boolean DEFAULT true NOT NULL,
    custom_slug text,
    expires_at timestamp without time zone,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE SEQUENCE IF NOT EXISTS public.drop_zones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
--

ALTER SEQUENCE public.drop_zones_id_seq OWNED BY public.drop_zones.id;


--
--

CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
    event_id text NOT NULL,
    type text,
    processed_at timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token text NOT NULL,
    previous_token text,
    rotated_at timestamp without time zone,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE SEQUENCE IF NOT EXISTS public.refresh_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
--

ALTER SEQUENCE public.refresh_tokens_id_seq OWNED BY public.refresh_tokens.id;


--
--

CREATE TABLE IF NOT EXISTS public.share_audit_log (
    id integer NOT NULL,
    share_type text NOT NULL,
    share_id integer NOT NULL,
    action text NOT NULL,
    actor text,
    filename text,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE SEQUENCE IF NOT EXISTS public.share_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
--

ALTER SEQUENCE public.share_audit_log_id_seq OWNED BY public.share_audit_log.id;


--
--

CREATE TABLE IF NOT EXISTS public.shared_with_me (
    id integer NOT NULL,
    user_id integer NOT NULL,
    collab_id integer NOT NULL,
    encrypted_collab_key bytea NOT NULL,
    collab_key_nonce bytea NOT NULL,
    pinned_at timestamp without time zone DEFAULT now() NOT NULL
);


--
--

CREATE SEQUENCE IF NOT EXISTS public.shared_with_me_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
--

ALTER SEQUENCE public.shared_with_me_id_seq OWNED BY public.shared_with_me.id;


--
--

ALTER TABLE ONLY public.collab_access_list ALTER COLUMN id SET DEFAULT nextval('public.collab_access_list_id_seq'::regclass);


--
--

ALTER TABLE ONLY public.collab_folders ALTER COLUMN id SET DEFAULT nextval('public.collab_folders_id_seq'::regclass);


--
--

ALTER TABLE ONLY public.collab_guest_sessions ALTER COLUMN id SET DEFAULT nextval('public.collab_guest_sessions_id_seq'::regclass);


--
--

ALTER TABLE ONLY public.collab_otp_sessions ALTER COLUMN id SET DEFAULT nextval('public.collab_otp_sessions_id_seq'::regclass);


--
--

ALTER TABLE ONLY public.drop_zone_files ALTER COLUMN id SET DEFAULT nextval('public.drop_zone_files_id_seq'::regclass);


--
--

ALTER TABLE ONLY public.drop_zones ALTER COLUMN id SET DEFAULT nextval('public.drop_zones_id_seq'::regclass);


--
--

ALTER TABLE ONLY public.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('public.refresh_tokens_id_seq'::regclass);


--
--

ALTER TABLE ONLY public.share_audit_log ALTER COLUMN id SET DEFAULT nextval('public.share_audit_log_id_seq'::regclass);


--
--

ALTER TABLE ONLY public.shared_with_me ALTER COLUMN id SET DEFAULT nextval('public.shared_with_me_id_seq'::regclass);


--
--

ALTER TABLE ONLY public.collab_access_list
    ADD CONSTRAINT collab_access_list_collab_id_email_unique UNIQUE (collab_id, email);


--
--

ALTER TABLE ONLY public.collab_access_list
    ADD CONSTRAINT collab_access_list_pkey PRIMARY KEY (id);


--
--

ALTER TABLE ONLY public.collab_folders
    ADD CONSTRAINT collab_folders_custom_slug_unique UNIQUE (custom_slug);


--
--

ALTER TABLE ONLY public.collab_folders
    ADD CONSTRAINT collab_folders_pkey PRIMARY KEY (id);


--
--

ALTER TABLE ONLY public.collab_folders
    ADD CONSTRAINT collab_folders_token_unique UNIQUE (token);


--
--

ALTER TABLE ONLY public.collab_guest_sessions
    ADD CONSTRAINT collab_guest_sessions_pkey PRIMARY KEY (id);


--
--

ALTER TABLE ONLY public.collab_guest_sessions
    ADD CONSTRAINT collab_guest_sessions_session_token_unique UNIQUE (session_token);


--
--

ALTER TABLE ONLY public.collab_otp_sessions
    ADD CONSTRAINT collab_otp_sessions_pkey PRIMARY KEY (id);


--
--

ALTER TABLE ONLY public.drop_zone_files
    ADD CONSTRAINT drop_zone_files_pkey PRIMARY KEY (id);


--
--

ALTER TABLE ONLY public.drop_zones
    ADD CONSTRAINT drop_zones_custom_slug_unique UNIQUE (custom_slug);


--
--

ALTER TABLE ONLY public.drop_zones
    ADD CONSTRAINT drop_zones_pkey PRIMARY KEY (id);


--
--

ALTER TABLE ONLY public.drop_zones
    ADD CONSTRAINT drop_zones_token_unique UNIQUE (token);


--
--

ALTER TABLE ONLY public.processed_stripe_events
    ADD CONSTRAINT processed_stripe_events_pkey PRIMARY KEY (event_id);


--
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
--

ALTER TABLE ONLY public.share_audit_log
    ADD CONSTRAINT share_audit_log_pkey PRIMARY KEY (id);


--
--

ALTER TABLE ONLY public.shared_with_me
    ADD CONSTRAINT shared_with_me_pkey PRIMARY KEY (id);


--
--

ALTER TABLE ONLY public.shared_with_me
    ADD CONSTRAINT shared_with_me_user_id_collab_id_unique UNIQUE (user_id, collab_id);


--
--

CREATE INDEX IF NOT EXISTS collab_folders_user_id_idx ON public.collab_folders USING btree (user_id);


--
--

CREATE INDEX IF NOT EXISTS collab_guest_sessions_collab_id_idx ON public.collab_guest_sessions USING btree (collab_id);


--
--

CREATE INDEX IF NOT EXISTS collab_otp_sessions_collab_email_idx ON public.collab_otp_sessions USING btree (collab_id, email);


--
--

CREATE INDEX IF NOT EXISTS drop_zones_user_id_idx ON public.drop_zones USING btree (user_id);


--
--

CREATE INDEX IF NOT EXISTS refresh_tokens_previous_token_idx ON public.refresh_tokens USING btree (previous_token);


--
--

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON public.refresh_tokens USING btree (user_id);


--
--

ALTER TABLE ONLY public.collab_access_list
    ADD CONSTRAINT collab_access_list_collab_id_collab_folders_id_fk FOREIGN KEY (collab_id) REFERENCES public.collab_folders(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.collab_folders
    ADD CONSTRAINT collab_folders_folder_id_folders_id_fk FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.collab_folders
    ADD CONSTRAINT collab_folders_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.collab_guest_sessions
    ADD CONSTRAINT collab_guest_sessions_collab_id_collab_folders_id_fk FOREIGN KEY (collab_id) REFERENCES public.collab_folders(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.collab_otp_sessions
    ADD CONSTRAINT collab_otp_sessions_collab_id_collab_folders_id_fk FOREIGN KEY (collab_id) REFERENCES public.collab_folders(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.drop_zone_files
    ADD CONSTRAINT drop_zone_files_drop_zone_id_drop_zones_id_fk FOREIGN KEY (drop_zone_id) REFERENCES public.drop_zones(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.drop_zones
    ADD CONSTRAINT drop_zones_folder_id_folders_id_fk FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.drop_zones
    ADD CONSTRAINT drop_zones_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.shared_with_me
    ADD CONSTRAINT shared_with_me_collab_id_collab_folders_id_fk FOREIGN KEY (collab_id) REFERENCES public.collab_folders(id) ON DELETE CASCADE;


--
--

ALTER TABLE ONLY public.shared_with_me
    ADD CONSTRAINT shared_with_me_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
--



-- ---- New indexes on existing tables ----
CREATE INDEX IF NOT EXISTS "files_deleted_at_idx"            ON public.files USING btree (deleted_at);
CREATE INDEX IF NOT EXISTS "files_folder_id_idx"             ON public.files USING btree (folder_id);
CREATE INDEX IF NOT EXISTS "files_user_id_idx"               ON public.files USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS "files_share_custom_slug_unique" ON public.files USING btree (share_custom_slug);
CREATE INDEX IF NOT EXISTS "folders_parent_id_idx"           ON public.folders USING btree (parent_id);
CREATE INDEX IF NOT EXISTS "folders_user_id_idx"             ON public.folders USING btree (user_id);
CREATE INDEX IF NOT EXISTS "users_stripe_customer_id_idx"    ON public.users USING btree (stripe_customer_id);
CREATE INDEX IF NOT EXISTS "analytics_events_type_timestamp_idx" ON public.analytics_events USING btree (type, "timestamp");

COMMIT;
