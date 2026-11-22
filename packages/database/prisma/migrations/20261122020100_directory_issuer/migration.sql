-- Directory routines must count only administrators who can authenticate with this issuer.
ALTER POLICY directory_memberships ON public.organization_memberships
USING (
    organization_id = vetx_directory.organization_id()
    AND EXISTS (
        SELECT 1 FROM public.users AS account
        WHERE account.id = organization_memberships.user_id
          AND account.identity_issuer = NULLIF(current_setting('vetx.identity_issuer', true), '')
    )
);
