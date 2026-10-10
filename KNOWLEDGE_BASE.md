# BASE DE CONNAISSANCES DU MOTEUR D'EXTRACTION DE CONTACTS

Ce document sert de référentiel de connaissances pour le moteur intelligent d'extraction de contacts (Nom ↔ E-mail). Il sera enrichi à chaque étape du transfert de connaissances ("Brain Transfer").

---

## 1. RÈGLES DE NETTOYAGE ET DE PRÉTRAITEMENT
- **Normalisation des retours à la ligne :** Tous les sauts de ligne (`\r\n`, `\r`) sont normalisés en `\n` pour assurer un comportement prédictif des calculs de distance verticale.
- **Suppression du code source / HTML :** 
  - Nettoyage des balises `<style>` et `<script>` et de leur contenu.
  - Remplacement de toutes les balises HTML restantes par des espaces pour ne pas fausser le calcul de distance de caractères.
  - Décodage des entités HTML courantes (`&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`).

---

## 2. DÉTECTION ET EXTRACTION DE L'EMAIL
- **Expression régulière :** Utilisation d'un motif RFC-compatible optimisé : `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}`.
- **Déduplication :** Garantie de l'unicité de chaque email par fichier source traité pour éviter d'extraire plusieurs fois le même contact si son adresse apparaît à plusieurs endroits (comme dans une chaîne de courriels).

---

## 3. HEURISTIQUES D'ASSOCIATION NOM ↔ EMAIL
- **Voisinage contextuel élargi par Fenêtre Dynamique :**
  - **Fenêtre de recherche :** Analyse de 5 lignes au-dessus de l'email et 3 lignes en dessous pour couvrir tous les cas de figure (signatures, en-têtes, tableaux, listes).
  - **Découpage par Segments :** Division de chaque ligne par des séparateurs courants (`\t`, `,`, `|`, `•`, `-`, `/`, `(`, `)`, `[`, `]`, `:`, `;`) afin de séparer les noms des fonctions professionnelles, départements ou métadonnées.
  - **Système de Rating Heuristique des Candidats (0 à 100+) :**
    - **Patron de capitalisation :** +30 pts si tous les mots du segment commencent par une majuscule ; +15 pts si au moins un mot est capitalisé.
    - **Nombre de mots idéal :** +25 pts si le nom comporte exactement 2 ou 3 mots (ex: "Jean Dupont" ou "Jean-Pierre Dupont") ; +5 pts pour 1 mot ; -20 pts si > 4 mots (évite les phrases).
    - **Proximité physique :** Même ligne (+40 pts), 1 ligne au-dessus (+30 pts), 1 ligne en dessous (+20 pts), 2 lignes au-dessus (+15 pts), 2 lignes en dessous (+10 pts).
    - **Match de préfixe d'email :** +30 pts si le préfixe correspond au segment nettoyé ; +25 pts si l'un des mots du nom est contenu dans le préfixe de l'email.
    - **Patrons d'introduction :** +20 pts si précédé de marqueurs comme `Nom:`, `De:`, `From:`, `M.`, `Mme`, `Dr`, etc.
  - **Sélection :** Le segment obtenant le score maximal au-dessus du seuil de confiance minimum est retenu. À défaut, repli sur l'extraction intelligente du préfixe ou l'étiquette "Inconnu".

---

## 4. FILTRES D'EXCLUSION ET DÉTECTION DU BRUIT
- **Noms parasites exclus (Index élargi) :** Exclusion des mots d'interface, termes techniques et bruits fréquents : `de`, `à`, `sujet`, `date`, `envoyé`, `cordialement`, `téléphone`, `email`, `site web`, `recherche`, `forum`, `sujets`, `messages`, `groupe`, `membres`, `statut`, `profil`, `mot de passe`, `connexion`, `deconnexion`, `home`, `accueil`, `rubrique`, `catégorie`, `commentaires`, `tous droits réservés`, `copyright`, `télécharger`, `téléchargement`, `pièce jointe`, `coordonnées`, `adresse ip`, `navigateur`, `système`, `erreur`, `attention`, `rejoindre`, `publié par`, `posté par`, etc.
- **Filtre de bruit structurel :** 
  - Rejet des lignes trop courtes (< 2 caractères) ou trop longues (> 50 caractères).
  - **Taux de lettres minimum :** Au moins 40 % des caractères doivent être des lettres alphabétiques.
  - **Répétition de caractères :** Détection et exclusion automatique des chaînes de caractères répétées (ex: `---------`, `______`, `aaaaa`).

---

## 5. RECONNAISSANCE ET AJUSTEMENT PAR IA (HYBRIDE)
- **Modèle de référence :** `gemini-3.5-flash` pour concilier rapidité, intelligence contextuelle et résistance aux timeouts.
- **Pipeline asynchrone sécurisé :**
  - Traitement prioritaire des fiches à faible niveau de confiance ou dont le nom est "Inconnu".
  - **Sécurité anti-blocage :** Wrapper avec timeout strict de 12 secondes et réduction du lot d'analyse IA à un maximum de 6 candidats par appel pour éviter les blocages de reverse proxy et garantir une réponse immédiate au client.

---

## 6. LOGIQUE ET CRITÈRES DE SCORING (0 À 100)
Le score de confiance final d'un contact dépend de la somme pondérée de critères qualitatifs :
- **Validité syntaxique de l'email :** Critère de base indispensable.
- **Présence d'un vrai nom :** Bonus de +20 pts si un nom humain est trouvé et validé sans bruit.
- **Proximité physique :**
  - Même ligne : Bonus de +20 pts (Score Distance = 10).
  - Ligne adjacente : Bonus de +15 pts (Score Distance = 8).
  - Deux lignes d'écart : Bonus de +10 pts (Score Distance = 5).
- **Structure Nom-Email compatible :** Bonus de +15 pts si des éléments du nom (initiales, nom de famille) sont identifiables dans le préfixe de l'adresse email.
- **Indice de domaine professionnel :** Bonus de +10 pts si le domaine n'est pas un webmail grand public (gmail, hotmail, yahoo...).
- **Bloc de signature détecté :** Bonus de +10 pts si des termes de politesse ou de signature professionnelle entourent l'extraction.
- **Malus de boîte système :** Retrait de -15 pts si l'email correspond à une adresse générique (`support`, `info`...).
