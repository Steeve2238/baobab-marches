-- Pack « Modules seuls » (29/10/2026) : client qui n'achete que des modules transverses (Comptabilite, Fiscalite,
-- RH, Paie) sans les fonctions commerce (appels d'offres, ventes, achats, stock, financement).
-- tenant.profil_activite accepte desormais MODULES en plus de MARCHES, NEGOCE et LES_DEUX (defaut inchange).
-- Aucune donnee existante n'est modifiee.
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS chk_tenant_profil_activite;
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_profil_activite CHECK (profil_activite IN ('MARCHES', 'NEGOCE', 'LES_DEUX', 'MODULES'));
