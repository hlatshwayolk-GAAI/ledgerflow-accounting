
REVOKE EXECUTE ON FUNCTION public.record_invoice_payment(UUID,NUMERIC,DATE,TEXT,TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.delete_draft_invoice(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.create_invoice_with_journal(UUID,UUID,TEXT,DATE,DATE,TEXT,JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(UUID,NUMERIC,DATE,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_draft_invoice(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_with_journal(UUID,UUID,TEXT,DATE,DATE,TEXT,JSONB) TO authenticated;
