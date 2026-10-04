/**
 * Plan comptable SYSCOHADA revise (systeme normal) - donnees de reference du
 * module Comptabilite (chantier du 04/10/2026, phase 1).
 *
 * Chaque ligne est "numero|libelle". Le numero est donne SANS zeros de
 * remplissage : l'arbre se deduit des prefixes (1 chiffre = classe, 2 =
 * compte principal, 3 = compte divisionnaire, 4+ = sous-compte). Un compte
 * qui n'a aucun descendant dans cette liste est IMPUTABLE (utilisable dans
 * une ecriture) et est complete par des zeros jusqu'a la longueur de compte
 * de l'entreprise (8 chiffres par defaut, convention Sage, ex 4011 ->
 * 40110000). Les autres sont des TITRES de regroupement (sous-totaux des
 * balances et du grand livre).
 *
 * Source : plan comptable SYSCOHADA revise (acte uniforme OHADA 2017) tel que
 * reproduit de memoire - a faire valider par l'expert-comptable de
 * l'entreprise avant mise en production (voir document d'architecture). Chaque
 * entreprise peut ensuite modifier les libelles, ajouter ou desactiver des
 * comptes depuis Comptabilite > Plan comptable. Les sous-comptes tres
 * specifiques (5e chiffre et au-dela) sont volontairement laisses aux
 * entreprises.
 */
const LIGNES = `
1|Comptes de ressources durables
10|Capital
101|Capital social
1011|Capital souscrit, non appelé
1012|Capital souscrit, appelé, non versé
1013|Capital souscrit, appelé, versé, non amorti
1014|Capital souscrit, appelé, versé, amorti
1018|Capital souscrit soumis à des conditions particulières
102|Capital par dotation et complément de dotation
1021|Dotation initiale
1022|Dotations complémentaires
1028|Autres dotations
103|Capital personnel
104|Compte de l'exploitant
1041|Apports temporaires
1042|Opérations courantes
1043|Rémunérations, impôts et autres charges personnelles
1047|Prélèvements d'acomptes sur résultats
1048|Versements en compte courant
105|Primes liées au capital social
1051|Primes d'émission
1052|Primes d'apport
1053|Primes de fusion
1054|Primes de conversion
1058|Autres primes
106|Écarts de réévaluation
1061|Écarts de réévaluation légale
1062|Écarts de réévaluation libre
109|Apporteurs, capital souscrit, non appelé
11|Réserves
111|Réserve légale
112|Réserves statutaires ou contractuelles
113|Réserves réglementées
1131|Réserves de plus-values nettes à long terme
1132|Réserves d'attribution gratuite d'actions au personnel salarié et aux dirigeants
1133|Réserves consécutives à l'octroi de subventions d'investissement
1138|Autres réserves réglementées
118|Autres réserves
1181|Réserves facultatives
1188|Réserves diverses
12|Report à nouveau
121|Report à nouveau créditeur
129|Report à nouveau débiteur
1291|Perte nette à reporter
1292|Perte - Amortissements réputés différés
13|Résultat net de l'exercice
130|Résultat en instance d'affectation
1301|Résultat en instance d'affectation : bénéfice
1309|Résultat en instance d'affectation : perte
131|Résultat net : bénéfice
132|Marge commerciale (soldes intermédiaires de gestion)
133|Valeur ajoutée (soldes intermédiaires de gestion)
134|Excédent brut d'exploitation (soldes intermédiaires de gestion)
135|Résultat d'exploitation (soldes intermédiaires de gestion)
136|Résultat financier (soldes intermédiaires de gestion)
137|Résultat des activités ordinaires (soldes intermédiaires de gestion)
138|Résultat hors activités ordinaires (soldes intermédiaires de gestion)
139|Résultat net : perte
14|Subventions d'investissement
141|Subventions d'équipement
1411|Subventions d'équipement : État
1412|Subventions d'équipement : régions
1413|Subventions d'équipement : départements
1414|Subventions d'équipement : communes et collectivités publiques décentralisées
1415|Subventions d'équipement : entités publiques ou mixtes
1416|Subventions d'équipement : entités et organismes privés
1417|Subventions d'équipement : organismes internationaux
1418|Subventions d'équipement : autres
148|Autres subventions d'investissement
15|Provisions réglementées et fonds assimilés
151|Amortissements dérogatoires
152|Plus-values de cession à réinvestir
153|Fonds réglementés
154|Provisions spéciales de réévaluation
155|Provisions réglementées relatives aux immobilisations
156|Provisions réglementées relatives aux stocks
157|Provisions pour investissement
158|Autres provisions et fonds réglementés
16|Emprunts et dettes assimilées
161|Emprunts obligataires
162|Emprunts et dettes auprès des établissements de crédit
163|Avances reçues de l'État
164|Avances reçues et comptes courants bloqués
165|Dépôts et cautionnements reçus
166|Intérêts courus
167|Avances assorties de conditions particulières
168|Autres emprunts et dettes
17|Dettes de crédit-bail et contrats assimilés
172|Dettes de crédit-bail immobilier
173|Dettes de crédit-bail mobilier
174|Dettes sur contrats de location-vente
176|Intérêts courus sur dettes de crédit-bail et contrats assimilés
178|Autres dettes sur contrats de location-acquisition
18|Dettes liées à des participations et comptes de liaison des établissements et sociétés en participation
181|Dettes liées à des participations
182|Dettes liées à des sociétés en participation
183|Intérêts courus sur dettes liées à des participations
184|Comptes permanents bloqués des établissements et succursales
185|Comptes permanents non bloqués des établissements et succursales
186|Comptes de liaison charges
187|Comptes de liaison produits
188|Comptes de liaison des sociétés en participation
19|Provisions pour risques et charges
191|Provisions pour litiges
192|Provisions pour garanties données aux clients
193|Provisions pour pertes sur marchés à achèvement futur
194|Provisions pour pertes de change
195|Provisions pour impôts
196|Provisions pour pensions et obligations similaires
197|Provisions pour charges à répartir
198|Autres provisions pour risques et charges
2|Comptes d'actif immobilisé
21|Immobilisations incorporelles
211|Frais de développement
212|Brevets, licences, concessions et droits similaires
213|Logiciels et sites internet
214|Marques
215|Fonds commercial
216|Droit au bail
217|Investissements de création
218|Autres droits et valeurs incorporels
219|Immobilisations incorporelles en cours
22|Terrains
221|Terrains agricoles et forestiers
222|Terrains nus
223|Terrains bâtis
224|Travaux de mise en valeur des terrains
225|Terrains de carrières, tourbières, sablières
226|Terrains d'aménagement
227|Terrains mis en concession
228|Autres terrains
229|Aménagements de terrains en cours
23|Bâtiments, installations techniques et agencements
231|Bâtiments industriels, agricoles, administratifs et commerciaux sur sol propre
232|Bâtiments industriels, agricoles, administratifs et commerciaux sur sol d'autrui
233|Ouvrages d'infrastructure
234|Aménagements, agencements et installations techniques
235|Aménagements de bureaux
237|Bâtiments industriels, agricoles et commerciaux mis en concession
238|Autres installations et agencements
239|Bâtiments et installations techniques en cours
2391|Bâtiments en cours
2392|Installations techniques en cours
2393|Ouvrages d'infrastructure en cours
2394|Aménagements et agencements en cours
2395|Aménagements de bureaux en cours
2398|Autres installations et agencements en cours
24|Matériel, mobilier et actifs biologiques
241|Matériel et outillage industriels et commerciaux
2411|Matériel industriel
2412|Outillage industriel
2413|Matériel commercial
2414|Outillage commercial
242|Matériel et outillage agricoles
243|Matériel d'emballage récupérable et identifiable
244|Matériel et mobilier
2441|Matériel de bureau
2442|Matériel informatique
2443|Matériel bureautique
2444|Mobilier de bureau
245|Matériel de transport
2451|Matériel automobile
2452|Matériel ferroviaire
2453|Matériel fluvial, lagunaire
2454|Matériel naval
2455|Matériel aérien
2456|Matériel de transport en location-acquisition
2457|Matériel hippomobile
2458|Autres matériels de transport
246|Actifs biologiques
247|Agencements, aménagements du matériel et autres
248|Autres matériels et mobiliers
249|Matériels et actifs biologiques en cours
25|Avances et acomptes versés sur immobilisations
251|Avances et acomptes versés sur immobilisations incorporelles
252|Avances et acomptes versés sur immobilisations corporelles
26|Titres de participation
261|Titres de participation dans des sociétés sous contrôle exclusif
262|Titres de participation dans des sociétés sous contrôle conjoint
263|Titres de participation dans des sociétés conférant une influence notable
265|Participations dans des organismes professionnels
266|Parts dans des groupements d'intérêt économique (GIE)
268|Autres titres de participation
27|Autres immobilisations financières
271|Prêts et créances non commerciales
272|Prêts au personnel
273|Créances sur l'État
274|Titres immobilisés
275|Dépôts et cautionnements versés
2751|Dépôts pour loyers d'avance
2752|Dépôts pour l'électricité
2753|Dépôts pour l'eau
2754|Dépôts pour le gaz
2755|Dépôts pour le téléphone, le télex, la télécopie
2756|Cautionnements sur marchés publics
2757|Cautionnements sur autres opérations
2758|Autres dépôts et cautionnements
276|Intérêts courus
277|Créances rattachées à des participations et avances à des GIE
278|Immobilisations financières diverses
28|Amortissements
281|Amortissements des immobilisations incorporelles
2811|Amortissements des frais de développement
2812|Amortissements des brevets, licences, concessions et droits similaires
2813|Amortissements des logiciels et sites internet
2814|Amortissements des marques
2815|Amortissements du fonds commercial
2816|Amortissements du droit au bail
2817|Amortissements des investissements de création
2818|Amortissements des autres droits et valeurs incorporels
282|Amortissements des terrains
283|Amortissements des bâtiments, installations techniques et agencements
2831|Amortissements des bâtiments sur sol propre
2832|Amortissements des bâtiments sur sol d'autrui
2833|Amortissements des ouvrages d'infrastructure
2834|Amortissements des aménagements, agencements et installations techniques
2835|Amortissements des aménagements de bureaux
2837|Amortissements des bâtiments mis en concession
2838|Amortissements des autres installations et agencements
284|Amortissements du matériel
2841|Amortissements du matériel et outillage industriels et commerciaux
2842|Amortissements du matériel et outillage agricoles
2843|Amortissements du matériel d'emballage récupérable et identifiable
2844|Amortissements du matériel et mobilier
2845|Amortissements du matériel de transport
2846|Amortissements des actifs biologiques
2847|Amortissements des agencements, aménagements du matériel et autres
2848|Amortissements des autres matériels et mobiliers
29|Dépréciations des immobilisations
291|Dépréciations des immobilisations incorporelles
292|Dépréciations des terrains
293|Dépréciations des bâtiments, installations techniques et agencements
294|Dépréciations du matériel, mobilier et actifs biologiques
295|Dépréciations des avances et acomptes versés sur immobilisations
296|Dépréciations des titres de participation
297|Dépréciations des autres immobilisations financières
3|Comptes de stocks
31|Marchandises
311|Marchandises A
312|Marchandises B
318|Marchandises hors activités ordinaires (HAO)
32|Matières premières et fournitures liées
321|Matières A
322|Matières B
323|Fournitures liées
33|Autres approvisionnements
331|Matières consommables
332|Fournitures d'atelier et d'usine
333|Fournitures de magasin
334|Fournitures de bureau
335|Emballages
338|Autres approvisionnements
34|Produits en cours
341|Produits en cours
342|Travaux en cours
343|Produits intermédiaires en cours
344|Produits résiduels en cours
35|Services en cours
351|Études en cours
352|Prestations de services en cours
36|Produits finis
361|Produits finis A
362|Produits finis B
37|Produits intermédiaires et résiduels
371|Produits intermédiaires
372|Produits résiduels
38|Stocks en cours de route, en consignation ou en dépôt
381|Marchandises en cours de route
382|Matières premières et fournitures liées en cours de route
383|Autres approvisionnements en cours de route
386|Produits finis en cours de route
387|Stock en consignation ou en dépôt
388|Stock provenant d'immobilisations mises hors service ou au rebut
39|Dépréciations des stocks et encours de production
391|Dépréciations des stocks de marchandises
392|Dépréciations des stocks de matières premières et fournitures liées
393|Dépréciations des stocks d'autres approvisionnements
394|Dépréciations des productions en cours
395|Dépréciations des services en cours
396|Dépréciations des stocks de produits finis
397|Dépréciations des stocks de produits intermédiaires et résiduels
398|Dépréciations des stocks en cours de route, en consignation ou en dépôt
4|Comptes de tiers
40|Fournisseurs et comptes rattachés
401|Fournisseurs, dettes en compte
4011|Fournisseurs
4012|Fournisseurs groupe
4013|Fournisseurs sous-traitants
4016|Fournisseurs, réserve de propriété
4017|Fournisseurs, retenues de garantie
402|Fournisseurs, effets à payer
4021|Fournisseurs, effets à payer
4022|Fournisseurs groupe, effets à payer
4023|Fournisseurs sous-traitants, effets à payer
408|Fournisseurs, factures non parvenues
4081|Fournisseurs, factures non parvenues
4082|Fournisseurs groupe, factures non parvenues
4083|Fournisseurs sous-traitants, factures non parvenues
4086|Fournisseurs, intérêts courus
409|Fournisseurs débiteurs
4091|Fournisseurs, avances et acomptes versés
4092|Fournisseurs groupe, avances et acomptes versés
4093|Fournisseurs sous-traitants, avances et acomptes versés
4094|Fournisseurs, créances pour emballages et matériels à rendre
4098|Rabais, remises, ristournes et autres avoirs à obtenir
41|Clients et comptes rattachés
411|Clients
4111|Clients
4112|Clients groupe
4114|Clients, État et collectivités publiques
4115|Clients, organismes internationaux
4116|Clients, retenues de garantie
412|Clients, effets à recevoir en portefeuille
4121|Clients, effets à recevoir
4122|Clients groupe, effets à recevoir
4124|Clients, État et collectivités publiques, effets à recevoir
4125|Clients, organismes internationaux, effets à recevoir
413|Clients, chèques, effets et autres valeurs impayés
4131|Clients, chèques impayés
4132|Clients, effets impayés
4133|Clients, cartes de crédit impayées
4138|Clients, autres valeurs impayées
414|Créances sur cessions courantes d'immobilisations
415|Clients, effets escomptés non échus
416|Créances clients litigieuses ou douteuses
4161|Créances litigieuses
4162|Créances douteuses
418|Clients, produits à recevoir
4181|Clients, factures à établir
4186|Clients, intérêts courus
419|Clients créditeurs
4191|Clients, avances et acomptes reçus
4192|Clients groupe, avances et acomptes reçus
4194|Clients, dettes pour emballages et matériels consignés
4198|Rabais, remises, ristournes et autres avoirs à accorder
42|Personnel
421|Personnel, avances et acomptes
4211|Personnel, avances
4212|Personnel, acomptes
4213|Frais avancés et fournitures au personnel
422|Personnel, rémunérations dues
423|Personnel, oppositions, saisies-arrêts
424|Personnel, œuvres sociales
425|Représentants du personnel
4251|Délégués du personnel
4252|Syndicats et comités d'entreprises, d'établissement
4258|Autres représentants du personnel
426|Personnel, participation au capital
427|Personnel, dépôts
428|Personnel, charges à payer et produits à recevoir
4281|Dettes provisionnées pour congés à payer
4286|Autres charges à payer
4287|Produits à recevoir
43|Organismes sociaux
431|Sécurité sociale
4311|Prestations familiales
4312|Accidents de travail
4313|Caisse de retraite obligatoire
4314|Caisse de retraite facultative
4318|Autres cotisations sociales
432|Caisses de retraite complémentaire
433|Autres organismes sociaux
438|Organismes sociaux, charges à payer et produits à recevoir
4381|Charges sociales sur gratifications à payer
4382|Charges sociales sur congés à payer
4386|Autres charges à payer
4387|Produits à recevoir
44|État et collectivités publiques
441|État, impôt sur les bénéfices
442|État, autres impôts et taxes
4421|Impôts et taxes d'État
4422|Impôts et taxes sur les collectivités publiques
4423|Impôts et taxes recouvrables sur des obligataires
4424|Impôts et taxes recouvrables sur des associés
4426|Droits de douane
4427|Droits de mutation
4428|Autres impôts et taxes
443|État, TVA facturée
4431|TVA facturée sur ventes
4432|TVA facturée sur prestations de services
4433|TVA facturée sur travaux
4434|TVA facturée sur production livrée à soi-même
4435|TVA sur factures à établir
444|État, TVA due ou crédit de TVA
4441|État, TVA due
4449|État, crédit de TVA à reporter
445|État, TVA récupérable
4451|TVA récupérable sur immobilisations
4452|TVA récupérable sur achats
4453|TVA récupérable sur transport
4454|TVA récupérable sur services extérieurs et autres charges
4455|TVA récupérable sur factures non parvenues
4456|TVA transférée par d'autres entités
446|État, autres taxes sur le chiffre d'affaires
447|État, impôts retenus à la source
4471|Impôt général sur le revenu
4472|Impôts sur salaires
4473|Contribution nationale
4474|Contribution nationale de solidarité
4478|Autres impôts et contributions retenus à la source
448|État, charges à payer et produits à recevoir
4481|État, charges fiscales sur congés à payer
4486|État, autres charges à payer
4487|État, produits à recevoir
449|État, créances et dettes diverses
4491|État, obligations cautionnées
4492|État, avances et acomptes versés sur impôts
4493|État, fonds de dotation à recevoir
4494|État, subventions d'investissement à recevoir
4495|État, subventions d'exploitation à recevoir
4496|État, subventions d'équilibre à recevoir
4499|État, autres créances et dettes
45|Organismes internationaux
451|Opérations avec les organismes africains
452|Opérations avec les autres organismes internationaux
458|Organismes internationaux, fonds de dotation et subventions à recevoir
46|Associés et groupe
461|Associés, apports en société
462|Associés, versements reçus sur augmentation de capital
463|Associés, versements faits sur titres non libérés
465|Associés, dividendes à payer
466|Associés, comptes courants
467|Associés, opérations faites en commun et GIE
468|Associés, charges à payer et produits à recevoir
47|Débiteurs et créditeurs divers
471|Débiteurs et créditeurs divers
4711|Débiteurs divers
4712|Créditeurs divers
4713|Obligations cautionnées
4715|Rémunérations d'administrateurs non associés
4716|Compte d'affacturage
4717|Débiteurs divers, retenues de garantie
4718|Apport, compte de dépôt
472|Créances et dettes sur cessions d'immobilisations
473|Intermédiaires, opérations faites pour le compte de tiers
474|Compte de répartition périodique des charges et des produits
4746|Charges à répartir
4747|Produits à répartir
475|Comptes transitoires, ajustement spécial lié à la révision du SYSCOHADA
476|Charges constatées d'avance
477|Produits constatés d'avance
478|Écarts de conversion - Actif
4781|Diminution des créances d'exploitation
4782|Diminution des créances financières
4783|Augmentation des dettes d'exploitation
4784|Augmentation des dettes financières
4786|Différences compensées par couverture de change
4788|Différences d'actualisation
479|Écarts de conversion - Passif
4791|Augmentation des créances d'exploitation
4792|Augmentation des créances financières
4793|Diminution des dettes d'exploitation
4794|Diminution des dettes financières
4797|Différences compensées par couverture de change
4798|Différences d'actualisation
48|Créances et dettes hors activités ordinaires (HAO)
481|Fournisseurs d'investissements
4811|Fournisseurs d'investissements, immobilisations incorporelles
4812|Fournisseurs d'investissements, immobilisations corporelles
4813|Versements restant à effectuer sur titres de participation non libérés
4816|Fournisseurs d'investissements, réserve de propriété
4817|Fournisseurs d'investissements, retenues de garantie
4818|Fournisseurs d'investissements, factures non parvenues
482|Fournisseurs d'investissements, effets à payer
483|Dettes sur acquisition de valeurs mobilières de placement
484|Autres dettes HAO
485|Créances sur cessions d'immobilisations
4851|Créances sur cessions d'immobilisations incorporelles
4852|Créances sur cessions d'immobilisations corporelles
4858|Créances sur cessions d'immobilisations financières
486|Créances sur cessions de valeurs mobilières de placement
488|Autres créances HAO
49|Dépréciations et provisions pour risques à court terme (tiers)
490|Dépréciations des comptes fournisseurs
491|Dépréciations des comptes clients
4911|Dépréciations des créances litigieuses
4912|Dépréciations des créances douteuses
492|Dépréciations des comptes personnel
493|Dépréciations des comptes organismes sociaux
494|Dépréciations des comptes État et collectivités publiques
495|Dépréciations des comptes organismes internationaux
496|Dépréciations des comptes associés et groupe
497|Dépréciations des comptes débiteurs divers
498|Dépréciations des comptes de créances HAO
499|Provisions pour risques à court terme
4991|Provisions pour risques à court terme sur opérations d'exploitation
4998|Provisions pour risques à court terme sur opérations HAO
5|Comptes de trésorerie
50|Titres de placement
501|Titres du Trésor et bons de caisse à court terme
502|Actions
503|Obligations
504|Bons de souscription
505|Titres négociables hors région
506|Intérêts courus
508|Autres titres de placement et créances assimilées
51|Valeurs à encaisser
511|Effets à encaisser
512|Effets à l'encaissement
513|Chèques à encaisser
514|Cartes de crédit à encaisser
515|Autres valeurs à l'encaissement
52|Banques
521|Banques locales
5211|Banques locales en monnaie nationale
5212|Banques locales en devises
522|Banques autres États de la région
523|Banques autres États de la zone monétaire
524|Banques hors zone monétaire
525|Banques, dépôts à terme
526|Banques, intérêts courus
53|Établissements financiers et assimilés
531|Chèques postaux
532|Trésor
533|Sociétés de gestion et d'intermédiation (SGI)
536|Établissements financiers, intérêts courus
538|Autres organismes financiers
54|Instruments de trésorerie
541|Options de taux d'intérêt
542|Options de taux de change
543|Options de taux boursiers
544|Instruments de marchés à terme
545|Avoirs d'or et autres métaux précieux
55|Instruments de monnaie électronique
551|Monnaie électronique, carte carburant
552|Monnaie électronique, téléphone portable
553|Monnaie électronique, carte péage
554|Porte-monnaie électronique
558|Autres instruments de monnaie électronique
56|Banques, crédits de trésorerie et d'escompte
561|Crédits de trésorerie
564|Escompte de crédits de campagne
565|Escompte de crédits ordinaires
57|Caisse
571|Caisse siège social
5711|Caisse en monnaie nationale
5712|Caisse en devises
572|Caisse succursale A
573|Caisse succursale B
58|Régies d'avances, accréditifs et virements de fonds
581|Régies d'avance
582|Accréditifs
585|Virements de fonds
588|Autres virements internes
59|Dépréciations et provisions pour risques à court terme (trésorerie)
590|Dépréciations des titres de placement
591|Dépréciations des titres et valeurs à encaisser
592|Dépréciations des comptes banques
593|Dépréciations des comptes établissements financiers et assimilés
594|Dépréciations des instruments de trésorerie
595|Dépréciations des instruments de monnaie électronique
599|Provisions pour risques à court terme à caractère financier
6|Comptes de charges des activités ordinaires
60|Achats et variations de stocks
601|Achats de marchandises
6011|Achats de marchandises dans la région
6012|Achats de marchandises hors région
6013|Achats de marchandises aux entités du groupe de la région
6014|Achats de marchandises aux entités du groupe hors région
6015|Frais sur achats de marchandises
6019|Rabais, remises et ristournes obtenus sur achats de marchandises
602|Achats de matières premières et fournitures liées
6021|Achats de matières premières dans la région
6022|Achats de matières premières hors région
6023|Achats de matières premières aux entités du groupe de la région
6024|Achats de matières premières aux entités du groupe hors région
6025|Frais sur achats de matières premières
6029|Rabais, remises et ristournes obtenus sur achats de matières premières
603|Variations des stocks de biens achetés
6031|Variations des stocks de marchandises
6032|Variations des stocks de matières premières et fournitures liées
6033|Variations des stocks d'autres approvisionnements
604|Achats stockés de matières et fournitures consommables
6041|Matières consommables
6042|Matières combustibles
6043|Produits d'entretien
6044|Fournitures d'atelier et d'usine
6045|Frais accessoires d'achat
6046|Fournitures de magasin
6047|Fournitures de bureau
6048|Emballages
6049|Rabais, remises et ristournes obtenus sur achats stockés
605|Autres achats
6051|Fournitures non stockables : eau
6052|Fournitures non stockables : électricité
6053|Fournitures non stockables : autres énergies
6054|Fournitures d'entretien non stockables
6055|Fournitures de bureau non stockables
6056|Achats de petit matériel et outillage
6057|Achats d'études et prestations de services
6058|Achats de travaux, matériels et équipements
6059|Rabais, remises et ristournes obtenus sur autres achats
608|Achats d'emballages
6081|Emballages perdus
6082|Emballages récupérables non identifiables
6083|Emballages à usage mixte
6089|Rabais, remises et ristournes obtenus sur achats d'emballages
61|Transports
611|Transports sur achats
612|Transports sur ventes
613|Transports pour le compte de tiers
614|Transports du personnel
616|Transports de plis
618|Autres frais de transport
6181|Voyages et déplacements
6182|Transports entre établissements ou chantiers
6183|Transports administratifs
62|Services extérieurs A
621|Sous-traitance générale
622|Locations et charges locatives
6221|Locations de terrains
6222|Locations de bâtiments
6223|Locations de matériels et outillages
6224|Malis sur emballages
6225|Locations d'emballages
6226|Fermages et loyers du foncier
6228|Locations et charges locatives diverses
623|Redevances de crédit-bail et contrats assimilés
6232|Redevances de crédit-bail immobilier
6233|Redevances de crédit-bail mobilier
6234|Redevances de location-vente
6238|Autres redevances de contrats assimilés
624|Entretien, réparations, remise en état et maintenance
6241|Entretien et réparations des biens immobiliers
6242|Entretien et réparations des biens mobiliers
6243|Maintenance
6244|Charges de démantèlement et de remise en état
6248|Autres entretiens et réparations
625|Primes d'assurance
6251|Assurances multirisques
6252|Assurances matériel de transport
6253|Assurances risques d'exploitation
6254|Assurances responsabilité du producteur
6255|Assurances insolvabilité clients
6257|Assurances transport sur ventes
6258|Autres primes d'assurances
626|Études, recherches et documentation
6261|Études et recherches
6265|Documentation générale
6266|Documentation technique
627|Publicité, publications, relations publiques
6271|Annonces, insertions
6272|Catalogues, imprimés publicitaires
6273|Échantillons
6274|Foires et expositions
6275|Publications
6276|Cadeaux à la clientèle
6277|Frais de colloques, séminaires, conférences
6278|Autres charges de publicité et relations publiques
628|Frais de télécommunications
6281|Frais de téléphone
6282|Frais de télex
6283|Frais de télécopie
6288|Autres frais de télécommunication
63|Services extérieurs B
631|Frais bancaires
6311|Frais sur titres (vente, garde)
6312|Frais sur effets
6313|Location de coffres
6314|Commissions d'affacturage
6315|Commissions sur cartes de crédit
6316|Frais d'émission d'emprunts
6318|Autres frais bancaires
632|Rémunérations d'intermédiaires et de conseils
6322|Commissions et courtages sur ventes
6324|Honoraires des professions réglementées
6325|Frais d'actes et de contentieux
6326|Rémunérations d'affacturage
6327|Rémunérations des autres prestataires de services
6328|Divers frais
633|Frais de formation du personnel
634|Redevances pour brevets, licences, logiciels, concessions et droits similaires
6342|Redevances pour brevets, licences
6343|Redevances pour logiciels
6344|Redevances pour marques
6345|Redevances pour sites internet
6346|Redevances pour concessions, droits et valeurs similaires
635|Cotisations
6351|Cotisations
6358|Concours divers
637|Rémunérations de personnel extérieur à l'entité
6371|Personnel intérimaire
6372|Personnel détaché ou prêté à l'entité
638|Autres charges externes
6381|Frais de recrutement du personnel
6382|Frais de déménagement
6383|Réceptions
6384|Missions
6385|Charges de copropriété
64|Impôts et taxes
641|Impôts et taxes directs
6411|Impôts fonciers et taxes annexes
6412|Patentes, licences et taxes annexes
6413|Taxes sur appointements et salaires
6414|Taxes d'apprentissage
6415|Formation professionnelle continue
6418|Autres impôts et taxes directs
645|Impôts et taxes indirects
646|Droits d'enregistrement
6461|Droits de mutation
6462|Droits de timbre
6463|Taxes sur les véhicules de société
6464|Vignettes
6468|Autres droits
647|Pénalités et amendes fiscales
6471|Pénalités d'assiette, impôts directs
6472|Pénalités d'assiette, impôts indirects
6473|Pénalités de recouvrement, impôts directs
6474|Pénalités de recouvrement, impôts indirects
6478|Autres pénalités et amendes fiscales
648|Autres impôts et taxes
65|Autres charges
651|Pertes sur créances clients et autres débiteurs
6511|Pertes sur créances clients
6515|Pertes sur autres débiteurs
652|Quote-part de résultat sur opérations faites en commun
6521|Quote-part transférée de bénéfices (comptabilité du gérant)
6522|Pertes imputées par transfert
654|Valeurs comptables des cessions courantes d'immobilisations
6541|Valeurs comptables des cessions courantes d'immobilisations incorporelles
6542|Valeurs comptables des cessions courantes d'immobilisations corporelles
656|Pertes de change sur créances et dettes commerciales
657|Pénalités et amendes pénales
658|Charges diverses
6581|Indemnités de fonction et autres rémunérations d'administrateurs
6582|Dons
6583|Mécénat
6588|Autres charges diverses
659|Charges pour dépréciations et provisions pour risques à court terme d'exploitation
6591|Charges pour provisions sur risques sur ventes
6593|Charges pour dépréciations sur stocks
6594|Charges pour dépréciations sur créances
6598|Autres charges pour provisions pour risques à court terme
66|Charges de personnel
661|Rémunérations directes versées au personnel national
6611|Appointements, salaires et commissions
6612|Primes et gratifications
6613|Congés payés
6614|Indemnités de préavis, de licenciement et de recherche d'embauche
6615|Indemnités de maladie versées aux travailleurs
6616|Supplément familial
6617|Avantages en nature
6618|Autres rémunérations directes
662|Rémunérations directes versées au personnel non national
6621|Appointements, salaires et commissions du personnel non national
6622|Primes et gratifications du personnel non national
6623|Congés payés du personnel non national
6624|Indemnités de préavis et de licenciement du personnel non national
6625|Indemnités de maladie du personnel non national
6626|Supplément familial du personnel non national
6627|Avantages en nature du personnel non national
6628|Autres rémunérations directes du personnel non national
663|Indemnités forfaitaires versées au personnel
6631|Indemnités de logement
6632|Indemnités de représentation
6633|Indemnités d'expatriation
6634|Indemnités de transport
6638|Autres indemnités et avantages divers
664|Charges sociales
6641|Charges sociales sur rémunérations du personnel national
6642|Charges sociales sur rémunérations du personnel non national
666|Rémunérations et charges sociales de l'exploitant individuel
6661|Rémunérations du travail de l'exploitant
6662|Charges sociales de l'exploitant
667|Rémunération transférée de personnel extérieur
6671|Personnel intérimaire
6672|Personnel détaché ou prêté à l'entité
668|Autres charges sociales
6681|Versements aux syndicats et comités d'entreprise
6682|Versements aux comités d'hygiène et de sécurité
6683|Versements et contributions aux autres œuvres sociales
6684|Médecine du travail et pharmacie
6685|Assurances et organismes de santé
6686|Assurances retraite et prévoyance
6687|Assurances chômage
6688|Autres charges sociales diverses
67|Frais financiers et charges assimilées
671|Intérêts des emprunts
6711|Intérêts des emprunts obligataires
6712|Intérêts des emprunts auprès des établissements de crédit
6713|Intérêts des dettes liées à des participations
6714|Primes de remboursement des obligations
672|Intérêts dans loyers de location-acquisition
6722|Intérêts dans loyers de crédit-bail immobilier
6723|Intérêts dans loyers de crédit-bail mobilier
6724|Intérêts dans loyers de location-vente
6728|Intérêts dans loyers des autres contrats
673|Escomptes accordés
674|Autres intérêts
6741|Intérêts sur avances reçues et dépôts créditeurs
6742|Intérêts sur comptes courants bloqués
6743|Intérêts sur obligations cautionnées
6744|Intérêts sur dettes commerciales
6745|Intérêts bancaires et sur opérations de financement
6748|Intérêts sur dettes diverses
675|Escomptes des effets de commerce
676|Pertes de change financières
677|Pertes sur titres de placement
6771|Pertes sur cessions de titres de placement
6772|Malis provenant d'attribution gratuite d'actions au personnel
678|Pertes et charges sur risques financiers
6781|Pertes sur rentes viagères
6782|Pertes sur opérations financières
6784|Pertes sur instruments de trésorerie
679|Charges pour dépréciations et provisions pour risques à court terme financiers
6791|Charges pour provisions sur risques financiers
6795|Charges pour dépréciations sur titres de placement
6798|Autres charges pour dépréciations financières
68|Dotations aux amortissements
681|Dotations aux amortissements d'exploitation
6812|Dotations aux amortissements des immobilisations incorporelles
6813|Dotations aux amortissements des immobilisations corporelles
69|Dotations aux provisions et aux dépréciations
691|Dotations aux provisions et aux dépréciations d'exploitation
6911|Dotations aux provisions pour risques et charges d'exploitation
6913|Dotations aux dépréciations des immobilisations incorporelles
6914|Dotations aux dépréciations des immobilisations corporelles
697|Dotations aux provisions et aux dépréciations financières
6971|Dotations aux provisions pour risques et charges financiers
6972|Dotations aux dépréciations des immobilisations financières
7|Comptes de produits des activités ordinaires
70|Ventes
701|Ventes de marchandises
7011|Ventes de marchandises dans la région
7012|Ventes de marchandises hors région
7013|Ventes de marchandises aux entités du groupe de la région
7014|Ventes de marchandises aux entités du groupe hors région
7015|Ventes de marchandises sur internet
7019|Rabais, remises et ristournes accordés sur ventes de marchandises
702|Ventes de produits finis
703|Ventes de produits intermédiaires
704|Ventes de produits résiduels
705|Travaux facturés
706|Services vendus
7061|Services vendus dans la région
7062|Services vendus hors région
7063|Services vendus aux entités du groupe de la région
7064|Services vendus aux entités du groupe hors région
7069|Rabais, remises et ristournes accordés sur services vendus
707|Produits accessoires
7071|Ports, emballages perdus et autres frais facturés
7072|Commissions et courtages
7073|Locations
7074|Bonis sur reprises et cessions d'emballages
7075|Mise à disposition de personnel
7076|Redevances pour brevets, logiciels, marques et droits similaires
7077|Services exploités dans l'intérêt du personnel
7078|Autres produits accessoires
71|Subventions d'exploitation
711|Subventions d'exploitation sur produits à l'exportation
712|Subventions d'exploitation sur produits à l'importation
713|Subventions d'exploitation sur produits de grande consommation
714|Subventions d'exploitation pour charges sociales
718|Autres subventions d'exploitation
7181|Subventions d'exploitation versées par l'État et les collectivités publiques
7182|Subventions d'exploitation versées par les organismes internationaux
7183|Subventions d'exploitation versées par des tiers
72|Production immobilisée
721|Production immobilisée : immobilisations incorporelles
722|Production immobilisée : immobilisations corporelles
724|Production auto-consommée
726|Production immobilisée : immobilisations financières
73|Variations des stocks de biens et de services produits
734|Variations des stocks de produits en cours
735|Variations des en-cours de services
736|Variations des stocks de produits finis
737|Variations des stocks de produits intermédiaires et résiduels
75|Autres produits
751|Profits sur créances clients et autres débiteurs
752|Quote-part de résultat sur opérations faites en commun
754|Produits des cessions courantes d'immobilisations
7541|Produits des cessions courantes d'immobilisations incorporelles
7542|Produits des cessions courantes d'immobilisations corporelles
756|Gains de change sur créances et dettes commerciales
758|Produits divers
7581|Indemnités de fonction et autres rémunérations d'administrateurs
7582|Indemnités d'assurances reçues
7588|Autres produits divers
759|Reprises de charges pour dépréciations et provisions pour risques à court terme d'exploitation
7591|Reprises sur provisions sur risques sur ventes
7593|Reprises sur dépréciations des stocks
7594|Reprises sur dépréciations des créances
7598|Reprises sur autres provisions pour risques à court terme
77|Revenus financiers et assimilés
771|Intérêts de prêts et créances diverses
7712|Intérêts de prêts
7713|Intérêts sur créances diverses
772|Revenus de participations et autres titres immobilisés
7721|Revenus de titres de participation
7722|Revenus d'autres titres immobilisés
773|Escomptes obtenus
774|Revenus de titres de placement
775|Intérêts dans loyers de location-financement
776|Gains de change financiers
777|Gains sur cessions de titres de placement
778|Gains sur risques financiers
7781|Gains sur rentes viagères
7782|Gains sur opérations financières
7784|Gains sur instruments de trésorerie
779|Reprises de charges pour dépréciations et provisions financières
7791|Reprises de provisions sur risques financiers
7795|Reprises de dépréciations sur titres de placement
7798|Autres reprises de dépréciations financières
78|Transferts de charges
781|Transferts de charges d'exploitation
787|Transferts de charges financières
79|Reprises de provisions, de dépréciations et autres
791|Reprises de provisions, de dépréciations et autres d'exploitation
7911|Reprises de provisions pour risques et charges d'exploitation
7913|Reprises de dépréciations des immobilisations incorporelles
7914|Reprises de dépréciations des immobilisations corporelles
797|Reprises de provisions et dépréciations financières
7971|Reprises de provisions pour risques et charges financiers
7972|Reprises de dépréciations des immobilisations financières
798|Reprises d'amortissements
799|Reprises de subventions d'investissement
8|Comptes des autres charges et des autres produits
81|Valeurs comptables des cessions d'immobilisations
811|Valeurs comptables des cessions d'immobilisations incorporelles
812|Valeurs comptables des cessions d'immobilisations corporelles
816|Valeurs comptables des cessions d'immobilisations financières
82|Produits des cessions d'immobilisations
821|Produits des cessions d'immobilisations incorporelles
822|Produits des cessions d'immobilisations corporelles
826|Produits des cessions d'immobilisations financières
83|Charges hors activités ordinaires
831|Charges HAO constatées
833|Charges HAO sur exercices antérieurs
835|Dons et libéralités accordés
836|Abandons de créances consentis
837|Charges liées aux opérations de restructuration
838|Autres charges HAO
839|Charges pour dépréciations et provisions pour risques à court terme HAO
84|Produits hors activités ordinaires
841|Produits HAO constatés
843|Produits HAO sur exercices antérieurs
845|Dons et libéralités obtenus
846|Abandons de créances obtenus
847|Produits liés aux opérations de restructuration
848|Autres produits HAO
849|Reprises de charges pour dépréciations et provisions pour risques à court terme HAO
85|Dotations hors activités ordinaires
851|Dotations aux provisions réglementées
852|Dotations aux amortissements HAO
853|Dotations aux dépréciations HAO
854|Dotations aux provisions pour risques et charges HAO
858|Autres dotations HAO
86|Reprises hors activités ordinaires
861|Reprises de provisions réglementées
862|Reprises d'amortissements HAO
863|Reprises de dépréciations HAO
864|Reprises de provisions pour risques et charges HAO
865|Reprises de subventions d'investissement
868|Autres reprises HAO
87|Participation des travailleurs
871|Participation légale aux bénéfices
872|Participation contractuelle aux bénéfices
878|Autres participations
88|Subventions et provisions d'équilibre
881|Subventions d'équilibre : État
882|Subventions d'équilibre : collectivités publiques
883|Subventions d'équilibre : groupe et associés
884|Subventions d'équilibre : autres
89|Impôts sur le résultat
891|Impôts sur les bénéfices de l'exercice
8911|Impôts sur les bénéfices : activités exercées dans l'État
8912|Impôts sur les bénéfices : activités exercées dans les autres États de la région
8913|Impôts sur les bénéfices : activités exercées hors région
892|Rappel d'impôts sur résultats antérieurs
895|Impôt minimum forfaitaire (IMF)
899|Dégrèvements d'impôts sur résultats antérieurs
9|Comptes des engagements hors bilan et de la comptabilité analytique
`;

const LIGNES_PARSEES = LIGNES.split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const i = l.indexOf("|");
    return { prefixe: l.slice(0, i), libelle: l.slice(i + 1) };
  });

const ENSEMBLE_PREFIXES = LIGNES_PARSEES.map((l) => l.prefixe);

/** Vrai si aucun autre numero de la liste ne commence par `prefixe` (compte feuille). */
function estFeuille(prefixe) {
  return !ENSEMBLE_PREFIXES.some((p) => p !== prefixe && p.startsWith(prefixe));
}

/**
 * Titres de regroupement (comptes non imputables : classes, comptes
 * principaux, divisionnaires et tout compte ayant des descendants) sous la
 * forme { "21": "Immobilisations incorporelles", ... } - utilises pour les
 * lignes de sous-total des balances et du grand livre.
 */
const REGROUPEMENTS = {};
for (const l of LIGNES_PARSEES) {
  REGROUPEMENTS[l.prefixe] = l.libelle;
}

/** Sens normal d'un compte (D debit / C credit), indicatif - null si variable. */
function sensNormal(num) {
  const c = num[0];
  const p2 = num.slice(0, 2);
  const p3 = num.slice(0, 3);
  if (c === "1") return ["109", "129"].includes(p3) || p3 === "139" ? "D" : "C";
  if (c === "2") return ["28", "29"].includes(p2) ? "C" : "D";
  if (c === "3") return p2 === "39" ? "C" : "D";
  if (c === "4") {
    if (p2 === "40") return p3 === "409" ? "D" : "C";
    if (p2 === "41") return p3 === "419" ? "C" : "D";
    if (p2 === "49") return p3 === "499" ? "C" : "C";
    return null;
  }
  if (c === "5") return ["56", "59"].includes(p2) ? "C" : "D";
  if (c === "6") return "D";
  if (c === "7") return "C";
  if (c === "8") return ["82", "84", "86", "88"].includes(p2) ? "C" : "D";
  return null;
}

function natureCompte(num) {
  const p2 = num.slice(0, 2);
  if (p2 === "40") return "COLLECTIF_FOURNISSEUR";
  if (p2 === "41") return "COLLECTIF_CLIENT";
  if (["51", "52", "53", "55", "57", "58"].includes(p2)) return "TRESORERIE";
  return "GENERAL";
}

/**
 * Comptes imputables a creer pour une longueur de numero donnee (8 par
 * defaut). Retourne [{ numero, libelle, classe, nature, sens_normal,
 * lettrable, tiers_obligatoire, analytique }].
 */
function comptesImputables(longueur = 8) {
  const comptes = [];
  for (const l of LIGNES_PARSEES) {
    if (l.prefixe.length < 2) continue; // les classes sont des titres
    if (!estFeuille(l.prefixe)) continue;
    const numero = l.prefixe.padEnd(longueur, "0");
    const nature = natureCompte(l.prefixe);
    const p2 = l.prefixe.slice(0, 2);
    comptes.push({
      numero,
      libelle: l.libelle,
      classe: Number(l.prefixe[0]),
      nature,
      sens_normal: sensNormal(l.prefixe),
      lettrable: ["40", "41", "42", "43", "44", "45", "46", "47", "48"].includes(p2),
      tiers_obligatoire: nature === "COLLECTIF_FOURNISSEUR" || nature === "COLLECTIF_CLIENT",
      analytique: l.prefixe[0] === "6" || l.prefixe[0] === "7",
    });
  }
  return comptes;
}

/**
 * Libelle du titre de regroupement pour un prefixe (1 a 3 chiffres), ou
 * null. Les libelles de classe (1 chiffre) sont aussi dans REGROUPEMENTS.
 */
function libelleRegroupement(prefixe) {
  return REGROUPEMENTS[prefixe] || null;
}

module.exports = { comptesImputables, libelleRegroupement, REGROUPEMENTS, sensNormal, natureCompte };
