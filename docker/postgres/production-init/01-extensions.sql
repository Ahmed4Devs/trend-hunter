-- ---------------------------------------------------------------------------
-- Production database initialisation.
--
-- Runs once, as the superuser, when the data directory is first created.
--
-- Two things happen here that the application must never be able to do itself:
--
--  1. the extensions are created, because the application role is not a
--     superuser and CREATE EXTENSION is a superuser operation. The migrations
--     still contain `CREATE EXTENSION IF NOT EXISTS`, which is a harmless no-op
--     once these exist;
--  2. a dedicated, unprivileged application role is created and granted exactly
--     the rights it needs on the public schema — nothing more.
--
-- APP_DB_USER / APP_DB_PASSWORD are passed in by docker-compose.production.yml.
-- ---------------------------------------------------------------------------

\set app_user   `echo "$APP_DB_USER"`
\set app_pass   `echo "$APP_DB_PASSWORD"`

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
DECLARE
  app_user text := current_setting('trendhunter.app_user', true);
BEGIN
  IF app_user IS NULL OR app_user = '' THEN
    RAISE NOTICE 'TrendHunter: APP_DB_USER not provided, skipping role creation';
  END IF;
END
$$;

-- Create the application role if it does not already exist.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

-- Least privilege: the role may use and create objects in `public` (Prisma
-- migrations create tables) but is not a superuser and cannot create databases,
-- roles or extensions.
GRANT CONNECT ON DATABASE :"POSTGRES_DB" TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";

DO $$
BEGIN
  RAISE NOTICE 'TrendHunter production database initialised on %', version();
END
$$;
