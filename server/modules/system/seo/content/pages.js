'use strict';

/**
 * LOUMOO — the public French content pages (guides + About).
 * ---------------------------------------------------------------------------
 * Four standalone, server-rendered documents that answer real search intents with
 * original French copy and link into the marketplace. They are NOT shell screens:
 * each is a static HTML document (built into public/pages/, rendered on demand by the
 * gateway) so a crawler gets the whole page in the first response.
 *
 *   /marketplace-cameroun         the pillar: what LOUMOO is, how to judge an e-commerce
 *                                 platform in Cameroon, what is on the marketplace today
 *   /acheter-en-ligne-cameroun    buyer guide (the real order flow)
 *   /vendre-en-ligne-cameroun     seller guide (the real boutique + publishing flow)
 *   /a-propos                     the brand page
 *
 * EDITORIAL RULES (tests/unit/seo_search_dominance.test.js pins the checkable ones):
 *   - A feature appears here ONLY if the code implements it today. Payment is "à la
 *     livraison" (checkout copy: nothing is charged online; the buyer confirms with a
 *     delivery code) - never Mobile Money / card prepayment, escrow or instant payouts.
 *   - No superlative or ranking claim ("meilleur", "n°1", "leader"): LOUMOO is not
 *     entitled to one, and the FAQ says so plainly.
 *   - No statistic that is not computed from the catalogue at render time, no
 *     testimonial, no rating, no address/phone/registration number.
 *   - Prices, fees and delivery zones are not stated: nothing in the repository fixes them.
 *
 * `updated` is the date the copy was last reviewed against the code; it feeds
 * <lastmod> and dateModified, so bump it when the text changes.
 *
 * Block types (rendered by ./render.js):
 *   { t: 'p', text }                      paragraph (inline: **bold**, [label](/path))
 *   { t: 'list', items: [text] }          bullet list
 *   { t: 'steps', items: [{title,text}] } numbered steps
 *   { t: 'cards', items: [{title,text,link?:{label,path}}] }
 *   { t: 'categories' }                   live category directory (names + product counts)
 *   { t: 'products', n }                  live featured products (real pages)
 *   { t: 'store' }                        the house store card (NanoAfrica)
 */

const PAGES = [
  {
    id: 'marketplace-cameroun',
    routeId: 'guideMarketplace',
    path: '/marketplace-cameroun',
    shortName: 'Marketplace Cameroun',
    title: 'Marketplace et plateforme e-commerce au Cameroun',
    description: 'LOUMOO est une marketplace au Cameroun : explorez des centaines de produits, comparez, commandez avec paiement à la livraison ou ouvrez votre boutique.',
    updated: '2026-10-21',
    schemaType: 'WebPage',
    eyebrow: 'Marketplace Cameroun',
    h1: 'La marketplace pour acheter et vendre en ligne au Cameroun',
    lead: 'LOUMOO réunit au même endroit des boutiques, des produits, des services, des voyages et des hôtels. Les acheteurs trouvent, comparent et commandent ; les vendeurs ouvrent une boutique en ligne et atteignent leurs clients.',
    ctas: [
      { label: 'Explorer les produits', path: '/marketplace', kind: 'primary' },
      { label: 'Vendre sur LOUMOO', path: '/vendre-en-ligne-cameroun', kind: 'secondary' }
    ],
    sections: [
      {
        h2: 'Qu’est-ce que LOUMOO ?',
        blocks: [
          { t: 'p', text: 'LOUMOO est une marketplace en ligne conçue pour le Cameroun. Avec un seul compte, vous pouvez **acheter** des produits auprès de boutiques identifiées, **réserver** un hôtel ou un voyage, ou **vendre** vos propres produits et services depuis votre boutique en ligne.' },
          { t: 'p', text: 'Les prix sont affichés en francs CFA (FCFA). Chaque commande se gère dans l’application : suivi de la livraison et messagerie avec la boutique.' }
        ]
      },
      {
        h2: 'Comment choisir une plateforme e-commerce au Cameroun ?',
        intro: 'Aucun classement officiel ne désigne « la meilleure plateforme » : la bonne question est de savoir ce qui compte pour vous. Voici les critères que nous recommandons de vérifier, et ce que LOUMOO propose sur chacun.',
        blocks: [
          {
            t: 'cards',
            items: [
              { title: 'Savoir à qui vous achetez', text: 'Chaque produit appartient à une boutique visible sur la plateforme. Les boutiques qui ont fait vérifier leurs documents (CNI, RCCM) affichent un badge de vérification ; cette étape reste facultative pour ouvrir une boutique.', link: { label: 'Voir les boutiques', path: '/stores' } },
              { title: 'Payer sans risque', text: 'Le paiement se fait à la livraison : rien n’est débité avant que le livreur vous remette la commande et que vous la confirmiez avec votre code de livraison.' },
              { title: 'Suivre sa commande', text: 'Le suivi de livraison et l’historique des commandes sont disponibles dans votre compte, de la commande à la réception.' },
              { title: 'Parler au vendeur', text: 'Une messagerie intégrée permet d’échanger avec la boutique avant ou après l’achat, sans quitter LOUMOO.' },
              { title: 'Comparer avant d’acheter', text: 'Le comparateur met des produits côte à côte : caractéristiques, prix et points forts.', link: { label: 'Comparer des produits', path: '/compare' } },
              { title: 'Vendre facilement', text: 'Créer une boutique, publier un produit ou un service et gérer ses commandes se fait depuis le même compte.', link: { label: 'Guide du vendeur', path: '/vendre-en-ligne-cameroun' } }
            ]
          }
        ]
      },
      {
        h2: 'Pour les acheteurs : trouver, comparer, commander',
        blocks: [
          {
            t: 'steps',
            items: [
              { title: 'Explorez', text: 'Parcourez les [catégories](/marketplace/categories) ou recherchez un produit dans le [marketplace](/marketplace).' },
              { title: 'Comparez', text: 'Ouvrez les fiches produits et utilisez le [comparateur](/compare) pour départager deux ou trois modèles.' },
              { title: 'Commandez', text: 'Ajoutez au panier, indiquez votre adresse de livraison et choisissez le moyen de paiement que vous utiliserez à la livraison.' },
              { title: 'Recevez et confirmez', text: 'Suivez la livraison, vérifiez votre commande à la réception puis confirmez avec votre code de livraison.' }
            ]
          },
          { t: 'p', text: 'Le détail de chaque étape est expliqué dans notre [guide pour acheter en ligne au Cameroun](/acheter-en-ligne-cameroun).' }
        ]
      },
      {
        h2: 'Pour les vendeurs : ouvrir sa boutique en ligne',
        blocks: [
          { t: 'p', text: 'Commerçants, créateurs, producteurs locaux et prestataires de services peuvent ouvrir une boutique sur LOUMOO, publier des produits ou des services avec photos, prix et description, puis recevoir et suivre leurs commandes. La livraison peut être organisée avec des livreurs ou des agences de livraison.' },
          { t: 'p', text: 'Toutes les étapes sont détaillées dans le guide [vendre en ligne au Cameroun](/vendre-en-ligne-cameroun).' }
        ]
      },
      {
        h2: 'Ce que vous trouvez aujourd’hui sur LOUMOO',
        intro: 'Les catégories ci-dessous sont celles qui contiennent des produits à la date de cette page.',
        blocks: [
          { t: 'categories' },
          { t: 'store' },
          { t: 'products', n: 8 }
        ]
      },
      {
        h2: 'Voyages et hôtels',
        blocks: [
          { t: 'p', text: 'LOUMOO ne se limite pas aux produits : vous pouvez aussi [rechercher un hôtel](/hotels) au Cameroun et consulter les offres de [voyage](/travel) (bus, vols, forfaits et assistance visa).' }
        ]
      }
    ],
    faq: [
      { q: 'LOUMOO est-elle la meilleure plateforme e-commerce du Cameroun ?', a: 'Il n’existe pas de classement officiel et LOUMOO ne prétend pas en détenir un. Pour choisir, comparez les plateformes sur des critères concrets : identité des vendeurs, mode de paiement, suivi de livraison, messagerie avec la boutique et outils pour vendre. Explorez LOUMOO et jugez sur pièces.' },
      { q: 'Comment payer sur LOUMOO ?', a: 'Le paiement se fait à la livraison. Au moment de commander, vous indiquez le moyen que vous utiliserez à la réception ; rien n’est débité en ligne avant la livraison.' },
      { q: 'Faut-il un compte pour acheter ?', a: 'Vous pouvez explorer les produits sans compte. Un compte est nécessaire pour passer commande, suivre vos livraisons et échanger avec une boutique.' },
      { q: 'Comment vendre sur LOUMOO ?', a: 'Créez un compte, ouvrez votre boutique, puis publiez vos produits ou services. Le guide du vendeur détaille chaque étape.' },
      { q: 'Faut-il faire vérifier sa boutique ?', a: 'Non, la vérification est facultative : une boutique peut être mise en ligne sans elle. Elle apporte un badge de confiance une fois vos documents validés.' },
      { q: 'Comment contacter une boutique ?', a: 'Depuis la fiche d’un produit ou la page d’une boutique, utilisez la messagerie de LOUMOO (connexion requise).' }
    ],
    related: ['guideBuy', 'guideSell', 'about']
  },

  {
    id: 'acheter-en-ligne-cameroun',
    routeId: 'guideBuy',
    path: '/acheter-en-ligne-cameroun',
    shortName: 'Acheter en ligne',
    title: 'Acheter en ligne au Cameroun : le guide pas à pas',
    description: 'Comment acheter en ligne au Cameroun sur LOUMOO : trouver un produit, comparer, commander, payer à la livraison avec votre code et suivre votre commande.',
    updated: '2026-10-21',
    schemaType: 'WebPage',
    eyebrow: 'Guide acheteur',
    h1: 'Acheter en ligne au Cameroun : le guide pas à pas',
    lead: 'De la recherche d’un produit à la confirmation de la livraison : voici comment commander sur LOUMOO, ce que vous payez et quand, et comment acheter en confiance.',
    ctas: [
      { label: 'Parcourir les produits', path: '/marketplace', kind: 'primary' },
      { label: 'Toutes les catégories', path: '/marketplace/categories', kind: 'secondary' }
    ],
    sections: [
      {
        h2: 'Les étapes d’une commande sur LOUMOO',
        blocks: [
          {
            t: 'steps',
            items: [
              { title: 'Créez votre compte', text: 'Vous pouvez explorer sans compte. Pour commander, [créez un compte](/onboarding) : il sert aussi à suivre vos livraisons et à écrire aux boutiques.' },
              { title: 'Trouvez le bon produit', text: 'Utilisez le [marketplace](/marketplace) ou les [catégories](/marketplace/categories). Chaque fiche indique le prix en FCFA, la description et la boutique qui vend le produit.' },
              { title: 'Comparez', text: 'Mettez plusieurs produits côte à côte avec le [comparateur](/compare) pour comparer caractéristiques et prix.' },
              { title: 'Passez commande', text: 'Ajoutez au panier, renseignez votre adresse de livraison et choisissez le moyen de paiement que vous utiliserez à la réception (Mobile Money ou carte, selon les options proposées).' },
              { title: 'Suivez la livraison', text: 'Depuis votre compte, suivez l’avancement de la commande et la livraison.' },
              { title: 'Confirmez à la réception', text: 'Vérifiez votre commande, puis confirmez avec votre code de livraison : c’est à ce moment que vous payez.' }
            ]
          }
        ]
      },
      {
        h2: 'Comment fonctionne le paiement à la livraison ?',
        blocks: [
          { t: 'p', text: 'Sur LOUMOO, le paiement se fait à la livraison : rien n’est débité en ligne au moment de la commande. Vous choisissez à l’avance le moyen de paiement que vous utiliserez, puis vous payez à la réception, quand vous confirmez la livraison avec votre code.' },
          { t: 'p', text: 'Conservez ce code pour vous : il est destiné au livreur uniquement au moment de la remise de votre commande.' }
        ]
      },
      {
        h2: 'Acheter en confiance : nos conseils',
        blocks: [
          {
            t: 'list',
            items: [
              'Regardez la boutique qui vend : sa page présente ses produits, et un badge indique si elle a fait vérifier ses documents.',
              'Lisez la fiche complète du produit (caractéristiques, état, photos) avant de commander.',
              'Posez vos questions à la boutique avec la messagerie de LOUMOO plutôt que par un canal extérieur : l’échange reste attaché à votre commande.',
              'Vérifiez votre commande avant de donner le code de livraison.',
              'Comparez deux ou trois offres : le comparateur est là pour ça.'
            ]
          }
        ]
      },
      {
        h2: 'Que peut-on acheter sur LOUMOO ?',
        intro: 'Les catégories qui contiennent des produits à la date de cette page :',
        blocks: [
          { t: 'categories' },
          { t: 'products', n: 6 }
        ]
      },
      {
        h2: 'Au-delà des produits',
        blocks: [
          { t: 'p', text: 'Besoin de voyager ? Parcourez les [hôtels](/hotels) et les offres de [voyage](/travel) disponibles sur LOUMOO. Pour une vue d’ensemble de la plateforme, lisez notre page [marketplace au Cameroun](/marketplace-cameroun).' }
        ]
      }
    ],
    faq: [
      { q: 'Faut-il un compte pour commander sur LOUMOO ?', a: 'Oui. Vous pouvez parcourir les produits librement, mais passer commande, suivre une livraison et écrire à une boutique demandent un compte.' },
      { q: 'Quand est-ce que je paie ?', a: 'À la livraison. Aucun prélèvement n’est fait en ligne au moment de la commande ; le paiement a lieu à la réception, quand vous confirmez avec votre code de livraison.' },
      { q: 'Dans quelle monnaie sont affichés les prix ?', a: 'En francs CFA (FCFA).' },
      { q: 'Comment suivre ma commande ?', a: 'Dans votre compte, la page de la commande indique son avancement et donne accès au suivi de la livraison.' },
      { q: 'Puis-je poser une question au vendeur avant d’acheter ?', a: 'Oui, avec la messagerie intégrée depuis la fiche produit ou la page de la boutique (connexion requise).' }
    ],
    related: ['guideMarketplace', 'guideSell', 'about']
  },

  {
    id: 'vendre-en-ligne-cameroun',
    routeId: 'guideSell',
    path: '/vendre-en-ligne-cameroun',
    shortName: 'Vendre en ligne',
    title: 'Vendre en ligne au Cameroun : ouvrir sa boutique',
    description: 'Ouvrez votre boutique en ligne sur LOUMOO : publiez vos produits ou services, recevez les commandes et organisez la livraison au Cameroun.',
    updated: '2026-10-21',
    schemaType: 'WebPage',
    eyebrow: 'Guide vendeur',
    h1: 'Vendre en ligne au Cameroun : ouvrir sa boutique sur LOUMOO',
    lead: 'Commerçant, créateur, producteur local ou prestataire de services : voici comment ouvrir une boutique en ligne sur LOUMOO, publier vos offres et gérer vos commandes depuis un seul compte.',
    ctas: [
      { label: 'Créer mon compte', path: '/onboarding', kind: 'primary' },
      { label: 'Voir des boutiques', path: '/stores', kind: 'secondary' }
    ],
    sections: [
      {
        h2: 'Qui peut vendre sur LOUMOO ?',
        blocks: [
          { t: 'p', text: 'Une boutique LOUMOO peut être celle d’un indépendant, d’un commerce, d’une marque, d’une agence ou d’une organisation. Vous pouvez publier des **produits** comme des **services** : le formulaire de publication s’adapte à ce que vous proposez.' },
          { t: 'p', text: 'Vous produisez localement ou vous proposez une prestation ? Publiez-la comme n’importe quelle autre offre : les acheteurs la retrouvent par catégorie, par recherche et sur la page de votre boutique.' }
        ]
      },
      {
        h2: 'Ouvrir sa boutique en ligne en cinq étapes',
        blocks: [
          {
            t: 'steps',
            items: [
              { title: 'Créez votre compte', text: 'L’[inscription](/onboarding) vous permet d’acheter comme de vendre : un seul compte pour tout.' },
              { title: 'Créez votre boutique', text: 'Choisissez son nom, son type (boutique, indépendant, agence, marque…) et sa catégorie, puis renseignez ses informations de base.' },
              { title: 'Activez-la', text: 'L’assistant d’activation vous guide pour compléter votre boutique. Elle peut être mise en ligne sans vérification officielle.' },
              { title: 'Publiez vos offres', text: 'Ajoutez des photos, une description, un prix en FCFA et, pour un produit, votre stock. Vérifiez l’aperçu, puis publiez.' },
              { title: 'Recevez et traitez vos commandes', text: 'Chaque commande apparaît dans votre espace vendeur, où vous la suivez jusqu’à la livraison.' }
            ]
          }
        ]
      },
      {
        h2: 'Livraison et paiement',
        blocks: [
          { t: 'p', text: 'Pour livrer vos clients, vous pouvez faire appel à des livreurs ou à des agences de livraison depuis votre espace vendeur ; l’acheteur suit l’avancement de sa commande.' },
          { t: 'p', text: 'Côté paiement, l’acheteur règle à la livraison : il confirme la réception avec un code de livraison, ce qui rassure vos clients dès leur première commande.' }
        ]
      },
      {
        h2: 'Gagner la confiance des acheteurs',
        blocks: [
          {
            t: 'cards',
            items: [
              { title: 'Faites vérifier votre boutique', text: 'En envoyant vos documents (CNI, RCCM), vous obtenez à terme un badge de vérification. C’est facultatif : votre boutique peut être en ligne sans.' },
              { title: 'Soignez vos fiches', text: 'Des photos nettes, une description précise et un prix clair en FCFA rassurent et évitent les questions.' },
              { title: 'Répondez aux messages', text: 'Les acheteurs peuvent vous écrire depuis votre fiche ou votre boutique. Une réponse rapide fait souvent la différence.' }
            ]
          }
        ]
      },
      {
        h2: 'Des boutiques déjà présentes',
        blocks: [
          { t: 'store' },
          { t: 'p', text: 'Découvrez comment les produits sont présentés dans les [catégories](/marketplace/categories) avant de publier les vôtres.' }
        ]
      }
    ],
    faq: [
      { q: 'Faut-il une entreprise enregistrée pour ouvrir une boutique ?', a: 'Votre boutique peut être mise en ligne sans vérification officielle. Vos obligations de commerçant restent toutefois les vôtres. La vérification (CNI, RCCM) est facultative et ajoute un badge de confiance.' },
      { q: 'Que puis-je vendre ?', a: 'Des produits et des services. Les offres sont rangées par catégorie et publiées avec photos, description et prix en FCFA.' },
      { q: 'Comment mes clients me paient-ils ?', a: 'À la livraison : l’acheteur paie à la réception de sa commande, après l’avoir confirmée avec son code de livraison.' },
      { q: 'Comment livrer mes commandes ?', a: 'Depuis votre espace vendeur, vous pouvez organiser la livraison avec des livreurs ou des agences de livraison. L’acheteur suit la commande dans l’application.' },
      { q: 'Les acheteurs peuvent-ils me poser des questions ?', a: 'Oui, avec la messagerie intégrée de LOUMOO, depuis votre fiche produit ou la page de votre boutique.' },
      { q: 'Puis-je vendre des services et pas seulement des produits ?', a: 'Oui. Le formulaire de publication propose un parcours dédié aux services.' }
    ],
    related: ['guideMarketplace', 'guideBuy', 'about']
  },

  {
    id: 'a-propos',
    routeId: 'about',
    path: '/a-propos',
    shortName: 'À propos',
    title: 'À propos de LOUMOO, la marketplace du Cameroun',
    description: 'LOUMOO est une marketplace en ligne qui réunit acheteurs, boutiques, prestataires, hôtels et voyages au Cameroun. Découvrez la plateforme.',
    updated: '2026-10-21',
    schemaType: 'AboutPage',
    eyebrow: 'À propos',
    h1: 'À propos de LOUMOO',
    lead: 'LOUMOO est une marketplace en ligne qui met en relation acheteurs, boutiques, prestataires de services, hôtels et voyages au Cameroun, dans une seule application.',
    ctas: [
      { label: 'Explorer le marketplace', path: '/marketplace', kind: 'primary' },
      { label: 'Ouvrir une boutique', path: '/vendre-en-ligne-cameroun', kind: 'secondary' }
    ],
    sections: [
      {
        h2: 'Ce que propose LOUMOO',
        blocks: [
          {
            t: 'cards',
            items: [
              { title: 'Acheter', text: 'Des produits de boutiques identifiées, classés par catégorie, avec comparateur, panier et suivi de commande.', link: { label: 'Guide acheteur', path: '/acheter-en-ligne-cameroun' } },
              { title: 'Vendre', text: 'Une boutique en ligne pour publier produits et services, recevoir les commandes et organiser la livraison.', link: { label: 'Guide vendeur', path: '/vendre-en-ligne-cameroun' } },
              { title: 'Voyager', text: 'Des hôtels et des offres de voyage (bus, vols, forfaits, assistance visa) accessibles depuis le même compte.', link: { label: 'Voir les hôtels', path: '/hotels' } }
            ]
          }
        ]
      },
      {
        h2: 'Comment ça marche',
        blocks: [
          {
            t: 'steps',
            items: [
              { title: 'Un compte pour tout', text: 'Le même compte sert à acheter, vendre et réserver.' },
              { title: 'Des commandes suivies', text: 'De la commande à la réception, le statut est visible dans l’application, avec un code de livraison pour confirmer la remise.' },
              { title: 'Un échange direct', text: 'Acheteurs et boutiques communiquent par la messagerie intégrée.' }
            ]
          }
        ]
      },
      {
        h2: 'Confiance et transparence',
        blocks: [
          {
            t: 'list',
            items: [
              'Chaque produit est rattaché à une boutique visible sur la plateforme.',
              'La vérification d’une boutique (CNI, RCCM) est facultative et se traduit par un badge, jamais présumée.',
              'Le paiement se fait à la livraison : aucun débit en ligne avant la réception.'
            ]
          }
        ]
      },
      {
        h2: 'La boutique officielle NanoAfrica',
        blocks: [
          { t: 'store' }
        ]
      },
      {
        h2: 'Explorer LOUMOO',
        blocks: [
          {
            t: 'list',
            items: [
              '[Le marketplace](/marketplace) et ses [catégories](/marketplace/categories)',
              '[Les boutiques](/stores)',
              '[Les hôtels](/hotels) et les [voyages](/travel)',
              '[La marketplace au Cameroun, présentée en détail](/marketplace-cameroun)'
            ]
          }
        ]
      }
    ],
    faq: [
      { q: 'Qu’est-ce que LOUMOO ?', a: 'Une marketplace en ligne pour le Cameroun : on y achète auprès de boutiques, on y ouvre sa propre boutique et on y réserve hôtels et voyages avec un seul compte.' },
      { q: 'LOUMOO vend-elle elle-même des produits ?', a: 'Le catalogue de départ est celui de NanoAfrica, la boutique officielle de LOUMOO, livrée par l’agence nanoDelivery. Les autres boutiques sont gérées par leurs propres vendeurs.' },
      { q: 'Comment payer ?', a: 'À la livraison. Aucun débit n’a lieu en ligne au moment de la commande.' },
      { q: 'Comment ouvrir une boutique ?', a: 'Créez un compte puis suivez l’assistant de création de boutique. Le guide du vendeur détaille les étapes.' }
    ],
    related: ['guideMarketplace', 'guideBuy', 'guideSell']
  }
];

module.exports = { PAGES };
