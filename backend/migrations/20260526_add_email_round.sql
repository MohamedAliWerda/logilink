-- ─────────────────────────────────────────────────────────────────────────────
-- Add email_round tracking to all three feedback-related tables.
--
-- Logic:
--   • post.email_round        : incremented by the scheduler each time it sends
--                               a renewal email (starts at 1).
--   • feedback_societe.email_round : tags every submitted feedback with the
--                               cycle it was submitted in.
--   • feedback_declined.email_round: tags every "Non, pas cette fois" response
--                               with the cycle it was given in.
--
-- When getFeedbackEligiblePosts checks whether a post is "already done", it only
-- counts rows whose email_round >= the post's current email_round.
-- This means old round-1 rows do NOT block a new round-2 feedback window.
-- No rows are ever deleted — full history is preserved across all rounds.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. post: track the current feedback cycle number
ALTER TABLE post ADD COLUMN IF NOT EXISTS email_round INTEGER DEFAULT 1;

-- 2. feedback_societe: tag each submitted feedback with its round
ALTER TABLE feedback_societe ADD COLUMN IF NOT EXISTS email_round INTEGER DEFAULT 1;

-- 3. feedback_declined: tag each decline with its round
--    We need to expand the primary key from (id_soc, id_post) to
--    (id_soc, id_post, email_round) so that a company can decline once per
--    round without violating the constraint.
ALTER TABLE feedback_declined ADD COLUMN IF NOT EXISTS email_round INTEGER NOT NULL DEFAULT 1;

-- Drop the old two-column primary key and replace with three-column key.
-- The DO block guards against re-running on a DB that already has the new PK.
DO $$
BEGIN
  -- Only touch the PK if email_round is not already part of it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.key_column_usage
    WHERE table_name = 'feedback_declined'
      AND constraint_name = 'feedback_declined_pkey'
      AND column_name = 'email_round'
  ) THEN
    ALTER TABLE feedback_declined DROP CONSTRAINT IF EXISTS feedback_declined_pkey;
    ALTER TABLE feedback_declined ADD PRIMARY KEY (id_soc, id_post, email_round);
  END IF;
END$$;
