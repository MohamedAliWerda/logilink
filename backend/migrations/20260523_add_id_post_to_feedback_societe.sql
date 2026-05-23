-- Add id_post column to feedback_societe so each feedback row is tied to
-- a specific job offer (post.id_line). This lets us tell, per post, whether
-- the société has already submitted feedback for it.

ALTER TABLE feedback_societe
  ADD COLUMN IF NOT EXISTS id_post BIGINT;

-- Foreign key to post.id_line. If a post is deleted we keep the feedback
-- row but null the link.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feedback_societe_id_post_fkey'
  ) THEN
    ALTER TABLE feedback_societe
      ADD CONSTRAINT feedback_societe_id_post_fkey
      FOREIGN KEY (id_post) REFERENCES post(id_line) ON DELETE SET NULL;
  END IF;
END$$;

-- Speed up the lookup we do on every feedback page load.
CREATE INDEX IF NOT EXISTS idx_feedback_societe_id_post ON feedback_societe(id_post);
CREATE INDEX IF NOT EXISTS idx_feedback_societe_id_soc_post ON feedback_societe(id_soc, id_post);
