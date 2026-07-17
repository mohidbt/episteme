SELECT pg_catalog.set_config('search_path', '', false);
CREATE SCHEMA drizzle;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE TYPE public.agent_thread_status AS ENUM (
    'idle',
    'running',
    'awaiting_hitl',
    'error'
);
CREATE TYPE public.citation_enrichment_job_status AS ENUM (
    'queued',
    'running',
    'completed',
    'failed'
);
CREATE TYPE public.font_pref AS ENUM (
    'sans',
    'serif',
    'mono'
);
CREATE TYPE public.highlight_color AS ENUM (
    'yellow',
    'green',
    'blue',
    'pink',
    'orange',
    'amber'
);
CREATE TYPE public.highlight_source AS ENUM (
    'user',
    'ai-auto'
);
CREATE TYPE public.job_status AS ENUM (
    'queued',
    'running',
    'completed',
    'failed'
);
CREATE TYPE public.job_type AS ENUM (
    'ocr',
    'chunking',
    'embedding',
    'outline',
    'concepts'
);
CREATE TYPE public.message_role AS ENUM (
    'user',
    'assistant'
);
CREATE TYPE public.note_link_target_kind AS ENUM (
    'note',
    'paper',
    'reference'
);
CREATE TYPE public.note_revision_author_kind AS ENUM (
    'user',
    'agent'
);
CREATE TYPE public.note_type AS ENUM (
    'md',
    'latex',
    'pdf-ref'
);
CREATE TYPE public.provider_type AS ENUM (
    'llm',
    'voice',
    'ocr',
    'references'
);
CREATE TYPE public.revision_reason AS ENUM (
    'autosave',
    'manual',
    'pre-ai-edit',
    'conflict-resolve',
    'agent-write'
);
CREATE TYPE public.storage_mode AS ENUM (
    'cloud',
    'browser_only'
);
CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);
CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;
CREATE TABLE public.account (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp without time zone,
    refresh_token_expires_at timestamp without time zone,
    scope text,
    password text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone NOT NULL
);
CREATE TABLE public.agent_configs (
    user_id text NOT NULL,
    enabled_skills text[] DEFAULT '{}'::text[] NOT NULL,
    attached_mcps jsonb DEFAULT '[]'::jsonb NOT NULL,
    model_preference text DEFAULT 'google/gemma-4-31b-it:free'::text NOT NULL,
    approval_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    skills_md text DEFAULT ''::text NOT NULL,
    memory_md text DEFAULT ''::text NOT NULL,
    settings_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.agent_conversations (
    id integer NOT NULL,
    user_id text NOT NULL,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'chat'::text NOT NULL,
    paper_id uuid NOT NULL
);
CREATE SEQUENCE public.agent_conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.agent_conversations_id_seq OWNED BY public.agent_conversations.id;
CREATE TABLE public.agent_memories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    namespace text[] NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.agent_message_metadata (
    thread_id text NOT NULL,
    user_id text NOT NULL,
    message_id text NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.agent_messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    role public.message_role NOT NULL,
    content text NOT NULL,
    viewport_context jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.agent_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.agent_messages_id_seq OWNED BY public.agent_messages.id;
CREATE TABLE public.agent_thread_papers (
    thread_id text NOT NULL,
    paper_id uuid NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.agent_threads (
    user_id text NOT NULL,
    thread_id text NOT NULL,
    model_override text,
    title text,
    skill text,
    status public.agent_thread_status DEFAULT 'idle'::public.agent_thread_status NOT NULL,
    last_message_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.ai_highlight_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    paper_id uuid NOT NULL,
    user_id text NOT NULL,
    instruction text NOT NULL,
    model_used text,
    status text NOT NULL,
    summary text,
    conversation_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);
CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id integer NOT NULL,
    user_id text NOT NULL,
    folder_id uuid,
    filename text NOT NULL,
    storage_url text,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.checkpoint_blobs (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    channel text NOT NULL,
    version text NOT NULL,
    type text NOT NULL,
    blob bytea
);
CREATE TABLE public.checkpoint_migrations (
    v integer NOT NULL
);
CREATE TABLE public.checkpoint_writes (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    task_id text NOT NULL,
    idx integer NOT NULL,
    channel text NOT NULL,
    type text,
    blob bytea NOT NULL,
    task_path text DEFAULT ''::text NOT NULL
);
CREATE TABLE public.checkpoints (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    parent_checkpoint_id text,
    type text,
    checkpoint jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.citation_enrichment_jobs (
    paper_id uuid NOT NULL,
    status public.citation_enrichment_job_status DEFAULT 'queued'::public.citation_enrichment_job_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_until timestamp with time zone,
    last_error text,
    total_refs integer DEFAULT 0 NOT NULL,
    enriched_refs integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT citation_enrichment_jobs_attempts_nonnegative CHECK ((attempts >= 0)),
    CONSTRAINT citation_enrichment_jobs_totals_nonnegative CHECK (((total_refs >= 0) AND (enriched_refs >= 0)))
);
CREATE TABLE public.document_chunks (
    id integer NOT NULL,
    section_id integer,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    token_count integer,
    page_start integer,
    page_end integer,
    embedding public.vector(1536),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paper_id uuid NOT NULL
);
CREATE SEQUENCE public.document_chunks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.document_chunks_id_seq OWNED BY public.document_chunks.id;
CREATE TABLE public.document_outlines (
    id integer NOT NULL,
    outline jsonb NOT NULL,
    concepts jsonb,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    paper_id uuid NOT NULL
);
CREATE SEQUENCE public.document_outlines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.document_outlines_id_seq OWNED BY public.document_outlines.id;
CREATE TABLE public.document_reference_markers (
    id integer NOT NULL,
    reference_id integer NOT NULL,
    page_number integer NOT NULL,
    x0 real NOT NULL,
    y0 real NOT NULL,
    x1 real NOT NULL,
    y1 real NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.document_reference_markers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.document_reference_markers_id_seq OWNED BY public.document_reference_markers.id;
CREATE TABLE public.document_references (
    id integer NOT NULL,
    marker_text text NOT NULL,
    marker_index integer NOT NULL,
    raw_text text,
    title text,
    authors jsonb,
    year text,
    doi text,
    url text,
    semantic_scholar_id text,
    abstract text,
    venue text,
    citation_count integer,
    page_number integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    influential_citation_count integer,
    open_access_pdf_url text,
    tldr_text text,
    external_ids jsonb,
    bibtex text,
    paper_id uuid NOT NULL,
    enriched_at timestamp with time zone
);
CREATE SEQUENCE public.document_references_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.document_references_id_seq OWNED BY public.document_references.id;
CREATE TABLE public.document_sections (
    id integer NOT NULL,
    section_index integer NOT NULL,
    title text,
    content text NOT NULL,
    page_start integer NOT NULL,
    page_end integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paper_id uuid NOT NULL
);
CREATE SEQUENCE public.document_sections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.document_sections_id_seq OWNED BY public.document_sections.id;
CREATE TABLE public.document_segments (
    id integer NOT NULL,
    page integer NOT NULL,
    kind text NOT NULL,
    bbox jsonb NOT NULL,
    payload jsonb NOT NULL,
    order_index integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paper_id uuid NOT NULL
);
CREATE SEQUENCE public.document_segments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.document_segments_id_seq OWNED BY public.document_segments.id;
CREATE TABLE public.folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id integer NOT NULL,
    user_id text NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    is_trash boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT folders_trash_at_root CHECK (((is_trash = false) OR (parent_id IS NULL)))
);
CREATE TABLE public.invite_codes (
    code text NOT NULL,
    used_by_user_id text,
    used_at timestamp with time zone,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.kept_citations (
    id integer NOT NULL,
    user_id text NOT NULL,
    document_reference_id integer NOT NULL,
    library_reference_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.kept_citations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.kept_citations_id_seq OWNED BY public.kept_citations.id;
CREATE TABLE public.libraries (
    id integer NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.libraries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.libraries_id_seq OWNED BY public.libraries.id;
CREATE TABLE public.library_references (
    id integer NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    authors jsonb,
    year text,
    doi text,
    url text,
    semantic_scholar_id text,
    abstract text,
    venue text,
    citation_count integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    influential_citation_count integer,
    open_access_pdf_url text,
    tldr_text text,
    external_ids jsonb,
    bibtex text,
    folder_id uuid
);
CREATE SEQUENCE public.library_references_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.library_references_id_seq OWNED BY public.library_references.id;
CREATE TABLE public.note_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    note_id uuid NOT NULL,
    chunk_idx integer NOT NULL,
    content text NOT NULL,
    embedding public.vector(1536),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.note_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_note_id uuid NOT NULL,
    target_kind public.note_link_target_kind NOT NULL,
    target_id uuid,
    target_title_raw text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.note_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    note_id uuid NOT NULL,
    author_id text,
    content_md text NOT NULL,
    reason public.revision_reason NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    author_kind public.note_revision_author_kind DEFAULT 'user'::public.note_revision_author_kind NOT NULL,
    agent_invocation_id uuid,
    agent_skill text
);
CREATE TABLE public.note_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    note_id uuid NOT NULL,
    tag text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id integer NOT NULL,
    user_id text NOT NULL,
    folder_path text DEFAULT ''::text NOT NULL,
    filename text,
    title text NOT NULL,
    slug text NOT NULL,
    content_md text DEFAULT ''::text NOT NULL,
    content_json jsonb,
    yjs_state bytea,
    note_type public.note_type DEFAULT 'md'::public.note_type NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    public_slug text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    folder_id uuid,
    prev_folder_id uuid,
    size_bytes bigint DEFAULT 0 NOT NULL
);
CREATE TABLE public.openrouter_catalog (
    model_id text NOT NULL,
    payload jsonb NOT NULL,
    fetched_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.openrouter_usage (
    id bigint NOT NULL,
    user_id text,
    guest_session_id text,
    model text NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,6) DEFAULT 0 NOT NULL,
    source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.openrouter_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.openrouter_usage_id_seq OWNED BY public.openrouter_usage.id;
CREATE TABLE public.paper_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    paper_id uuid NOT NULL,
    chunk_idx integer NOT NULL,
    content text NOT NULL,
    embedding public.vector(1536),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.paper_citations (
    id bigint NOT NULL,
    citer_kind text NOT NULL,
    citer_id text NOT NULL,
    cited_kind text NOT NULL,
    cited_id text NOT NULL,
    source_marker_idx integer,
    match_method text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT paper_citations_check CHECK ((NOT ((citer_kind = cited_kind) AND (citer_id = cited_id)))),
    CONSTRAINT paper_citations_cited_kind_check CHECK ((cited_kind = ANY (ARRAY['paper'::text, 'reference'::text]))),
    CONSTRAINT paper_citations_citer_kind_check CHECK ((citer_kind = ANY (ARRAY['paper'::text, 'reference'::text]))),
    CONSTRAINT paper_citations_match_method_check CHECK ((match_method = ANY (ARRAY['doi'::text, 'title-fuzzy'::text, 'manual'::text])))
);
CREATE SEQUENCE public.paper_citations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.paper_citations_id_seq OWNED BY public.paper_citations.id;
CREATE TABLE public.paper_highlights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    paper_id uuid NOT NULL,
    user_id text NOT NULL,
    page integer NOT NULL,
    bbox jsonb,
    color text,
    note_md text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    run_id text,
    tool_call_id text
);
CREATE TABLE public.papers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id integer NOT NULL,
    user_id text NOT NULL,
    folder_path text DEFAULT ''::text NOT NULL,
    filename text NOT NULL,
    storage_url text,
    title text,
    authors text[],
    year integer,
    doi text,
    venue text,
    added_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    folder_id uuid,
    prev_folder_id uuid,
    chandra_status text DEFAULT 'pending'::text NOT NULL,
    chandra_completed_at timestamp with time zone,
    size_bytes bigint DEFAULT 0 NOT NULL,
    abstract_short text,
    chunks_ready_at timestamp with time zone
);
CREATE TABLE public.papersets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id integer NOT NULL,
    user_id text NOT NULL,
    folder_id uuid,
    prev_folder_id uuid,
    filename text NOT NULL,
    columns jsonb DEFAULT '[]'::jsonb NOT NULL,
    row_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    cell_grounding jsonb DEFAULT '{}'::jsonb NOT NULL,
    running_cells jsonb DEFAULT '[]'::jsonb NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.pending_recompute (
    user_id text NOT NULL,
    kind text NOT NULL,
    node_id uuid NOT NULL,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    tries integer DEFAULT 0 NOT NULL,
    CONSTRAINT pending_recompute_kind_chk CHECK ((kind = ANY (ARRAY['paper'::text, 'note'::text])))
);
CREATE TABLE public.processing_jobs (
    id integer NOT NULL,
    job_type public.job_type NOT NULL,
    status public.job_status DEFAULT 'queued'::public.job_status NOT NULL,
    error_message text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paper_id uuid NOT NULL
);
CREATE SEQUENCE public.processing_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.processing_jobs_id_seq OWNED BY public.processing_jobs.id;
CREATE TABLE public.provider_key_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    env_var text NOT NULL,
    reason text NOT NULL,
    hit_count integer DEFAULT 0 NOT NULL,
    sample_error text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_alerted_at timestamp with time zone,
    cleared_at timestamp with time zone
);
CREATE TABLE public.reference_embeddings (
    reference_id uuid NOT NULL,
    embedding public.vector(1536) NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."references" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id integer NOT NULL,
    user_id text NOT NULL,
    folder_path text DEFAULT ''::text NOT NULL,
    citation_key text NOT NULL,
    csl_json jsonb,
    paper_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    folder_id uuid,
    prev_folder_id uuid
);
CREATE TABLE public.s2_cooldown (
    id smallint NOT NULL,
    until_epoch double precision NOT NULL
);
CREATE TABLE public.semantic_edges (
    user_id text NOT NULL,
    src_kind text NOT NULL,
    src_id uuid NOT NULL,
    dst_kind text NOT NULL,
    dst_id uuid NOT NULL,
    weight real NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT semantic_edges_dst_kind_chk CHECK ((dst_kind = ANY (ARRAY['paper'::text, 'note'::text, 'reference'::text]))),
    CONSTRAINT semantic_edges_src_kind_chk CHECK ((src_kind = ANY (ARRAY['paper'::text, 'note'::text])))
);
CREATE TABLE public.session (
    id text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    token text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    ip_address text,
    user_agent text,
    user_id text NOT NULL
);
CREATE TABLE public.signup_waitlist (
    email text NOT NULL,
    firstname text NOT NULL,
    username text NOT NULL,
    user_type text NOT NULL,
    pokemon text NOT NULL,
    student_level text,
    job_role text,
    industry text,
    persona_other text,
    attempted_invite_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    university text,
    CONSTRAINT signup_waitlist_pokemon_check CHECK ((pokemon = ANY (ARRAY['charmander'::text, 'squirtle'::text, 'bulbasaur'::text]))),
    CONSTRAINT signup_waitlist_student_level_check CHECK (((student_level IS NULL) OR (student_level = ANY (ARRAY['Bachelor'::text, 'Master'::text, 'PhD'::text])))),
    CONSTRAINT signup_waitlist_user_type_check CHECK ((user_type = ANY (ARRAY['student'::text, 'researcher'::text, 'industry'::text, 'other'::text])))
);
CREATE TABLE public.store (
    prefix text NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone,
    ttl_minutes integer
);
CREATE TABLE public.store_migrations (
    v integer NOT NULL
);
CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    username text,
    is_anonymous boolean DEFAULT false NOT NULL,
    firstname text,
    user_type text,
    pokemon text,
    invite_code text,
    CONSTRAINT user_pokemon_check CHECK (((pokemon IS NULL) OR (pokemon = ANY (ARRAY['charmander'::text, 'squirtle'::text, 'bulbasaur'::text])))),
    CONSTRAINT user_user_type_check CHECK (((user_type IS NULL) OR (user_type = ANY (ARRAY['student'::text, 'researcher'::text, 'industry'::text, 'other'::text]))))
);
CREATE TABLE public.user_api_keys (
    id integer NOT NULL,
    user_id text NOT NULL,
    provider_type public.provider_type NOT NULL,
    provider_name text NOT NULL,
    encrypted_key text NOT NULL,
    key_preview text NOT NULL,
    is_valid boolean,
    last_validated_at timestamp with time zone,
    storage_mode public.storage_mode DEFAULT 'cloud'::public.storage_mode NOT NULL,
    preferences jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.user_api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.user_api_keys_id_seq OWNED BY public.user_api_keys.id;
CREATE TABLE public.user_highlights (
    id integer NOT NULL,
    user_id text NOT NULL,
    page_number integer NOT NULL,
    text_content text NOT NULL,
    start_offset integer NOT NULL,
    end_offset integer NOT NULL,
    color public.highlight_color DEFAULT 'yellow'::public.highlight_color NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source public.highlight_source DEFAULT 'user'::public.highlight_source NOT NULL,
    layer_id uuid,
    comment text,
    rects jsonb,
    paper_id uuid NOT NULL
);
CREATE SEQUENCE public.user_highlights_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.user_highlights_id_seq OWNED BY public.user_highlights.id;
CREATE TABLE public.user_invite_codes (
    code text NOT NULL,
    owner_user_id text NOT NULL,
    consumed_by_user_id text,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.user_library_recents (
    user_id text NOT NULL,
    kind text NOT NULL,
    item_id uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_library_recents_kind_check CHECK ((kind = ANY (ARRAY['paper'::text, 'note'::text, 'reference'::text, 'paperset'::text])))
);
CREATE TABLE public.user_openrouter_keys (
    user_id text NOT NULL,
    or_key_hash text NOT NULL,
    or_key_encrypted text NOT NULL,
    limit_usd numeric(10,4) DEFAULT 5 NOT NULL,
    limit_reset text,
    tier text DEFAULT 'trial'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.user_preferences (
    user_id text NOT NULL,
    font public.font_pref DEFAULT 'sans'::public.font_pref NOT NULL,
    ruled_lines boolean DEFAULT false NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.user_signup_profiles (
    user_id text NOT NULL,
    student_level text,
    job_role text,
    industry text,
    persona_other text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    university text,
    CONSTRAINT user_signup_profiles_student_level_check CHECK (((student_level IS NULL) OR (student_level = ANY (ARRAY['Bachelor'::text, 'Master'::text, 'PhD'::text]))))
);
CREATE TABLE public.user_subscriptions (
    user_id text NOT NULL,
    tier text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);
ALTER TABLE ONLY public.agent_conversations ALTER COLUMN id SET DEFAULT nextval('public.agent_conversations_id_seq'::regclass);
ALTER TABLE ONLY public.agent_messages ALTER COLUMN id SET DEFAULT nextval('public.agent_messages_id_seq'::regclass);
ALTER TABLE ONLY public.document_chunks ALTER COLUMN id SET DEFAULT nextval('public.document_chunks_id_seq'::regclass);
ALTER TABLE ONLY public.document_outlines ALTER COLUMN id SET DEFAULT nextval('public.document_outlines_id_seq'::regclass);
ALTER TABLE ONLY public.document_reference_markers ALTER COLUMN id SET DEFAULT nextval('public.document_reference_markers_id_seq'::regclass);
ALTER TABLE ONLY public.document_references ALTER COLUMN id SET DEFAULT nextval('public.document_references_id_seq'::regclass);
ALTER TABLE ONLY public.document_sections ALTER COLUMN id SET DEFAULT nextval('public.document_sections_id_seq'::regclass);
ALTER TABLE ONLY public.document_segments ALTER COLUMN id SET DEFAULT nextval('public.document_segments_id_seq'::regclass);
ALTER TABLE ONLY public.kept_citations ALTER COLUMN id SET DEFAULT nextval('public.kept_citations_id_seq'::regclass);
ALTER TABLE ONLY public.libraries ALTER COLUMN id SET DEFAULT nextval('public.libraries_id_seq'::regclass);
ALTER TABLE ONLY public.library_references ALTER COLUMN id SET DEFAULT nextval('public.library_references_id_seq'::regclass);
ALTER TABLE ONLY public.openrouter_usage ALTER COLUMN id SET DEFAULT nextval('public.openrouter_usage_id_seq'::regclass);
ALTER TABLE ONLY public.paper_citations ALTER COLUMN id SET DEFAULT nextval('public.paper_citations_id_seq'::regclass);
ALTER TABLE ONLY public.processing_jobs ALTER COLUMN id SET DEFAULT nextval('public.processing_jobs_id_seq'::regclass);
ALTER TABLE ONLY public.user_api_keys ALTER COLUMN id SET DEFAULT nextval('public.user_api_keys_id_seq'::regclass);
ALTER TABLE ONLY public.user_highlights ALTER COLUMN id SET DEFAULT nextval('public.user_highlights_id_seq'::regclass);
ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_configs
    ADD CONSTRAINT agent_configs_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_memories
    ADD CONSTRAINT agent_memories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_message_metadata
    ADD CONSTRAINT agent_message_metadata_pkey PRIMARY KEY (user_id, thread_id, message_id, kind);
ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_thread_papers
    ADD CONSTRAINT agent_thread_papers_pkey PRIMARY KEY (user_id, thread_id, paper_id);
ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_user_id_thread_id_pk PRIMARY KEY (user_id, thread_id);
ALTER TABLE ONLY public.ai_highlight_runs
    ADD CONSTRAINT ai_highlight_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.checkpoint_blobs
    ADD CONSTRAINT checkpoint_blobs_pkey PRIMARY KEY (thread_id, checkpoint_ns, channel, version);
ALTER TABLE ONLY public.checkpoint_migrations
    ADD CONSTRAINT checkpoint_migrations_pkey PRIMARY KEY (v);
ALTER TABLE ONLY public.checkpoint_writes
    ADD CONSTRAINT checkpoint_writes_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx);
ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id);
ALTER TABLE ONLY public.citation_enrichment_jobs
    ADD CONSTRAINT citation_enrichment_jobs_pkey PRIMARY KEY (paper_id);
ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.document_outlines
    ADD CONSTRAINT document_outlines_paper_id_unique UNIQUE (paper_id);
ALTER TABLE ONLY public.document_outlines
    ADD CONSTRAINT document_outlines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.document_reference_markers
    ADD CONSTRAINT document_reference_markers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.document_references
    ADD CONSTRAINT document_references_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.document_sections
    ADD CONSTRAINT document_sections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.document_segments
    ADD CONSTRAINT document_segments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.kept_citations
    ADD CONSTRAINT kept_citations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.kept_citations
    ADD CONSTRAINT kept_citations_user_doc_ref_unique UNIQUE (user_id, document_reference_id);
ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.library_references
    ADD CONSTRAINT library_references_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.note_chunks
    ADD CONSTRAINT note_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.note_links
    ADD CONSTRAINT note_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.note_revisions
    ADD CONSTRAINT note_revisions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.note_tags
    ADD CONSTRAINT note_tags_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.openrouter_catalog
    ADD CONSTRAINT openrouter_catalog_pkey PRIMARY KEY (model_id);
ALTER TABLE ONLY public.openrouter_usage
    ADD CONSTRAINT openrouter_usage_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.paper_citations
    ADD CONSTRAINT paper_citations_citer_kind_citer_id_cited_kind_cited_id_key UNIQUE (citer_kind, citer_id, cited_kind, cited_id);
ALTER TABLE ONLY public.paper_citations
    ADD CONSTRAINT paper_citations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.paper_chunks
    ADD CONSTRAINT paper_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.paper_highlights
    ADD CONSTRAINT paper_highlights_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.papers
    ADD CONSTRAINT papers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.papersets
    ADD CONSTRAINT papersets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pending_recompute
    ADD CONSTRAINT pending_recompute_user_id_kind_node_id_pk PRIMARY KEY (user_id, kind, node_id);
ALTER TABLE ONLY public.processing_jobs
    ADD CONSTRAINT processing_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.provider_key_alerts
    ADD CONSTRAINT provider_key_alerts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.reference_embeddings
    ADD CONSTRAINT reference_embeddings_pkey PRIMARY KEY (reference_id);
ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.s2_cooldown
    ADD CONSTRAINT s2_cooldown_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.semantic_edges
    ADD CONSTRAINT semantic_edges_user_id_src_kind_src_id_dst_kind_dst_id_pk PRIMARY KEY (user_id, src_kind, src_id, dst_kind, dst_id);
ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_unique UNIQUE (token);
ALTER TABLE ONLY public.signup_waitlist
    ADD CONSTRAINT signup_waitlist_pkey PRIMARY KEY (email);
ALTER TABLE ONLY public.store_migrations
    ADD CONSTRAINT store_migrations_pkey PRIMARY KEY (v);
ALTER TABLE ONLY public.store
    ADD CONSTRAINT store_pkey PRIMARY KEY (prefix, key);
ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_unique UNIQUE (email);
ALTER TABLE ONLY public.user_highlights
    ADD CONSTRAINT user_highlights_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_invite_codes
    ADD CONSTRAINT user_invite_codes_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.user_library_recents
    ADD CONSTRAINT user_library_recents_pkey PRIMARY KEY (user_id, kind, item_id);
ALTER TABLE ONLY public.user_openrouter_keys
    ADD CONSTRAINT user_openrouter_keys_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.user_signup_profiles
    ADD CONSTRAINT user_signup_profiles_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_username_unique UNIQUE (username);
ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);
CREATE INDEX "account_userId_idx" ON public.account USING btree (user_id);
CREATE INDEX agent_conversations_kind_idx ON public.agent_conversations USING btree (paper_id, kind);
CREATE INDEX agent_memories_user_ns_idx ON public.agent_memories USING btree (user_id, namespace);
CREATE INDEX agent_message_metadata_thread_id_idx ON public.agent_message_metadata USING btree (thread_id);
CREATE INDEX agent_message_metadata_user_id_idx ON public.agent_message_metadata USING btree (user_id);
CREATE INDEX agent_thread_papers_user_paper_idx ON public.agent_thread_papers USING btree (user_id, paper_id, created_at DESC);
CREATE INDEX ai_highlight_runs_paper_idx ON public.ai_highlight_runs USING btree (paper_id, created_at DESC);
CREATE INDEX assets_library_folder_idx ON public.assets USING btree (library_id, folder_id);
CREATE INDEX assets_library_idx ON public.assets USING btree (library_id);
CREATE INDEX checkpoint_blobs_thread_id_idx ON public.checkpoint_blobs USING btree (thread_id);
CREATE INDEX checkpoint_writes_thread_id_idx ON public.checkpoint_writes USING btree (thread_id);
CREATE INDEX checkpoints_thread_id_idx ON public.checkpoints USING btree (thread_id);
CREATE UNIQUE INDEX citation_enrichment_jobs_paper_id_unique ON public.citation_enrichment_jobs USING btree (paper_id);
CREATE INDEX document_chunks_embedding_idx ON public.document_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');
CREATE UNIQUE INDEX document_chunks_paper_chunk_idx_unique ON public.document_chunks USING btree (paper_id, chunk_index);
CREATE INDEX document_chunks_paper_idx ON public.document_chunks USING btree (paper_id);
CREATE INDEX document_reference_markers_reference_id_idx ON public.document_reference_markers USING btree (reference_id);
CREATE INDEX document_sections_paper_idx ON public.document_sections USING btree (paper_id);
CREATE INDEX document_segments_paper_page_idx ON public.document_segments USING btree (paper_id, page);
CREATE UNIQUE INDEX folders_library_parent_name_unique ON public.folders USING btree (library_id, parent_id, name);
CREATE INDEX idx_document_references_doi_lower ON public.document_references USING btree (lower(TRIM(BOTH FROM doi))) WHERE (doi IS NOT NULL);
CREATE INDEX idx_document_references_title_trgm ON public.document_references USING gin (title public.gin_trgm_ops) WHERE (title IS NOT NULL);
CREATE INDEX idx_invite_used_by ON public.invite_codes USING btree (used_by_user_id) WHERE (used_by_user_id IS NOT NULL);
CREATE INDEX idx_or_usage_guest_ts ON public.openrouter_usage USING btree (guest_session_id, created_at DESC) WHERE (guest_session_id IS NOT NULL);
CREATE INDEX idx_or_usage_user_ts ON public.openrouter_usage USING btree (user_id, created_at DESC);
CREATE INDEX idx_papers_doi_lower ON public.papers USING btree (lower(TRIM(BOTH FROM doi))) WHERE (doi IS NOT NULL);
CREATE INDEX idx_papers_title_trgm ON public.papers USING gin (title public.gin_trgm_ops);
CREATE INDEX idx_pc_cited ON public.paper_citations USING btree (cited_kind, cited_id);
CREATE INDEX idx_pc_citer ON public.paper_citations USING btree (citer_kind, citer_id);
CREATE INDEX idx_provider_key_alerts_last_seen ON public.provider_key_alerts USING btree (last_seen_at DESC);
CREATE INDEX idx_references_doi_lower ON public."references" USING btree (lower(TRIM(BOTH FROM (csl_json ->> 'DOI'::text)))) WHERE ((csl_json ->> 'DOI'::text) IS NOT NULL);
CREATE INDEX idx_references_title_trgm ON public."references" USING gin (((csl_json ->> 'title'::text)) public.gin_trgm_ops) WHERE ((csl_json ->> 'title'::text) IS NOT NULL);
CREATE INDEX idx_store_expires_at ON public.store USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_user_invite_codes_owner ON public.user_invite_codes USING btree (owner_user_id);
CREATE INDEX kept_citations_user_id_idx ON public.kept_citations USING btree (user_id);
CREATE UNIQUE INDEX libraries_user_id_unique ON public.libraries USING btree (user_id);
CREATE INDEX library_references_folder_idx ON public.library_references USING btree (user_id, folder_id);
CREATE UNIQUE INDEX library_references_user_doi_unique_idx ON public.library_references USING btree (user_id, doi) WHERE (doi IS NOT NULL);
CREATE INDEX library_references_user_id_idx ON public.library_references USING btree (user_id);
CREATE INDEX note_chunks_embedding_idx ON public.note_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');
CREATE INDEX note_chunks_ivfflat_idx ON public.note_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');
CREATE INDEX note_chunks_note_idx ON public.note_chunks USING btree (note_id);
CREATE INDEX note_links_source_idx ON public.note_links USING btree (source_note_id);
CREATE INDEX note_links_target_idx ON public.note_links USING btree (target_kind, target_id);
CREATE INDEX note_revisions_note_id_created_at_id_idx ON public.note_revisions USING btree (note_id, created_at DESC NULLS LAST, id DESC NULLS LAST);
CREATE UNIQUE INDEX note_tags_note_tag_unique ON public.note_tags USING btree (note_id, tag);
CREATE INDEX note_tags_tag_idx ON public.note_tags USING btree (tag);
CREATE INDEX notes_library_folder_idx ON public.notes USING btree (library_id, folder_path);
CREATE UNIQUE INDEX notes_user_public_slug_unique ON public.notes USING btree (user_id, public_slug) WHERE (public_slug IS NOT NULL);
CREATE UNIQUE INDEX notes_user_slug_unique ON public.notes USING btree (user_id, slug);
CREATE INDEX paper_chunks_embedding_idx ON public.paper_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');
CREATE INDEX paper_chunks_ivfflat_idx ON public.paper_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');
CREATE INDEX paper_chunks_paper_idx ON public.paper_chunks USING btree (paper_id);
CREATE INDEX paper_highlights_paper_idx ON public.paper_highlights USING btree (paper_id);
CREATE UNIQUE INDEX paper_highlights_run_page_bbox_uk ON public.paper_highlights USING btree (run_id, page, ((bbox)::text)) WHERE (run_id IS NOT NULL);
CREATE INDEX papers_folder_path_idx ON public.papers USING btree (library_id, folder_path);
CREATE INDEX papers_library_idx ON public.papers USING btree (library_id);
CREATE INDEX papers_user_chunks_ready_idx ON public.papers USING btree (user_id, chunks_ready_at);
CREATE INDEX papersets_row_refs_gin ON public.papersets USING gin (row_refs jsonb_path_ops);
CREATE INDEX papersets_user_folder_idx ON public.papersets USING btree (user_id, folder_id);
CREATE INDEX pending_recompute_claimed ON public.pending_recompute USING btree (claimed_at);
CREATE INDEX pending_recompute_enqueued ON public.pending_recompute USING btree (enqueued_at);
CREATE UNIQUE INDEX provider_key_alerts_active_unique ON public.provider_key_alerts USING btree (provider, env_var, reason) WHERE (cleared_at IS NULL);
CREATE INDEX reference_embeddings_emb_idx ON public.reference_embeddings USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');
CREATE INDEX references_library_folder_idx ON public."references" USING btree (library_id, folder_path);
CREATE UNIQUE INDEX references_library_key_unique ON public."references" USING btree (library_id, citation_key);
CREATE INDEX semantic_edges_dst ON public.semantic_edges USING btree (user_id, dst_kind, dst_id);
CREATE INDEX semantic_edges_src ON public.semantic_edges USING btree (user_id, src_kind, src_id);
CREATE INDEX "session_userId_idx" ON public.session USING btree (user_id);
CREATE INDEX store_prefix_idx ON public.store USING btree (prefix text_pattern_ops);
CREATE INDEX user_highlights_layer_idx ON public.user_highlights USING btree (layer_id);
CREATE UNIQUE INDEX user_highlights_layer_page_offsets_uk ON public.user_highlights USING btree (layer_id, page_number, start_offset, end_offset) WHERE (layer_id IS NOT NULL);
CREATE INDEX user_highlights_user_paper_idx ON public.user_highlights USING btree (user_id, paper_id);
CREATE INDEX user_library_recents_user_opened_idx ON public.user_library_recents USING btree (user_id, opened_at DESC);
CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);
ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_configs
    ADD CONSTRAINT agent_configs_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_memories
    ADD CONSTRAINT agent_memories_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_message_metadata
    ADD CONSTRAINT agent_message_metadata_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_conversation_id_agent_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.agent_conversations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_thread_papers
    ADD CONSTRAINT agent_thread_papers_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_thread_papers
    ADD CONSTRAINT agent_thread_papers_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.ai_highlight_runs
    ADD CONSTRAINT ai_highlight_runs_conversation_id_agent_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.agent_conversations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.ai_highlight_runs
    ADD CONSTRAINT ai_highlight_runs_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.ai_highlight_runs
    ADD CONSTRAINT ai_highlight_runs_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_folder_id_folders_id_fk FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_library_id_libraries_id_fk FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.citation_enrichment_jobs
    ADD CONSTRAINT citation_enrichment_jobs_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_section_id_document_sections_id_fk FOREIGN KEY (section_id) REFERENCES public.document_sections(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.document_outlines
    ADD CONSTRAINT document_outlines_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.document_reference_markers
    ADD CONSTRAINT document_reference_markers_reference_id_document_references_id_ FOREIGN KEY (reference_id) REFERENCES public.document_references(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.document_sections
    ADD CONSTRAINT document_sections_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.document_segments
    ADD CONSTRAINT document_segments_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_library_id_libraries_id_fk FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_parent_fk FOREIGN KEY (parent_id) REFERENCES public.folders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_used_by_user_id_fkey FOREIGN KEY (used_by_user_id) REFERENCES public."user"(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.kept_citations
    ADD CONSTRAINT kept_citations_document_reference_id_document_references_id_fk FOREIGN KEY (document_reference_id) REFERENCES public.document_references(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kept_citations
    ADD CONSTRAINT kept_citations_library_reference_id_library_references_id_fk FOREIGN KEY (library_reference_id) REFERENCES public.library_references(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.kept_citations
    ADD CONSTRAINT kept_citations_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.library_references
    ADD CONSTRAINT library_references_folder_id_folders_id_fk FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.library_references
    ADD CONSTRAINT library_references_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.note_chunks
    ADD CONSTRAINT note_embeddings_note_id_notes_id_fk FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.note_links
    ADD CONSTRAINT note_links_source_note_id_notes_id_fk FOREIGN KEY (source_note_id) REFERENCES public.notes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.note_revisions
    ADD CONSTRAINT note_revisions_author_id_user_id_fk FOREIGN KEY (author_id) REFERENCES public."user"(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.note_revisions
    ADD CONSTRAINT note_revisions_note_id_notes_id_fk FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.note_tags
    ADD CONSTRAINT note_tags_note_id_notes_id_fk FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_folder_id_folders_id_fk FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_library_id_libraries_id_fk FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_prev_folder_id_folders_id_fk FOREIGN KEY (prev_folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.openrouter_usage
    ADD CONSTRAINT openrouter_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.paper_chunks
    ADD CONSTRAINT paper_embeddings_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.paper_highlights
    ADD CONSTRAINT paper_highlights_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.paper_highlights
    ADD CONSTRAINT paper_highlights_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.papers
    ADD CONSTRAINT papers_folder_id_folders_id_fk FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.papers
    ADD CONSTRAINT papers_library_id_libraries_id_fk FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.papers
    ADD CONSTRAINT papers_prev_folder_id_folders_id_fk FOREIGN KEY (prev_folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.papers
    ADD CONSTRAINT papers_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.papersets
    ADD CONSTRAINT papersets_folder_id_folders_id_fk FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.papersets
    ADD CONSTRAINT papersets_library_id_libraries_id_fk FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.papersets
    ADD CONSTRAINT papersets_prev_folder_id_folders_id_fk FOREIGN KEY (prev_folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.papersets
    ADD CONSTRAINT papersets_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.processing_jobs
    ADD CONSTRAINT processing_jobs_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reference_embeddings
    ADD CONSTRAINT reference_embeddings_reference_id_references_id_fk FOREIGN KEY (reference_id) REFERENCES public."references"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_folder_id_folders_id_fk FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_library_id_libraries_id_fk FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_prev_folder_id_folders_id_fk FOREIGN KEY (prev_folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_highlights
    ADD CONSTRAINT user_highlights_paper_id_papers_id_fk FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_highlights
    ADD CONSTRAINT user_highlights_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_invite_codes
    ADD CONSTRAINT user_invite_codes_consumed_by_user_id_fk FOREIGN KEY (consumed_by_user_id) REFERENCES public."user"(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.user_invite_codes
    ADD CONSTRAINT user_invite_codes_owner_user_id_fk FOREIGN KEY (owner_user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_library_recents
    ADD CONSTRAINT user_library_recents_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_openrouter_keys
    ADD CONSTRAINT user_openrouter_keys_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_signup_profiles
    ADD CONSTRAINT user_signup_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
