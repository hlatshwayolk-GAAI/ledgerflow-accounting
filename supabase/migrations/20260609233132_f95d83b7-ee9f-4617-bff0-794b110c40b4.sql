DELETE FROM public.companies WHERE name='debug_co';

DROP POLICY IF EXISTS "Members view companies" ON public.companies;
CREATE POLICY "Members or owners view companies"
  ON public.companies FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid() OR public.is_company_member(id, auth.uid()));