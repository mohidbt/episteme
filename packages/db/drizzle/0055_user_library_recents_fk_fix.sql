-- GSD-96 R3 followup — ensure the FK on user_library_recents.user_id lands
-- in prod. The 0054 DO block silently NULL'd on duplicate_object but the
-- FK was never created (predeploy assertion ok=false). Re-apply as a
-- standalone idempotent ALTER under owner-real so we get explicit errors
-- on any failure.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'user_library_recents'
      AND constraint_name = 'user_library_recents_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "user_library_recents"
      ADD CONSTRAINT "user_library_recents_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
