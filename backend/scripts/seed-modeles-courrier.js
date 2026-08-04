/**
 * Insere les modeles de courrier par defaut, un par type_courrier prevu au
 * cahier des charges (Module 6). Idempotent : ignore les types deja
 * presents pour le tenant, donc peut etre relance sans risque de doublon.
 * Usage : node scripts/seed-modeles-courrier.js
 */
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MODELES = [
  {
    type_courrier: "DEMANDE_CLARIFICATION",
    titre: "Demande de clarification - {{dossier.reference}}",
    declencheur_evenement:
      "A envoyer des qu'une clause du DAO parait ambigue, ou en approche de la date limite de soumission.",
    corps_template: `Objet : Demande de clarification — {{dossier.reference}}

Monsieur le Directeur,

Dans le cadre de l'examen du dossier d'appel d'offres {{dossier.reference}} — {{dossier.intitule}}, publie par {{dossier.maitre_ouvrage}}, nous souhaitons obtenir des precisions sur le point suivant :

{{point_a_clarifier}}

Nous vous serions reconnaissants de bien vouloir nous apporter les eclaircissements necessaires dans les meilleurs delais, compte tenu de la date limite de depot des offres fixee au {{dossier.date_limite_soumission}}.

Nous vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
  {
    type_courrier: "DEMANDE_FINANCEMENT",
    titre: "Demande de financement - {{dossier.reference}}",
    declencheur_evenement:
      "A envoyer une fois l'option de financement retenue via le comparateur (Module 2), avant la date limite de soumission.",
    corps_template: `Objet : Demande de financement — {{dossier.reference}}

Monsieur le Directeur,

Nous avons l'honneur de solliciter aupres de votre etablissement une facilite de financement dans le cadre du marche suivant :

Reference du marche : {{dossier.reference}}
Intitule : {{dossier.intitule}}
Maitre d'ouvrage : {{dossier.maitre_ouvrage}}
Montant du marche : {{dossier.montant_estime}} {{dossier.devise}}

Nature du concours sollicite : {{type_facilite}}
Montant demande : {{montant_demande}} {{dossier.devise}}
Duree souhaitee : {{duree_jours}} jours

Ce financement nous permettra de faire face aux besoins de tresorerie lies a l'execution de ce marche, notamment {{objet_financement}}.

Nous restons a votre disposition pour vous communiquer tout document complementaire utile a l'instruction de ce dossier, et vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
  {
    type_courrier: "DEMANDE_GARANTIE",
    titre: "Demande de garantie bancaire - {{dossier.reference}}",
    declencheur_evenement: "A envoyer des que le montant et le type de garantie exiges par le DAO sont connus.",
    corps_template: `Objet : Demande de garantie bancaire — {{dossier.reference}}

Monsieur le Directeur,

Nous sollicitons l'emission d'une garantie bancaire dans le cadre du marche suivant :

Reference du marche : {{dossier.reference}}
Intitule : {{dossier.intitule}}
Maitre d'ouvrage : {{dossier.maitre_ouvrage}}

Type de garantie : {{type_garantie}}
Montant de la garantie : {{montant_garantie}} {{dossier.devise}}
Duree de validite souhaitee : {{duree_validite_jours}} jours

Nous vous remercions de bien vouloir traiter cette demande dans les meilleurs delais compte tenu des echeances du dossier, et vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
  {
    type_courrier: "DEMANDE_MAINLEVEE",
    titre: "Demande de mainlevee de garantie - {{dossier.reference}}",
    declencheur_evenement:
      "A envoyer une fois les obligations couvertes par la garantie remplies (reception des travaux, fin de periode de garantie...).",
    corps_template: `Objet : Demande de mainlevee de garantie — {{dossier.reference}}

Monsieur le Directeur,

Les obligations couvertes par la garantie ci-dessous ayant ete pleinement executees, nous sollicitons sa mainlevee :

Reference du marche : {{dossier.reference}}
Intitule : {{dossier.intitule}}
Maitre d'ouvrage : {{dossier.maitre_ouvrage}}

Type de garantie concernee : {{type_garantie}}
Reference de la garantie : {{reference_garantie}}

Nous vous prions de bien vouloir donner mainlevee de cette garantie aupres de notre etablissement bancaire, et vous remercions par avance de votre diligence.

Nous vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
  {
    type_courrier: "DEMANDE_PROROGATION",
    titre: "Demande de prorogation de delai - {{dossier.reference}}",
    declencheur_evenement: "Tache en retard sur le chronogramme, ou risque de depassement identifie.",
    corps_template: `Objet : Demande de prorogation de delai — {{dossier.reference}}

Monsieur le Directeur,

Concernant le marche {{dossier.reference}} — {{dossier.intitule}}, notifie par {{dossier.maitre_ouvrage}}, nous sollicitons une prorogation de delai de {{delai_demande_jours}} jours.

Cette demande est motivee par : {{motif_prorogation}}.

Nous vous prions de bien vouloir accueillir favorablement cette demande, et restons a votre disposition pour tout complement d'information.

Nous vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
  {
    type_courrier: "RESERVE_ORDRE_SERVICE",
    titre: "Reserve sur ordre de service - {{dossier.reference}}",
    declencheur_evenement: "A la reception d'un ordre de service dont les conditions d'execution posent difficulte.",
    corps_template: `Objet : Reserve sur ordre de service n° {{numero_os}} — {{dossier.reference}}

Monsieur le Directeur,

Nous accusons reception de l'ordre de service n° {{numero_os}} relatif au marche {{dossier.reference}} — {{dossier.intitule}}.

Nous portons a votre connaissance les reserves suivantes quant a son execution :

{{motif_reserve}}

Ces reserves sont formulees a titre conservatoire, sans prejudice de nos droits, et nous restons disposes a en discuter avec vos services.

Nous vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
  {
    type_courrier: "RELANCE_PAIEMENT",
    titre: "Relance de paiement - {{dossier.reference}}",
    declencheur_evenement: "A la date d'echeance depassee d'une facture liee au dossier, sans reglement recu.",
    corps_template: `Objet : Relance de paiement — Facture n° {{numero_facture}} — {{dossier.reference}}

Monsieur le Directeur,

Sauf erreur ou omission de notre part, nous constatons que la facture n° {{numero_facture}} d'un montant de {{montant_du}} {{dossier.devise}}, relative au marche {{dossier.reference}} — {{dossier.intitule}}, echue le {{date_echeance}}, demeure impayee a ce jour.

Nous vous serions obliges de bien vouloir proceder au reglement de cette somme dans les meilleurs delais, ou a defaut nous communiquer les raisons de ce retard.

Nous vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
  {
    type_courrier: "RECOURS_GRACIEUX",
    titre: "Recours gracieux - {{dossier.reference}}",
    declencheur_evenement: "A la notification d'une decision contestee (non-attribution, penalite...), avant tout recours contentieux.",
    corps_template: `Objet : Recours gracieux — {{dossier.reference}}

Monsieur le Directeur,

Nous avons pris connaissance de la decision suivante relative au marche {{dossier.reference}} — {{dossier.intitule}} :

{{decision_contestee}}

Nous sollicitons par la presente le reexamen de cette decision, pour les motifs suivants :

{{motif_recours}}

Nous restons a votre disposition pour tout echange permettant de clarifier notre position, et vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
  {
    type_courrier: "RECOURS_CONTENTIEUX",
    titre: "Recours contentieux - {{dossier.reference}}",
    declencheur_evenement: "Suite a l'echec ou l'absence de reponse a un recours gracieux, dans les delais legaux.",
    corps_template: `Objet : Recours contentieux — {{dossier.reference}}

Monsieur le Directeur,

Faisant suite a notre recours gracieux reste sans reponse satisfaisante, concernant la decision suivante relative au marche {{dossier.reference}} — {{dossier.intitule}} :

{{decision_contestee}}

nous portons ce differend devant {{juridiction_saisie}}, pour les motifs suivants :

{{motif_recours}}

La presente notification est adressee a titre conservatoire, sans prejudice de nos droits.

Nous vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
  {
    type_courrier: "NOTIFICATION_SOUS_TRAITANCE",
    titre: "Notification de sous-traitance - {{dossier.reference}}",
    declencheur_evenement: "Avant le demarrage effectif des prestations confiees a un sous-traitant.",
    corps_template: `Objet : Notification de sous-traitance — {{dossier.reference}}

Monsieur le Directeur,

Conformement aux clauses du marche {{dossier.reference}} — {{dossier.intitule}}, nous vous notifions le recours a la sous-traitance dans les conditions suivantes :

Sous-traitant : {{nom_sous_traitant}}
Nature des prestations sous-traitees : {{nature_prestations}}
Part du marche concernee : {{part_marche_sous_traite_pct}} %

Nous restons a votre disposition pour vous communiquer tout document complementaire relatif a ce sous-traitant.

Nous vous prions d'agreer, Monsieur le Directeur, l'expression de notre consideration distinguee.

Fait a Dakar, le {{date_jour}}.`,
  },
];

async function main() {
  const client = await pool.connect();
  try {
    const tenantRes = await client.query(`SELECT id FROM tenant ORDER BY date_creation ASC LIMIT 1`);
    if (tenantRes.rows.length === 0) {
      console.error("Aucun tenant trouve. Executez d'abord npm run seed.");
      process.exit(1);
    }
    const tenantId = tenantRes.rows[0].id;

    for (const modele of MODELES) {
      const existant = await client.query(
        `SELECT id FROM modele_courrier WHERE tenant_id = $1 AND type_courrier = $2`,
        [tenantId, modele.type_courrier]
      );
      if (existant.rows.length > 0) {
        console.log(`--> ${modele.type_courrier} deja present, ignore.`);
        continue;
      }
      await client.query(
        `INSERT INTO modele_courrier (tenant_id, type_courrier, titre, corps_template, declencheur_evenement)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, modele.type_courrier, modele.titre, modele.corps_template, modele.declencheur_evenement]
      );
      console.log(`    OK (${modele.type_courrier})`);
    }

    console.log("Modeles de courrier par defaut : termine.");
  } catch (err) {
    console.error("Erreur :", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
