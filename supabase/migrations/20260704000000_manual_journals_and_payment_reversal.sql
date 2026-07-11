-- ═══════════════════════════════════════════════════════════════
-- LedgerFlow: New RPCs Migration
-- Run this in your Supabase dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────
-- 1. create_manual_journal
--    Posts a balanced manual journal entry with multiple lines.
--    Validates that total debits == total credits.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_manual_journal(
  _company_id UUID,
  _entry_date DATE,
  _description TEXT,
  _reference TEXT DEFAULT NULL,
  _lines JSONB  -- [{account_id, debit, credit, description}]
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _journal_id UUID;
  _line JSONB;
  _total_debit NUMERIC(14,2) := 0;
  _total_credit NUMERIC(14,2) := 0;
  _account_id UUID;
  _debit NUMERIC(14,2);
  _credit NUMERIC(14,2);
BEGIN
  -- Authorization check
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this company';
  END IF;

  -- Validate all accounts belong to this company and sum debits/credits
  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _account_id := (_line->>'account_id')::UUID;
    _debit  := COALESCE((_line->>'debit')::NUMERIC, 0);
    _credit := COALESCE((_line->>'credit')::NUMERIC, 0);

    IF NOT EXISTS (
      SELECT 1 FROM public.accounts
      WHERE id = _account_id AND company_id = _company_id
    ) THEN
      RAISE EXCEPTION 'Account % does not belong to this company', _account_id;
    END IF;

    _total_debit  := _total_debit  + _debit;
    _total_credit := _total_credit + _credit;
  END LOOP;

  -- Enforce double-entry balance
  IF ABS(_total_debit - _total_credit) > 0.005 THEN
    RAISE EXCEPTION 'Journal is not balanced. Debits: %, Credits: %', _total_debit, _total_credit;
  END IF;

  IF _total_debit = 0 THEN
    RAISE EXCEPTION 'Journal entry must have at least one non-zero amount';
  END IF;

  -- Create the journal
  INSERT INTO public.journals (
    company_id, entry_date, description, reference, source_type, created_by
  ) VALUES (
    _company_id, _entry_date, _description, _reference, 'manual', auth.uid()
  )
  RETURNING id INTO _journal_id;

  -- Insert lines
  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _account_id := (_line->>'account_id')::UUID;
    _debit  := COALESCE((_line->>'debit')::NUMERIC, 0);
    _credit := COALESCE((_line->>'credit')::NUMERIC, 0);

    IF _debit > 0 OR _credit > 0 THEN
      INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
      VALUES (_journal_id, _account_id, _debit, _credit);
    END IF;
  END LOOP;

  RETURN _journal_id;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- 2. reverse_invoice_payment
--    Reverses the most recent payment journal for an invoice.
--    Deletes that journal + lines and reduces amount_paid.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id UUID;
  _total NUMERIC(14,2);
  _paid NUMERIC(14,2);
  _journal_id UUID;
  _journal_amount NUMERIC(14,2);
  _new_paid NUMERIC(14,2);
  _new_status TEXT;
BEGIN
  SELECT company_id, total, amount_paid
    INTO _company_id, _total, _paid
    FROM public.invoices WHERE id = _invoice_id;

  IF _company_id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _paid <= 0 THEN
    RAISE EXCEPTION 'No payment to reverse on this invoice';
  END IF;

  -- Find the most recent payment journal for this invoice
  SELECT id INTO _journal_id
    FROM public.journals
    WHERE source_type = 'invoice_payment'
      AND source_id = _invoice_id
    ORDER BY entry_date DESC, created_at DESC
    LIMIT 1;

  IF _journal_id IS NULL THEN
    RAISE EXCEPTION 'No payment journal found to reverse';
  END IF;

  -- Get the payment amount from that journal (sum of debits on bank line = payment amount)
  SELECT COALESCE(SUM(debit), 0) INTO _journal_amount
    FROM public.journal_lines
    WHERE journal_id = _journal_id AND debit > 0;

  -- Delete the payment journal
  DELETE FROM public.journal_lines WHERE journal_id = _journal_id;
  DELETE FROM public.journals WHERE id = _journal_id;

  -- Recalculate amount_paid
  _new_paid := GREATEST(0, _paid - _journal_amount);

  IF _new_paid >= _total - 0.01 THEN
    _new_status := 'paid';
  ELSIF _new_paid > 0 THEN
    _new_status := 'partially_paid';
  ELSE
    _new_status := 'sent';
  END IF;

  UPDATE public.invoices
    SET amount_paid = _new_paid,
        status = _new_status::public.invoice_status,
        updated_at = now()
    WHERE id = _invoice_id;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- 3. reverse_bill_payment
--    Reverses the most recent payment journal for a bill.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reverse_bill_payment(_bill_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id UUID;
  _total NUMERIC(14,2);
  _paid NUMERIC(14,2);
  _journal_id UUID;
  _journal_amount NUMERIC(14,2);
  _new_paid NUMERIC(14,2);
  _new_status TEXT;
BEGIN
  SELECT company_id, total, amount_paid
    INTO _company_id, _total, _paid
    FROM public.bills WHERE id = _bill_id;

  IF _company_id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _paid <= 0 THEN
    RAISE EXCEPTION 'No payment to reverse on this bill';
  END IF;

  -- Find the most recent payment journal
  SELECT id INTO _journal_id
    FROM public.journals
    WHERE source_type = 'bill_payment'
      AND source_id = _bill_id
    ORDER BY entry_date DESC, created_at DESC
    LIMIT 1;

  IF _journal_id IS NULL THEN
    RAISE EXCEPTION 'No payment journal found to reverse';
  END IF;

  -- Get payment amount (debit on AP account = payment going out)
  SELECT COALESCE(SUM(debit), 0) INTO _journal_amount
    FROM public.journal_lines
    WHERE journal_id = _journal_id AND debit > 0;

  -- Delete the payment journal
  DELETE FROM public.journal_lines WHERE journal_id = _journal_id;
  DELETE FROM public.journals WHERE id = _journal_id;

  -- Recalculate paid and status
  _new_paid := GREATEST(0, _paid - _journal_amount);

  IF _new_paid >= _total - 0.01 THEN
    _new_status := 'paid';
  ELSIF _new_paid > 0 THEN
    _new_status := 'partially_paid';
  ELSE
    _new_status := 'sent';
  END IF;

  UPDATE public.bills
    SET amount_paid = _new_paid,
        status = _new_status::public.invoice_status,
        updated_at = now()
    WHERE id = _bill_id;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- 4. Ensure journals table has reference column
--    (adds it if it doesn't already exist)
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'journals'
      AND column_name = 'reference'
  ) THEN
    ALTER TABLE public.journals ADD COLUMN reference TEXT;
  END IF;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- 5. Grant permissions
-- ──────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_manual_journal(UUID, DATE, TEXT, TEXT, JSONB) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reverse_invoice_payment(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reverse_bill_payment(UUID) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.create_manual_journal(UUID, DATE, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_bill_payment(UUID) TO authenticated;
