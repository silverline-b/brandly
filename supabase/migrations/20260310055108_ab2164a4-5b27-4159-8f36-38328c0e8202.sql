
-- Create run_candidates table for intermediate pipeline data
CREATE TABLE public.run_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.runs(id) ON DELETE CASCADE NOT NULL,
  stage TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.run_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.run_candidates FOR ALL USING (false);

-- Create index for efficient lookups
CREATE INDEX idx_run_candidates_run_stage ON public.run_candidates(run_id, stage, created_at DESC);

-- Drop large JSONB columns from runs table
ALTER TABLE public.runs DROP COLUMN IF EXISTS candidate_names;
ALTER TABLE public.runs DROP COLUMN IF EXISTS candidates_with_uspto;
ALTER TABLE public.runs DROP COLUMN IF EXISTS candidates_with_domains;
ALTER TABLE public.runs DROP COLUMN IF EXISTS candidates_with_web;
ALTER TABLE public.runs DROP COLUMN IF EXISTS candidates_scored;

-- Reset the stuck run
UPDATE public.runs SET status = 'failed', current_step = 'Reset after architecture migration. Please start a new run.' WHERE id = '16e357ab-c852-406e-a2c7-1d4859facb60';
