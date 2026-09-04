-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "source_kind" AS ENUM ('X', 'REDDIT', 'HACKERNEWS', 'RSS', 'GITHUB');

-- CreateEnum
CREATE TYPE "content_language" AS ENUM ('EN', 'AR', 'OTHER');

-- CreateEnum
CREATE TYPE "ui_locale" AS ENUM ('en', 'ar');

-- CreateEnum
CREATE TYPE "theme_preference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "topic_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "topic_classification" AS ENUM ('NORMAL', 'EMERGING_TREND', 'HIDDEN_GEM', 'SATURATED');

-- CreateEnum
CREATE TYPE "translation_mode" AS ENUM ('LITERAL', 'NATURAL', 'X_STYLE', 'PROFESSIONAL', 'SIMPLE_ARABIC');

-- CreateEnum
CREATE TYPE "terminology_preference" AS ENUM ('KEEP_COMMON_ENGLISH_TERMS', 'ARABIC_WHEN_POSSIBLE', 'FULL_ARABIC');

-- CreateEnum
CREATE TYPE "translation_target_kind" AS ENUM ('POST', 'COMMENT', 'THREAD', 'TOPIC', 'FREEFORM');

-- CreateEnum
CREATE TYPE "content_draft_kind" AS ENUM ('SHORT_X_POST', 'LONG_X_POST', 'X_THREAD', 'EDUCATIONAL_POST', 'OPINION_POST', 'BUSINESS_ANGLE', 'DEVELOPER_ANGLE', 'SAUDI_MARKET_ANGLE', 'SUMMARY', 'HOOK', 'CONTENT_IDEA');

-- CreateEnum
CREATE TYPE "content_draft_status" AS ENUM ('DRAFT', 'READY', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "saved_item_kind" AS ENUM ('POST', 'TOPIC', 'THREAD', 'CONTENT_DRAFT');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "scan_trigger" AS ENUM ('MANUAL', 'SCHEDULED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "report_kind" AS ENUM ('POSTS_COLLECTED', 'TOPICS_DETECTED', 'SOURCE_DISTRIBUTION', 'TREND_GROWTH', 'TOP_CATEGORIES', 'ARABIC_OPPORTUNITIES', 'TRANSLATION_ACTIVITY', 'CONTENT_GENERATION', 'SCAN_HISTORY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT DEFAULT 'user',
    "banned" BOOLEAN DEFAULT false,
    "ban_reason" TEXT,
    "ban_expires" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,
    "impersonated_by" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "locale" "ui_locale" NOT NULL DEFAULT 'en',
    "theme" "theme_preference" NOT NULL DEFAULT 'SYSTEM',
    "translation_mode" "translation_mode" NOT NULL DEFAULT 'X_STYLE',
    "terminology_preference" "terminology_preference" NOT NULL DEFAULT 'KEEP_COMMON_ENGLISH_TERMS',
    "ai_classification_enabled" BOOLEAN NOT NULL DEFAULT false,
    "email_notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
    "emerging_trend_alerts" BOOLEAN NOT NULL DEFAULT true,
    "arabic_opportunity_alerts" BOOLEAN NOT NULL DEFAULT true,
    "default_analytics_range" TEXT NOT NULL DEFAULT '7d',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "embedding" vector(768),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_keywords" (
    "id" TEXT NOT NULL,
    "interest_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "kind" "source_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "authority_weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "scan_interval_minutes" INTEGER NOT NULL DEFAULT 15,
    "last_scanned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_configs" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_items" (
    "id" TEXT NOT NULL,
    "source" "source_kind" NOT NULL,
    "source_item_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "scan_run_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "collected_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "source" "source_kind" NOT NULL,
    "source_post_id" TEXT NOT NULL,
    "author_id" TEXT,
    "author_name" TEXT,
    "author_username" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonical_url" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "language" "content_language" NOT NULL DEFAULT 'OTHER',
    "published_at" TIMESTAMP(3) NOT NULL,
    "collected_at" TIMESTAMP(3) NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "engagement_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "relevance_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trend_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opportunity_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "relevance_breakdown" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_saved" BOOLEAN NOT NULL DEFAULT false,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "raw_item_id" TEXT,
    "topic_id" TEXT,
    "embedding" vector(768),
    "search_vector" tsvector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "source_comment_id" TEXT NOT NULL,
    "source" "source_kind" NOT NULL,
    "author" TEXT,
    "content" TEXT NOT NULL,
    "language" "content_language" NOT NULL DEFAULT 'OTHER',
    "likes" INTEGER NOT NULL DEFAULT 0,
    "content_hash" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "raw_item_id" TEXT,
    "embedding" vector(768),
    "search_vector" tsvector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "status" "topic_status" NOT NULL DEFAULT 'ACTIVE',
    "classification" "topic_classification" NOT NULL DEFAULT 'NORMAL',
    "classification_reasons" JSONB NOT NULL DEFAULT '[]',
    "post_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "english_post_count" INTEGER NOT NULL DEFAULT 0,
    "arabic_post_count" INTEGER NOT NULL DEFAULT 0,
    "distinct_source_count" INTEGER NOT NULL DEFAULT 0,
    "trend_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "relevance_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "velocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "arabic_opportunity_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trend_breakdown" JSONB,
    "arabic_opportunity_breakdown" JSONB,
    "first_detected_at" TIMESTAMP(3) NOT NULL,
    "last_detected_at" TIMESTAMP(3) NOT NULL,
    "embedding" vector(768),
    "search_vector" tsvector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_posts" (
    "topic_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_posts_pkey" PRIMARY KEY ("topic_id","post_id")
);

-- CreateTable
CREATE TABLE "trend_snapshots" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "trend_score" DOUBLE PRECISION NOT NULL,
    "post_count" INTEGER NOT NULL,
    "engagement" DOUBLE PRECISION NOT NULL,
    "velocity" DOUBLE PRECISION NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL,
    "freshness" DOUBLE PRECISION NOT NULL,
    "cross_source_signal" DOUBLE PRECISION NOT NULL,
    "source_authority" DOUBLE PRECISION NOT NULL,
    "novelty" DOUBLE PRECISION NOT NULL,
    "arabic_opportunity" DOUBLE PRECISION NOT NULL,
    "saturation_penalty" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trend_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "saved_item_kind" NOT NULL,
    "post_id" TEXT,
    "topic_id" TEXT,
    "thread_id" TEXT,
    "content_draft_id" TEXT,
    "note" TEXT,
    "collection" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target_kind" "translation_target_kind" NOT NULL,
    "post_id" TEXT,
    "comment_id" TEXT,
    "thread_id" TEXT,
    "topic_id" TEXT,
    "source_language" "content_language" NOT NULL,
    "target_language" "content_language" NOT NULL,
    "mode" "translation_mode" NOT NULL,
    "terminology_preference" "terminology_preference" NOT NULL,
    "source_content" TEXT NOT NULL,
    "translated_content" TEXT NOT NULL,
    "preserved_terms" TEXT[],
    "explanation" TEXT,
    "provider_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "topic_id" TEXT,
    "title" TEXT NOT NULL,
    "language" "content_language" NOT NULL DEFAULT 'EN',
    "status" "content_draft_status" NOT NULL DEFAULT 'DRAFT',
    "is_saved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_posts" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "character_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thread_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "topic_id" TEXT,
    "post_id" TEXT,
    "thread_id" TEXT,
    "kind" "content_draft_kind" NOT NULL,
    "status" "content_draft_status" NOT NULL DEFAULT 'DRAFT',
    "language" "content_language" NOT NULL DEFAULT 'EN',
    "title" TEXT,
    "content" TEXT NOT NULL,
    "character_count" INTEGER NOT NULL,
    "tone" TEXT,
    "provider_name" TEXT NOT NULL,
    "is_saved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_publications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_draft_id" TEXT,
    "thread_id" TEXT,
    "topic_id" TEXT,
    "content_kind" "content_draft_kind" NOT NULL,
    "language" "content_language" NOT NULL,
    "original_content" TEXT NOT NULL,
    "published_content" TEXT NOT NULL,
    "published_url" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "trigger" "scan_trigger" NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'PENDING',
    "source_kinds" "source_kind"[],
    "items_collected" INTEGER NOT NULL DEFAULT 0,
    "items_stored" INTEGER NOT NULL DEFAULT 0,
    "duplicates_skipped" INTEGER NOT NULL DEFAULT 0,
    "posts_created" INTEGER NOT NULL DEFAULT 0,
    "comments_created" INTEGER NOT NULL DEFAULT 0,
    "topics_created" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "failure_reason" TEXT,

    CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "job_id" TEXT,
    "scan_run_id" TEXT,
    "status" "job_status" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "duration_ms" INTEGER,
    "failure_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "report_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "range_from" TIMESTAMP(3) NOT NULL,
    "range_to" TIMESTAMP(3) NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "payload" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "accounts_provider_id_account_id_idx" ON "accounts"("provider_id", "account_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_issuer_account_id_uidx" ON "accounts"("issuer", "account_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE INDEX "verifications_expires_at_idx" ON "verifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

-- CreateIndex
CREATE INDEX "interests_user_id_enabled_idx" ON "interests"("user_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "interests_user_id_name_key" ON "interests"("user_id", "name");

-- CreateIndex
CREATE INDEX "interest_keywords_keyword_idx" ON "interest_keywords"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "interest_keywords_interest_id_keyword_key" ON "interest_keywords"("interest_id", "keyword");

-- CreateIndex
CREATE UNIQUE INDEX "sources_slug_key" ON "sources"("slug");

-- CreateIndex
CREATE INDEX "sources_kind_enabled_idx" ON "sources"("kind", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "source_configs_source_id_key_key" ON "source_configs"("source_id", "key");

-- CreateIndex
CREATE INDEX "raw_items_content_hash_idx" ON "raw_items"("content_hash");

-- CreateIndex
CREATE INDEX "raw_items_collected_at_idx" ON "raw_items"("collected_at");

-- CreateIndex
CREATE INDEX "raw_items_scan_run_id_idx" ON "raw_items"("scan_run_id");

-- CreateIndex
CREATE INDEX "raw_items_processed_at_idx" ON "raw_items"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "raw_items_source_source_item_id_key" ON "raw_items"("source", "source_item_id");

-- CreateIndex
CREATE INDEX "posts_published_at_idx" ON "posts"("published_at" DESC);

-- CreateIndex
CREATE INDEX "posts_collected_at_idx" ON "posts"("collected_at" DESC);

-- CreateIndex
CREATE INDEX "posts_source_published_at_idx" ON "posts"("source", "published_at" DESC);

-- CreateIndex
CREATE INDEX "posts_topic_id_idx" ON "posts"("topic_id");

-- CreateIndex
CREATE INDEX "posts_language_idx" ON "posts"("language");

-- CreateIndex
CREATE INDEX "posts_trend_score_idx" ON "posts"("trend_score" DESC);

-- CreateIndex
CREATE INDEX "posts_relevance_score_idx" ON "posts"("relevance_score" DESC);

-- CreateIndex
CREATE INDEX "posts_opportunity_score_idx" ON "posts"("opportunity_score" DESC);

-- CreateIndex
CREATE INDEX "posts_content_hash_idx" ON "posts"("content_hash");

-- CreateIndex
CREATE INDEX "posts_canonical_url_idx" ON "posts"("canonical_url");

-- CreateIndex
CREATE INDEX "posts_is_hidden_published_at_idx" ON "posts"("is_hidden", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "posts_source_source_post_id_key" ON "posts"("source", "source_post_id");

-- CreateIndex
CREATE INDEX "comments_post_id_published_at_idx" ON "comments"("post_id", "published_at" DESC);

-- CreateIndex
CREATE INDEX "comments_language_idx" ON "comments"("language");

-- CreateIndex
CREATE UNIQUE INDEX "comments_source_source_comment_id_key" ON "comments"("source", "source_comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "topics_slug_key" ON "topics"("slug");

-- CreateIndex
CREATE INDEX "topics_status_trend_score_idx" ON "topics"("status", "trend_score" DESC);

-- CreateIndex
CREATE INDEX "topics_classification_trend_score_idx" ON "topics"("classification", "trend_score" DESC);

-- CreateIndex
CREATE INDEX "topics_arabic_opportunity_score_idx" ON "topics"("arabic_opportunity_score" DESC);

-- CreateIndex
CREATE INDEX "topics_last_detected_at_idx" ON "topics"("last_detected_at" DESC);

-- CreateIndex
CREATE INDEX "topics_first_detected_at_idx" ON "topics"("first_detected_at" DESC);

-- CreateIndex
CREATE INDEX "topic_posts_post_id_idx" ON "topic_posts"("post_id");

-- CreateIndex
CREATE INDEX "trend_snapshots_topic_id_recorded_at_idx" ON "trend_snapshots"("topic_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "trend_snapshots_recorded_at_idx" ON "trend_snapshots"("recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "trend_snapshots_topic_id_recorded_at_key" ON "trend_snapshots"("topic_id", "recorded_at");

-- CreateIndex
CREATE INDEX "saved_items_user_id_kind_created_at_idx" ON "saved_items"("user_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "saved_items_user_id_post_id_key" ON "saved_items"("user_id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_items_user_id_topic_id_key" ON "saved_items"("user_id", "topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_items_user_id_thread_id_key" ON "saved_items"("user_id", "thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_items_user_id_content_draft_id_key" ON "saved_items"("user_id", "content_draft_id");

-- CreateIndex
CREATE INDEX "translations_user_id_created_at_idx" ON "translations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "translations_post_id_idx" ON "translations"("post_id");

-- CreateIndex
CREATE INDEX "translations_thread_id_idx" ON "translations"("thread_id");

-- CreateIndex
CREATE INDEX "translations_target_kind_target_language_idx" ON "translations"("target_kind", "target_language");

-- CreateIndex
CREATE INDEX "threads_user_id_created_at_idx" ON "threads"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "threads_topic_id_idx" ON "threads"("topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "thread_posts_thread_id_position_key" ON "thread_posts"("thread_id", "position");

-- CreateIndex
CREATE INDEX "content_drafts_user_id_created_at_idx" ON "content_drafts"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "content_drafts_user_id_kind_status_idx" ON "content_drafts"("user_id", "kind", "status");

-- CreateIndex
CREATE INDEX "content_drafts_topic_id_idx" ON "content_drafts"("topic_id");

-- CreateIndex
CREATE INDEX "manual_publications_user_id_published_at_idx" ON "manual_publications"("user_id", "published_at" DESC);

-- CreateIndex
CREATE INDEX "manual_publications_topic_id_idx" ON "manual_publications"("topic_id");

-- CreateIndex
CREATE INDEX "scan_runs_started_at_idx" ON "scan_runs"("started_at" DESC);

-- CreateIndex
CREATE INDEX "scan_runs_status_started_at_idx" ON "scan_runs"("status", "started_at" DESC);

-- CreateIndex
CREATE INDEX "scan_runs_user_id_idx" ON "scan_runs"("user_id");

-- CreateIndex
CREATE INDEX "job_runs_queue_started_at_idx" ON "job_runs"("queue", "started_at" DESC);

-- CreateIndex
CREATE INDEX "job_runs_status_started_at_idx" ON "job_runs"("status", "started_at" DESC);

-- CreateIndex
CREATE INDEX "job_runs_scan_run_id_idx" ON "job_runs"("scan_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_queue_job_id_attempt_key" ON "job_runs"("queue", "job_id", "attempt");

-- CreateIndex
CREATE INDEX "api_usage_recorded_at_idx" ON "api_usage"("recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "api_usage_provider_operation_recorded_at_key" ON "api_usage"("provider", "operation", "recorded_at");

-- CreateIndex
CREATE INDEX "reports_user_id_generated_at_idx" ON "reports"("user_id", "generated_at" DESC);

-- CreateIndex
CREATE INDEX "reports_kind_generated_at_idx" ON "reports"("kind", "generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interests" ADD CONSTRAINT "interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_keywords" ADD CONSTRAINT "interest_keywords_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_configs" ADD CONSTRAINT "source_configs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_scan_run_id_fkey" FOREIGN KEY ("scan_run_id") REFERENCES "scan_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "raw_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "raw_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_posts" ADD CONSTRAINT "topic_posts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_posts" ADD CONSTRAINT "topic_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trend_snapshots" ADD CONSTRAINT "trend_snapshots_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_content_draft_id_fkey" FOREIGN KEY ("content_draft_id") REFERENCES "content_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_posts" ADD CONSTRAINT "thread_posts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_publications" ADD CONSTRAINT "manual_publications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_publications" ADD CONSTRAINT "manual_publications_content_draft_id_fkey" FOREIGN KEY ("content_draft_id") REFERENCES "content_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_publications" ADD CONSTRAINT "manual_publications_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_publications" ADD CONSTRAINT "manual_publications_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_scan_run_id_fkey" FOREIGN KEY ("scan_run_id") REFERENCES "scan_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
