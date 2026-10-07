/**
 * Modele de contrat de la plateforme Baobab Marches (version francaise).
 *
 * Deux variantes : HEBERGE (acces en ligne, abonnement) et LOCAL (licence d'utilisation d'une version installee chez le client).
 * Le texte est construit a partir du contexte (parties, formule, duree, penalite) puis FIGE dans contrat_client.contenu_json :
 * une modification ulterieure de ce modele ne change jamais un contrat deja emis.
 *
 * ATTENTION : texte redige comme base de travail ; il doit etre relu et valide par un avocat et un conseil en propriete
 * intellectuelle (notamment les articles 6, 7, 15 et 21) avant usage commercial.
 */

const fmtMois = (n) => `${n} mois`;

/**
 * @param {object} c { variante, editeur, client, formule, plafond, duree_mois, penalite_mois, juridiction, ville, annee }
 * @returns {Array<{numero:number, titre:string, paragraphes:string[]}>}
 */
function construireArticles(c) {
  const H = c.variante === "HEBERGE";
  const E = c.editeur || "l'Éditeur";
  const duree = fmtMois(c.duree_mois);
  const plafondTxt = c.plafond ? `${c.plafond} utilisateurs` : "un nombre illimité d'utilisateurs";
  const A = [];
  const add = (titre, paragraphes) => A.push({ numero: A.length + 1, titre, paragraphes: paragraphes.filter(Boolean) });

  add("Définitions", [
    "Dans le présent contrat, les termes ci-après ont le sens suivant :",
    "« Plateforme » : la solution logicielle « Baobab Marchés » de l'Éditeur, dans toutes ses versions, ses modules, ses mises à jour, sa documentation et ses interfaces ; « Modules » : les ensembles fonctionnels de la Plateforme (marchés et ventes, achats, finance, comptabilité, fiscalité, ressources humaines et autres) accordés au Client selon l'Annexe 1 ;",
    "« Utilisateur autorisé » : toute personne physique placée sous l'autorité du Client, désignée par lui et dotée d'identifiants personnels, dans la limite de la formule souscrite ; « Données du Client » : les données saisies, importées ou générées par le Client dans la Plateforme ;",
    "« Éléments protégés » : le code source et le code objet, l'architecture, la structure des bases de données, les algorithmes, moteurs et méthodes de calcul, les écrans et interfaces, les textes, modèles de documents, bases de paramètres, marques, logos, noms de domaine et la documentation de la Plateforme, ainsi que leurs évolutions ;",
    H ? "« Services » : l'accès en ligne à la Plateforme hébergée par l'Éditeur, la maintenance et le support décrits au présent contrat."
      : "« Clé de licence » : le fichier ou la série de caractères délivré par l'Éditeur, propre au Client, qui conditionne l'usage de la version installée (client, modules, nombre d'utilisateurs, date de fin) ; « Services » : la licence, les mises à jour, la maintenance et le support décrits au présent contrat.",
  ]);

  add("Objet", [
    H
      ? `Le présent contrat a pour objet de définir les conditions dans lesquelles ${E} fournit au Client, qui l'accepte, un accès en ligne à la Plateforme (formule « ${c.formule} », ${plafondTxt}) ainsi que les services associés, pour les seuls besoins professionnels internes du Client.`
      : `Le présent contrat a pour objet de définir les conditions dans lesquelles ${E} concède au Client, qui l'accepte, une licence d'utilisation de la version installée de la Plateforme (formule « ${c.formule} », ${plafondTxt}) ainsi que les services associés, pour les seuls besoins professionnels internes du Client.`,
    "Le Client reconnaît avoir pris connaissance des fonctionnalités de la Plateforme, les avoir jugées adaptées à ses besoins et avoir reçu de l'Éditeur toutes les informations nécessaires à son choix.",
  ]);

  add("Documents contractuels", [
    "Le contrat est constitué du présent document et de son Annexe 1 (conditions particulières et financières), qui forment un tout indissociable avec l'offre commerciale acceptée par le Client.",
    "En cas de contradiction, les stipulations de l'Annexe 1 prévalent sur celles du corps du contrat pour les conditions particulières (formule, prix, durée), et le corps du contrat prévaut pour tout le reste. Les conditions générales d'achat du Client sont expressément écartées.",
  ]);

  add("Durée et prise d'effet", [
    `Le contrat prend effet à la date d'effet indiquée à l'Annexe 1 pour une durée initiale de ${duree}.`,
    H
      ? "À son terme, il est reconduit tacitement pour des périodes successives d'une durée identique, sauf dénonciation par l'une des parties, par écrit (courrier ou e-mail avec accusé de réception), au moins trente (30) jours avant l'échéance en cours."
      : "La licence est concédée pour la durée initiale indiquée. Elle n'est pas renouvelée tacitement : son renouvellement donne lieu à la facturation d'une nouvelle période puis à la remise d'une nouvelle Clé de licence, sans réinstallation et sans altération des données du Client.",
  ]);

  add(H ? "Droit d'accès et d'utilisation" : "Licence d'utilisation", [
    H
      ? `${E} concède au Client, pour la durée du contrat, un droit personnel, non exclusif, non cessible, non transférable et non sous-licenciable d'accéder à la Plateforme et de l'utiliser, pour ses besoins internes, par ses Utilisateurs autorisés, dans la limite de la formule et des Modules souscrits.`
      : `${E} concède au Client, pour la durée du contrat, une licence personnelle, non exclusive, non cessible, non transférable et non sous-licenciable d'installer et d'utiliser la Plateforme, pour ses besoins internes, par ses Utilisateurs autorisés, dans la limite de la formule et des Modules souscrits, sur un seul environnement de production et un environnement de sauvegarde.`,
    "L'usage de la Plateforme au profit d'une autre entité juridique (filiale, société liée, client du Client) est exclu, sauf accord écrit préalable de l'Éditeur et complément de redevance.",
    "Les Modules non souscrits restent inaccessibles ; leur ouverture ultérieure fait l'objet d'un avenant ou d'une nouvelle offre.",
  ]);

  add("Propriété intellectuelle", [
    `${E} est seul titulaire de l'ensemble des droits de propriété intellectuelle sur la Plateforme et les Éléments protégés : droits d'auteur (protégés notamment par l'Accord de Bangui instituant l'Organisation Africaine de la Propriété Intellectuelle (OAPI) et ses annexes, ainsi que par les conventions internationales applicables), droits sur les marques et noms de domaine, droits sur les bases de données, secrets d'affaires, ainsi que tout brevet, demande de brevet ou autre titre de propriété industrielle déjà déposé ou à déposer, notamment auprès de l'OAPI.`,
    `Le Client reconnaît que la Plateforme comporte des procédés, méthodes de calcul et de traitement originaux qui font ou pourront faire l'objet de dépôts auprès de l'OAPI ou d'autres offices. Il s'interdit de divulguer ces éléments, d'en revendiquer la paternité, et de déposer ou de faire déposer, en son nom ou au nom d'un tiers, un titre de propriété intellectuelle portant sur la Plateforme, ses procédés ou leurs dérivés.`,
    `Chaque écran, document et fichier de la Plateforme porte la mention « © ${c.annee} ${E} - Baobab Marchés - Tous droits réservés ». Le Client s'interdit de supprimer, masquer ou modifier cette mention, ainsi que toute marque, logo ou indication de propriété.`,
    c.mention_pi ? `Référence de protection : ${c.mention_pi}` : null,
    "Le contrat ne confère au Client qu'un droit d'usage. Aucune cession de droits n'est consentie, et aucun droit sur le code source n'est concédé. Les évolutions, adaptations, développements spécifiques et améliorations de la Plateforme, y compris ceux issus de suggestions du Client, appartiennent à l'Éditeur, sauf stipulation écrite contraire.",
  ]);

  add("Engagements et interdictions du Client", [
    "Sauf autorisation écrite préalable de l'Éditeur, le Client s'interdit, et s'interdit de permettre à tout tiers, de :",
    "a) copier, reproduire, adapter, traduire, modifier ou créer une œuvre dérivée de la Plateforme, en tout ou partie, sauf la copie de sauvegarde strictement nécessaire à l'usage prévu ;",
    "b) décompiler, désassembler, procéder à de l'ingénierie inverse, ou tenter d'extraire le code source, la structure de la base de données, les algorithmes ou les méthodes de calcul de la Plateforme ;",
    `c) contourner, désactiver ou altérer ${H ? "les mécanismes d'authentification, de contrôle d'accès et de limitation des utilisateurs ou des Modules" : "la Clé de licence, les limitations d'utilisateurs, de Modules ou de durée, ainsi que toute mesure technique de protection"}, ou utiliser une Clé de licence falsifiée ou provenant d'un tiers ;`,
    "d) louer, prêter, vendre, sous-licencier, héberger pour le compte de tiers, ou exploiter la Plateforme comme un service à destination de tiers (prestation de service, bureau de services) ;",
    "e) donner accès à la Plateforme à une personne qui n'est pas un Utilisateur autorisé, ou partager des identifiants ;",
    "f) extraire de manière systématique ou massive des contenus, paramètres ou modèles de la Plateforme autres que les Données du Client (aspiration, scraping) ;",
    "g) utiliser la Plateforme ou la documentation pour concevoir, développer ou faciliter un produit ou service concurrent, ou publier des analyses comparatives de performance sans accord écrit ;",
    "h) réaliser des tests d'intrusion, scans de vulnérabilité ou audits de sécurité, introduire un programme malveillant, ou porter atteinte au fonctionnement ou à la sécurité de la Plateforme ;",
    "i) utiliser des Modules non souscrits ou dépasser la formule souscrite.",
    "Le Client répond du respect du présent contrat par ses Utilisateurs autorisés, ses salariés et ses sous-traitants.",
  ]);

  add("Confidentialité", [
    "Chaque partie s'engage à garder strictement confidentielles les informations non publiques de l'autre partie dont elle a connaissance à l'occasion du contrat, et à ne les utiliser que pour son exécution. Constituent notamment des informations confidentielles de l'Éditeur : la Plateforme, sa documentation, ses méthodes de calcul, ses tarifs, ses procédés et dépôts en cours.",
    "Cette obligation s'applique pendant toute la durée du contrat et pendant cinq (5) ans après son terme, et sans limitation de durée pour le code source, les procédés et les secrets d'affaires. Elle ne s'applique pas aux informations tombées dans le domaine public sans faute de la partie qui les a reçues, ni à celles dont la communication est exigée par la loi ou par une autorité compétente (sous réserve d'en informer l'autre partie lorsque la loi le permet).",
  ]);

  add("Sécurité des accès et responsabilité des utilisateurs", [
    "Les identifiants sont strictement personnels. Le Client veille à leur confidentialité, impose à ses Utilisateurs autorisés un mot de passe robuste, désactive sans délai les comptes des personnes quittant l'entreprise ou changeant de fonction, et reste responsable de toute action réalisée avec ses identifiants.",
    "Le Client informe l'Éditeur sans délai, et au plus tard dans les quarante-huit (48) heures, de toute perte, vol, utilisation frauduleuse ou suspicion de compromission des identifiants ou de la Plateforme, et coopère aux mesures correctives.",
  ]);

  add("Données du Client et protection des données personnelles", [
    "Les Données du Client demeurent sa propriété exclusive. Le Client concède à l'Éditeur le droit de les traiter dans la seule mesure nécessaire à la fourniture des Services.",
    "Chaque partie respecte la réglementation applicable à la protection des données à caractère personnel, notamment la loi sénégalaise n° 2008-12 du 25 janvier 2008. Le Client demeure responsable de traitement : il garantit la licéité de la collecte des données personnelles qu'il enregistre, l'information des personnes concernées et l'accomplissement des formalités auprès de la Commission de protection des données personnelles. L'Éditeur agit comme sous-traitant, sur instructions du Client, et met en œuvre des mesures de sécurité techniques et organisationnelles appropriées.",
    H
      ? "L'Éditeur assure des sauvegardes régulières des Données du Client sur l'infrastructure d'hébergement, peut recourir à des sous-traitants techniques (hébergeur) dont il reste responsable, et informe le Client dans un délai raisonnable de toute violation de données le concernant."
      : "La Plateforme étant installée sur l'infrastructure du Client, les Données du Client y demeurent. Le Client est seul responsable de la sécurité de son serveur et de son réseau, de la conservation et de la restauration de ses sauvegardes, ainsi que des accès physiques et logiques à l'installation.",
  ]);

  if (H) {
    add("Hébergement, disponibilité et support", [
      "L'Éditeur met en œuvre les moyens raisonnables pour assurer l'accessibilité de la Plateforme 24 heures sur 24 et 7 jours sur 7, avec un objectif de disponibilité mensuelle de 98 %, hors maintenances programmées (annoncées dans la mesure du possible), cas de force majeure, défaillance des réseaux de télécommunication ou de l'équipement du Client. Il s'agit d'une obligation de moyens.",
      "Le support est assuré par e-mail et téléphone les jours ouvrés, aux horaires communiqués par l'Éditeur. Les mises à jour correctives et évolutives de la Plateforme sont incluses dans la redevance ; l'Éditeur peut faire évoluer les fonctionnalités sans en réduire substantiellement le périmètre souscrit.",
    ]);
  } else {
    add("Installation, mises à jour et support", [
      "L'Éditeur remet au Client le programme d'installation et la Clé de licence. L'installation et le paramétrage initial sont réalisés selon les modalités prévues à l'Annexe 1. La Clé de licence est personnelle au Client et incessible.",
      "Pendant la durée de la licence, l'Éditeur met à disposition les mises à jour correctives et évolutives de la version souscrite et assure le support par e-mail et téléphone les jours ouvrés. Avant toute mise à jour, le Client effectue une sauvegarde complète de sa base de données ; l'Éditeur ne répond pas de la perte de données résultant d'une absence de sauvegarde.",
      "À l'expiration de la licence, et à défaut de renouvellement, un délai de grâce de trente (30) jours est accordé, puis la Plateforme passe en mode lecture seule : le Client conserve l'accès à ses données, mais la saisie et les traitements sont suspendus jusqu'au renouvellement. Aucune donnée n'est supprimée ni altérée par l'expiration.",
    ]);
  }

  add("Prix, facturation et paiement", [
    "Les redevances, frais d'installation et modalités de facturation sont fixés à l'Annexe 1. Sauf mention contraire, les prix sont exprimés en francs CFA (XOF), hors taxes ; les taxes éventuelles sont à la charge du Client.",
    "Les factures sont payables dans les quinze (15) jours de leur date, par virement bancaire, mobile money ou tout autre moyen accepté par l'Éditeur, sans escompte ni compensation. Les frais d'installation sont dus en une seule fois et ne sont pas remboursables.",
    "Tout retard de paiement donne lieu, de plein droit et sans mise en demeure, à des intérêts de retard au taux de un pour cent (1 %) par mois de retard. Quinze (15) jours après une mise en demeure restée sans effet, l'Éditeur peut suspendre l'accès aux Services ou, pour la version installée, ne pas délivrer la Clé de licence de renouvellement, sans que cela ne dispense le Client du paiement.",
    "Les redevances peuvent être révisées à chaque échéance, moyennant un préavis écrit de soixante (60) jours ; à défaut d'acceptation, le Client peut résilier pour la fin de la période en cours.",
  ]);

  add("Garanties et limitation de responsabilité", [
    "L'Éditeur garantit que la Plateforme est, pour l'essentiel, conforme à sa documentation. Il ne garantit pas que la Plateforme est exempte de toute erreur ou interruption, ni qu'elle répond à des besoins non exprimés ; il corrige les anomalies reproductibles qui lui sont signalées dans un délai raisonnable.",
    "Les Modules de comptabilité, de fiscalité, de paie et de calcul sont des outils d'aide à la décision et à la préparation des documents. Ils s'appuient sur les Données du Client, sur ses paramétrages et sur les textes en vigueur à la date de leur conception. Le Client reste seul responsable de l'exactitude de ses données, de la vérification des résultats avec son expert-comptable ou son conseil, de l'établissement, du dépôt dans les délais et du paiement de ses déclarations. L'Éditeur n'est pas responsable des pénalités, majorations, redressements ou préjudices résultant de leur usage.",
    "La responsabilité de l'Éditeur, tous préjudices confondus, est limitée aux dommages directs et plafonnée au montant des redevances hors taxes effectivement payées par le Client au cours des douze (12) mois précédant le fait générateur. L'Éditeur n'est tenu d'aucun dommage indirect ou immatériel (perte de profit, de marché, de clientèle, d'image, perte de données non sauvegardées par le Client).",
    "Ces limitations ne s'appliquent ni en cas de faute lourde ou dolosive, ni aux obligations de paiement du Client, ni à la réparation des atteintes aux droits de l'Éditeur visées aux articles 6, 7, 8 et 15.",
  ]);

  add("Suspension et résiliation", [
    "Chaque partie peut résilier le contrat en cas de manquement grave de l'autre à ses obligations, quinze (15) jours après une mise en demeure par courrier ou par e-mail avec accusé de réception restée sans effet (huit (8) jours en cas de non-paiement).",
    "L'Éditeur peut résilier le contrat de plein droit, sans préavis ni indemnité, et sans préjudice de tous dommages-intérêts, en cas d'atteinte aux articles 6, 7 ou 8, d'usage frauduleux de la Clé de licence ou des identifiants, ou de contournement des mesures de protection. Il peut, dans ces cas, suspendre immédiatement l'accès aux Services.",
    "La résiliation ne remet pas en cause les redevances échues, qui restent dues, ni, sauf faute de l'Éditeur, le droit de celui-ci de conserver les sommes déjà perçues. Les articles 6, 7, 8, 10, 13, 15, 17, 20 et 21 survivent à la fin du contrat.",
  ]);

  add("Atteinte aux droits de l'Éditeur : sanctions", [
    "Toute violation des articles 6 et 7 (copie, ingénierie inverse, contournement de la protection, usage ou accès non autorisé, divulgation) constitue une atteinte aux droits de l'Éditeur susceptible de caractériser, selon le cas, une contrefaçon, une violation du droit d'auteur, un accès ou un maintien frauduleux dans un système informatique et un abus de confiance. Elle engage la responsabilité civile et, le cas échéant, pénale du Client, de ses dirigeants et des personnes fautives, selon les textes applicables (notamment l'Accord de Bangui et ses annexes, le droit pénal et la législation sur la cybercriminalité applicables au Sénégal).",
    `Sans préjudice de la réparation de son entier préjudice, le Client versera à l'Éditeur, à titre de clause pénale et d'indemnité forfaitaire minimale, une somme égale à ${c.penalite_mois} mois de redevances hors taxes de la formule souscrite telles qu'elles figurent à l'Annexe 1, immédiatement exigible dès la constatation de la violation. Le Client reconnaît que cette somme n'est pas manifestement excessive au regard de l'importance des droits protégés ; elle ne limite pas le droit de l'Éditeur d'obtenir réparation d'un préjudice supérieur.`,
    "L'Éditeur pourra en outre solliciter, y compris en référé et sur simple requête, toute mesure conservatoire ou d'interdiction (cessation immédiate, saisie-contrefaçon, séquestre, publication de la décision), aux frais du Client condamné, ainsi que le remboursement de ses frais de procédure et honoraires raisonnables.",
    "Les parties conviennent que les journaux de connexion, enregistrements informatiques et relevés techniques de l'Éditeur font foi jusqu'à preuve contraire, et sont admis comme mode de preuve.",
  ]);

  add("Audit et vérification d'usage", [
    H
      ? "L'Éditeur peut vérifier la conformité de l'usage de la Plateforme (nombre d'Utilisateurs autorisés, Modules, respect des interdictions) au moyen de ses journaux techniques. En cas de dépassement, le Client régularise les redevances correspondantes au tarif en vigueur, à compter de la date du dépassement."
      : "L'Éditeur peut vérifier une fois par an, sur préavis de dix (10) jours ouvrés, la conformité de l'usage de la Plateforme (nombre d'Utilisateurs autorisés, Modules, environnement d'installation) par déclaration écrite certifiée du Client ou par vérification sur site ou à distance, sans perturber l'activité du Client. En cas de dépassement, le Client régularise les redevances correspondantes au tarif en vigueur, à compter de la date du dépassement, et supporte les frais de la vérification si l'écart constaté excède cinq pour cent (5 %).",
  ]);

  add("Réversibilité et fin de contrat", [
    H
      ? "À la fin du contrat, le Client peut exporter ses Données dans des formats standards (Excel, PDF, CSV) pendant trente (30) jours. Passé ce délai, l'Éditeur supprime ou anonymise les Données du Client dans un délai de quatre-vingt-dix (90) jours, sous réserve de ses obligations légales de conservation. Toute assistance supplémentaire fait l'objet d'un devis."
      : "À la fin du contrat, le Client cesse tout usage de la Plateforme, désinstalle le programme, supprime toutes les copies du programme et de la Clé de licence, et en atteste par écrit sur demande de l'Éditeur. Les Données du Client demeurent sa propriété et peuvent être exportées dans des formats standards (Excel, PDF, CSV).",
  ]);

  add("Force majeure", [
    "Aucune partie n'est responsable d'un manquement dû à un événement de force majeure au sens du droit applicable, notamment catastrophe naturelle, coupure prolongée d'électricité ou d'accès à Internet, défaillance d'un opérateur de télécommunication ou d'un hébergeur non imputable à l'Éditeur, acte de guerre ou de terrorisme, décision d'une autorité, cyberattaque malgré des mesures de sécurité raisonnables.",
    "La partie empêchée en informe l'autre sans délai. Si l'empêchement dépasse soixante (60) jours, chaque partie peut résilier le contrat sans indemnité.",
  ]);

  add("Cession, sous-traitance et notifications", [
    "Le Client ne peut céder, transférer ou nantir le contrat ou les droits qui en découlent sans l'accord écrit préalable de l'Éditeur. L'Éditeur peut sous-traiter tout ou partie des Services (notamment l'hébergement) en restant responsable de leur exécution, et peut céder le contrat à une entité de son groupe ou à l'acquéreur de son activité.",
    "Les notifications sont valablement faites par courrier remis contre décharge, par lettre recommandée, ou par e-mail aux adresses indiquées au contrat, avec accusé de réception ; elles sont réputées reçues quarante-huit (48) heures après l'envoi d'un e-mail.",
  ]);

  add("Dispositions générales", [
    "Le contrat exprime l'intégralité de l'accord des parties et remplace tout accord ou proposition antérieur sur le même objet. Toute modification doit faire l'objet d'un avenant écrit signé des deux parties.",
    "Si une stipulation est déclarée nulle ou inapplicable, les autres stipulations demeurent en vigueur. Le fait pour une partie de ne pas se prévaloir d'un manquement ne vaut pas renonciation à s'en prévaloir ultérieurement.",
    "Le contrat est rédigé en langue française. Il peut être signé de manière manuscrite ou électronique, et en plusieurs exemplaires originaux ayant la même valeur.",
  ]);

  add("Droit applicable et règlement des différends", [
    "Le contrat est soumis au droit sénégalais et aux Actes uniformes de l'OHADA applicables.",
    `Les parties s'efforcent de régler à l'amiable tout différend relatif à la validité, à l'interprétation ou à l'exécution du contrat, dans un délai de trente (30) jours à compter de sa notification écrite. À défaut d'accord, compétence exclusive est attribuée au ${c.juridiction}, y compris en cas de référé, d'appel en garantie ou de pluralité de défendeurs, sans préjudice du droit de l'Éditeur de demander des mesures urgentes ou conservatoires devant toute juridiction du lieu où l'atteinte à ses droits est constatée.`,
  ]);

  return A;
}

module.exports = { construireArticles };
