
CREATE OR REPLACE FUNCTION public.create_invoice_with_journal(
  _company_id UUID,
  _customer_id UUID,
  _invoice_number TEXT,
  _issue_date DATE,
  _due_date DATE,
  _notes TEXT,
  _lines JSONB  -- [{description, quantity, unit_price, tax_rate}]
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _invoice_id UUID;
  _journal_id UUID;
  _subtotal NUMERIC(14,2) := 0;
  _tax_total NUMERIC(14,2) := 0;
  _total NUMERIC(14,2) := 0;
  _ar_id UUID; _vat_id UUID; _rev_id UUID;
  _line JSONB;
  _line_total NUMERIC(14,2);
  _line_tax NUMERIC(14,2);
  _pos INT := 0;
BEGIN
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this company';
  END IF;

  -- Find required default accounts
  SELECT id INTO _ar_id  FROM public.accounts WHERE company_id = _company_id AND code = '1100' LIMIT 1;
  SELECT id INTO _vat_id FROM public.accounts WHERE company_id = _company_id AND code = '2100' LIMIT 1;
  SELECT id INTO _rev_id FROM public.accounts WHERE company_id = _company_id AND code = '4000' LIMIT 1;
  IF _ar_id IS NULL OR _rev_id IS NULL THEN
    RAISE EXCEPTION 'Default accounts (AR / Revenue) missing for company';
  END IF;

  INSERT INTO public.invoices (company_id, customer_id, invoice_number, issue_date, due_date, notes, status, subtotal, tax_total, total)
  VALUES (_company_id, _customer_id, _invoice_number, _issue_date, _due_date, _notes, 'sent', 0, 0, 0)
  RETURNING id INTO _invoice_id;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _line_total := ROUND((COALESCE((_line->>'quantity')::NUMERIC,1) * COALESCE((_line->>'unit_price')::NUMERIC,0))::NUMERIC, 2);
    _line_tax := ROUND((_line_total * COALESCE((_line->>'tax_rate')::NUMERIC,0) / 100)::NUMERIC, 2);
    INSERT INTO public.invoice_lines (invoice_id, description, quantity, unit_price, tax_rate, line_total, position)
    VALUES (_invoice_id,
            COALESCE(_line->>'description',''),
            COALESCE((_line->>'quantity')::NUMERIC,1),
            COALESCE((_line->>'unit_price')::NUMERIC,0),
            COALESCE((_line->>'tax_rate')::NUMERIC,0),
            _line_total,
            _pos);
    _subtotal := _subtotal + _line_total;
    _tax_total := _tax_total + _line_tax;
    _pos := _pos + 1;
  END LOOP;

  _total := _subtotal + _tax_total;

  UPDATE public.invoices SET subtotal = _subtotal, tax_total = _tax_total, total = _total WHERE id = _invoice_id;

  -- Post journal
  INSERT INTO public.journals (company_id, entry_date, description, source_type, source_id, created_by)
  VALUES (_company_id, _issue_date, 'Invoice ' || _invoice_number, 'invoice', _invoice_id, auth.uid())
  RETURNING id INTO _journal_id;

  -- Debit AR, Credit Revenue + VAT
  INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
  VALUES (_journal_id, _ar_id, _total, 0);
  INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
  VALUES (_journal_id, _rev_id, 0, _subtotal);
  IF _tax_total > 0 AND _vat_id IS NOT NULL THEN
    INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
    VALUES (_journal_id, _vat_id, 0, _tax_total);
  END IF;

  RETURN _invoice_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_invoice_with_journal(UUID, UUID, TEXT, DATE, DATE, TEXT, JSONB) TO authenticated;
