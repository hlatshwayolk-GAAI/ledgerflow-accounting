-- Create Bills
CREATE TABLE public.bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  bill_number TEXT NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  status public.invoice_status NOT NULL DEFAULT 'draft',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, bill_number)
);

-- Create Bill Lines
CREATE TABLE public.bill_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity NUMERIC(14,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 15,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0
);

-- Create Bank Accounts
CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  account_number TEXT,
  bank_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, account_id)
);

-- Create Bank Transactions
CREATE TABLE public.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  reference TEXT,
  amount NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'unreconciled' CHECK (status IN ('unreconciled', 'reconciled')),
  reconciled_to_type TEXT CHECK (reconciled_to_type IN ('invoice', 'bill', 'direct')),
  reconciled_to_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add updated_at trigger for bills
CREATE TRIGGER trg_bills_updated BEFORE UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS Enablement
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Members all bills" ON public.bills FOR ALL TO authenticated
  USING (public.is_company_member(company_id, auth.uid()))
  WITH CHECK (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "Members all bill_lines" ON public.bill_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bills b WHERE b.id = bill_lines.bill_id AND public.is_company_member(b.company_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bills b WHERE b.id = bill_lines.bill_id AND public.is_company_member(b.company_id, auth.uid())));

CREATE POLICY "Members all bank_accounts" ON public.bank_accounts FOR ALL TO authenticated
  USING (public.is_company_member(company_id, auth.uid()))
  WITH CHECK (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "Members all bank_transactions" ON public.bank_transactions FOR ALL TO authenticated
  USING (public.is_company_member(company_id, auth.uid()))
  WITH CHECK (public.is_company_member(company_id, auth.uid()));

-- Stored Procedure: create_bill_with_journal
CREATE OR REPLACE FUNCTION public.create_bill_with_journal(
  _company_id UUID,
  _supplier_id UUID,
  _bill_number TEXT,
  _issue_date DATE,
  _due_date DATE,
  _notes TEXT,
  _lines JSONB  -- [{description, quantity, unit_price, tax_rate, account_id}]
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _bill_id UUID;
  _journal_id UUID;
  _subtotal NUMERIC(14,2) := 0;
  _tax_total NUMERIC(14,2) := 0;
  _total NUMERIC(14,2) := 0;
  _ap_id UUID; _vat_id UUID;
  _line JSONB;
  _line_total NUMERIC(14,2);
  _line_tax NUMERIC(14,2);
  _pos INT := 0;
  _line_account_id UUID;
BEGIN
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this company';
  END IF;

  -- Find default accounts
  SELECT id INTO _ap_id  FROM public.accounts WHERE company_id = _company_id AND code = '2000' LIMIT 1;
  SELECT id INTO _vat_id FROM public.accounts WHERE company_id = _company_id AND code = '2100' LIMIT 1;
  IF _ap_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable account (2000) missing for company';
  END IF;

  INSERT INTO public.bills (company_id, supplier_id, bill_number, issue_date, due_date, notes, status, subtotal, tax_total, total)
  VALUES (_company_id, _supplier_id, _bill_number, _issue_date, _due_date, _notes, 'sent', 0, 0, 0)
  RETURNING id INTO _bill_id;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _line_total := ROUND((COALESCE((_line->>'quantity')::NUMERIC,1) * COALESCE((_line->>'unit_price')::NUMERIC,0))::NUMERIC, 2);
    _line_tax := ROUND((_line_total * COALESCE((_line->>'tax_rate')::NUMERIC,0) / 100)::NUMERIC, 2);
    _line_account_id := (_line->>'account_id')::UUID;

    INSERT INTO public.bill_lines (bill_id, account_id, description, quantity, unit_price, tax_rate, line_total, position)
    VALUES (_bill_id,
            _line_account_id,
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

  UPDATE public.bills SET subtotal = _subtotal, tax_total = _tax_total, total = _total WHERE id = _bill_id;

  -- Post journal
  INSERT INTO public.journals (company_id, entry_date, description, source_type, source_id, created_by)
  VALUES (_company_id, _issue_date, 'Supplier Bill ' || _bill_number, 'bill', _bill_id, auth.uid())
  RETURNING id INTO _journal_id;

  -- Debit Expenses, Debit VAT, Credit AP
  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _line_total := ROUND((COALESCE((_line->>'quantity')::NUMERIC,1) * COALESCE((_line->>'unit_price')::NUMERIC,0))::NUMERIC, 2);
    _line_account_id := (_line->>'account_id')::UUID;
    INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
    VALUES (_journal_id, _line_account_id, _line_total, 0);
  END LOOP;

  IF _tax_total > 0 AND _vat_id IS NOT NULL THEN
    INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
    VALUES (_journal_id, _vat_id, _tax_total, 0);
  END IF;

  INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
  VALUES (_journal_id, _ap_id, 0, _total);

  RETURN _bill_id;
END; $$;

-- Stored Procedure: record_bill_payment
CREATE OR REPLACE FUNCTION public.record_bill_payment(
  _bill_id UUID,
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
  _ap_id UUID; _bank_id UUID;
  _journal_id UUID;
  _new_status TEXT;
  _number TEXT;
BEGIN
  SELECT company_id, total, amount_paid, bill_number
    INTO _company_id, _total, _paid, _number
    FROM public.bills WHERE id = _bill_id;
  IF _company_id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  _new_paid := _paid + _amount;
  IF _new_paid > _total + 0.01 THEN RAISE EXCEPTION 'Payment exceeds bill total'; END IF;

  SELECT id INTO _ap_id   FROM public.accounts WHERE company_id = _company_id AND code = '2000' LIMIT 1;
  SELECT id INTO _bank_id FROM public.accounts WHERE company_id = _company_id AND code = _bank_account_code LIMIT 1;
  IF _ap_id IS NULL OR _bank_id IS NULL THEN
    RAISE EXCEPTION 'Missing default accounts (AP / Bank %)', _bank_account_code;
  END IF;

  INSERT INTO public.journals (company_id, entry_date, description, source_type, source_id, created_by)
  VALUES (_company_id, _payment_date,
          'Payment for Bill ' || _number || COALESCE(' — ' || NULLIF(_notes,''), ''),
          'bill_payment', _bill_id, auth.uid())
  RETURNING id INTO _journal_id;

  INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
  VALUES (_journal_id, _ap_id, _amount, 0);
  INSERT INTO public.journal_lines (journal_id, account_id, debit, credit)
  VALUES (_journal_id, _bank_id, 0, _amount);

  IF _new_paid >= _total - 0.01 THEN _new_status := 'paid';
  ELSE _new_status := 'partially_paid'; END IF;

  UPDATE public.bills
    SET amount_paid = _new_paid, status = _new_status::public.invoice_status, updated_at = now()
    WHERE id = _bill_id;

  RETURN _journal_id;
END $$;

-- Stored Procedure: delete_draft_bill
CREATE OR REPLACE FUNCTION public.delete_draft_bill(_bill_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company_id UUID; _status TEXT;
BEGIN
  SELECT company_id, status INTO _company_id, _status FROM public.bills WHERE id = _bill_id;
  IF _company_id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _status <> 'draft' AND _status <> 'sent' THEN
    RAISE EXCEPTION 'Only draft/unpaid bills can be deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bills WHERE id = _bill_id AND amount_paid > 0) THEN
    RAISE EXCEPTION 'Cannot delete a bill with payments';
  END IF;

  DELETE FROM public.journal_lines WHERE journal_id IN
    (SELECT id FROM public.journals WHERE source_type = 'bill' AND source_id = _bill_id);
  DELETE FROM public.journals WHERE source_type = 'bill' AND source_id = _bill_id;
  DELETE FROM public.bill_lines WHERE bill_id = _bill_id;
  DELETE FROM public.bills WHERE id = _bill_id;
END $$;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bills, public.bill_lines, public.bank_accounts, public.bank_transactions TO authenticated;
GRANT ALL ON public.bills, public.bill_lines, public.bank_accounts, public.bank_transactions TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_bill_with_journal(UUID, UUID, TEXT, DATE, DATE, TEXT, JSONB) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_bill_payment(UUID, NUMERIC, DATE, TEXT, TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.delete_draft_bill(UUID) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.create_bill_with_journal(UUID, UUID, TEXT, DATE, DATE, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_bill_payment(UUID, NUMERIC, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_draft_bill(UUID) TO authenticated;
