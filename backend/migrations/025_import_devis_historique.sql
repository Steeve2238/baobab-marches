-- Import de devis historiques via Excel (chantier du 30/09/2026 avec
-- Steeve) : le client de Baobab veut recharger dans la plateforme les
-- devis qu'il avait deja etablis avant d'utiliser Baobab Marches (environ
-- 300). Decisions actees avec Steeve (voir
-- claude/complement_30092026_devis_modifiable_apres_validation.md,
-- section 2) :
--   - Resume global uniquement par devis (montant total), pas de detail
--     ligne par ligne - un devis importe recoit tout de meme UNE ligne
--     devis_ligne recapitulative (montant global) pour rester coherent
--     avec l'invariant "un devis a toujours au moins une ligne" utilise
--     partout ailleurs (edition, impression) - voir POST /devis/importer.
--   - Statut renseigne par le client dans une colonne du fichier Excel,
--     mappe de facon tolerante vers les statuts normalises (une valeur non
--     reconnue ou vide est importee en BROUILLON, jamais de blocage -
--     meme principe que l'import de fiches de temps RH, voir routes/rh.js).
--   - Devis seulement dans cette phase, pas de factures/BL associes.
--   - Un numero de devis d'origine deja utilise (doublon, deja identifie
--     comme un risque reel dans les anciens fichiers Excel du client lors
--     du cadrage du 04/09/2026) est signale dans un rapport d'erreurs et
--     sa ligne est ignoree, SANS bloquer le reste du fichier.
--   - Le numero d'origine du client est conserve tel quel dans
--     devis.numero (ex "299") - aucune collision possible avec le format
--     genere pour les nouveaux devis (DEV-AAAA-MM-NNNN), donc aucun
--     changement necessaire au compteur de numerotation
--     (compteur_numerotation) : les deux coexistent sans interference.
ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS importe BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes_import TEXT;
