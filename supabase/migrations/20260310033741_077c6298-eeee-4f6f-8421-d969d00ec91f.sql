ALTER TABLE public.runs DROP CONSTRAINT runs_status_check;

ALTER TABLE public.runs ADD CONSTRAINT runs_status_check CHECK (
  status = ANY (ARRAY[
    'pending'::text,
    'classified'::text,
    'batch_ready'::text,
    'uspto_done'::text,
    'domains_done'::text,
    'web_done'::text,
    'scored'::text,
    'running'::text,
    'scoring'::text,
    'complete'::text,
    'partial_complete'::text,
    'failed'::text,
    'error'::text
  ])
);