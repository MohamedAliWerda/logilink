-- Migration: add competence_name to ai_confirmed_recommendations
-- This column is required so the backend can match each approved recommendation
-- back to the student's cv_matching_competence_results row for per-student level
-- assignment (Critique / Moyenne / Faible) without relying on fuzzy gap_title parsing.

ALTER TABLE ai_confirmed_recommendations
  ADD COLUMN IF NOT EXISTS competence_name TEXT;

-- Backfill existing rows from gap_title by stripping the leading "[TYPE] " prefix.
-- Example: "[1. CONDUIRE] Préparer et vérifier le matériel médical avant mission"
--       => "Préparer et vérifier le matériel médical avant mission"
UPDATE ai_confirmed_recommendations
SET    competence_name = regexp_replace(gap_title, '^\[[^\]]*\]\s*', '', '')
WHERE  competence_name IS NULL
  AND  gap_title IS NOT NULL
  AND  gap_title <> 'N/A';
