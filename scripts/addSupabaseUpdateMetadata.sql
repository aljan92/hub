BEGIN;

ALTER TABLE public.mba_designs
  ADD COLUMN IF NOT EXISTS mba_hub_updated_at TIMESTAMPTZ;

ALTER TABLE public.mba_designs
  ADD COLUMN IF NOT EXISTS skip_update BOOLEAN;

UPDATE public.mba_designs
SET skip_update = FALSE
WHERE skip_update IS NULL;

ALTER TABLE public.mba_designs
  ALTER COLUMN skip_update SET DEFAULT FALSE,
  ALTER COLUMN skip_update SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mba_designs_hub_never_updated
  ON public.mba_designs (created_date ASC)
  WHERE status = 'PUBLISHED'
    AND skip_update = FALSE
    AND mba_hub_updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mba_designs_hub_previously_updated
  ON public.mba_designs (mba_hub_updated_at ASC)
  WHERE status = 'PUBLISHED'
    AND skip_update = FALSE
    AND mba_hub_updated_at IS NOT NULL;

COMMENT ON COLUMN public.mba_designs.mba_hub_updated_at IS
  'Zeitpunkt des letzten von MBA Hub bestätigten erfolgreichen Update-Uploads.';

COMMENT ON COLUMN public.mba_designs.skip_update IS
  'Schließt das Design bei TRUE aus der automatischen MBA-Hub-Updateauswahl aus.';

COMMIT;
