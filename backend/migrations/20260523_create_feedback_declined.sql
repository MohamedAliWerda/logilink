-- Track when a société declines to give feedback (answered "Non, pas cette fois"
-- to the recruitment question). Kept in its own table so feedback_societe stays
-- clean for statistics — no empty rows from declined entries.

CREATE TABLE IF NOT EXISTS feedback_declined (
  id_soc BIGINT NOT NULL,
  id_post BIGINT NOT NULL,
  date_declined TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (id_soc, id_post)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_declined_id_post_fkey') THEN
    ALTER TABLE feedback_declined
      ADD CONSTRAINT feedback_declined_id_post_fkey
      FOREIGN KEY (id_post) REFERENCES post(id_line) ON DELETE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_feedback_declined_id_soc ON feedback_declined(id_soc);
