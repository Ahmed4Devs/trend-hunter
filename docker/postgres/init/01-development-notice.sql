-- ---------------------------------------------------------------------------
-- Development database initialisation.
--
-- Deliberately does NOT create extensions. In development the application role
-- is the database superuser, so `prisma migrate dev` creates `vector` and
-- `pg_trgm` itself from the `extensions = [...]` declaration in schema.prisma.
-- Creating them here instead would make Prisma report schema drift on the very
-- first migration, because an empty migration history describes a database
-- with no extensions at all.
--
-- Production is the opposite case and does create them up front — see
-- docker/postgres/production-init/01-extensions.sql.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  RAISE NOTICE 'TrendHunter development database ready on %', version();
END
$$;
