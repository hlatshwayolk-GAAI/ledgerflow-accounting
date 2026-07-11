
-- Allow updating/deleting invoice lines on draft invoices (UI editing)
CREATE POLICY "Members manage invoice lines" ON public.invoice_lines
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_lines.invoice_id AND public.is_company_member(i.company_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_lines.invoice_id AND public.is_company_member(i.company_id, auth.uid())));

-- Bank account list helper: simple table to track which CoA account is "Bank"
-- For payments we just default to account code 1000.

-- RPC: record_invoice_payment — Dr Bank, Cr Accounts Receivable; updates amount_paid + status
CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  _invoice_id UUID,
  _amount NUMERIC,
  _payment_date DATE,
  _bank_account_code TEXT DEFAULT '1000',
  _notes TEXT DEFAULT ''
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _company_id UUID;
  _total NUMERIC(14,2);
  _paid NUMERIC(14,2);
  _new_paid NUMERIC(14,2);
  _ar_id UUID; _bank_id UUID;
  _journal_id UUID;
  _new_status TEXT;
  _number TEXT;
BEGIN
  SELECT company_id, total, amount_paid, invoice_number
    INTO _company_id, _total, _paid, _number
    FROM public.invoices WHERE id = _invoice_id;
  IF _company_id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  _new_paid := _paid + _amount;
  IF _new_paid > _total + 0.01 THEN RAISE EXCEPTION 'Payment exceeds invoice total'; END IF;

  SELECT id INTO _ar_id   FROM public.accounts WHERE company_id = _company_id AND code = '1100' LIMIT 1;
  SELECT id INTO _bank_id FROM public.accounts WHERE company_id = _company_id AND code = _bank_account_code LIMIT 1;
  IF _ar_id IS NULL OR _bank_id IS NULL THEN
    RAISE EXCEPTION 'Missing default accounts (AR / Bank %)', _bank_account_code;
  END IF;

  INSERT INTO public.journals (company_id, entry_date, description, source_type, source_id, created_by)
  VALUES (_company_id, _payment_date,
          'Payment for ' || _number || COALESCE(' — ' || NULLIF(_notes,''), ''),
          'invoice_payment', _invoice_id, auth.uid())
  RETURNING id INTO _journal_id;

  INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
  VALUES (_journal_id, _bank_id, _amount, 0);
  INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
  VALUES (_journal_id, _ar_id, 0, _amount);

  IF _new_paid >= _total - 0.01 THEN _new_status := 'paid';
  ELSE _new_status := 'partially_paid'; END IF;

  UPDATE public.invoices
    SET amount_paid = _new_paid, status = _new_status, updated_at = now()
    WHERE id = _invoice_id;

  RETURN _journal_id;
END $$;

-- RPC: delete a DRAFT invoice and its journal cleanly
CREATE OR REPLACE FUNCTION public.delete_draft_invoice(_invoice_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company_id UUID; _status TEXT;
BEGIN
  SELECT company_id, status INTO _company_id, _status FROM public.invoices WHERE id = _invoice_id;
  IF _company_id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _status <> 'draft' AND _status <> 'sent' THEN
    RAISE EXCEPTION 'Only draft/unpaid invoices can be deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoices WHERE id = _invoice_id AND amount_paid > 0) THEN
    RAISE EXCEPTION 'Cannot delete an invoice with payments';
  END IF;
  -- Remove journal first (lines cascade if FK has cascade; otherwise delete explicitly)
  DELETE FROM public.journal_lines WHERE journal_id IN
    (SELECT id FROM public.journals WHERE source_type = 'invoice' AND source_id = _invoice_id);
  DELETE FROM public.journals WHERE source_type = 'invoice' AND source_id = _invoice_id;
  DELETE FROM public.invoice_lines WHERE invoice_id = _invoice_id;
  DELETE FROM public.invoices WHERE id = _invoice_id;
END $$;
