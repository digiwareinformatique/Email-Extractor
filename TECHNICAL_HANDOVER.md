# Rapport de Passation Technique — Moteur d'Extraction de Contacts (Release Candidate)

Ce document fournit une cartographie technique complète, une analyse de l'architecture et les spécifications de fonctionnement du moteur d'extraction de contacts de la plateforme. Il est destiné au **Lead Developer** afin de lui permettre de reprendre immédiatement la maintenance, l'évolution ou l'optimisation du moteur sans lecture préalable exhaustive du code source.

---

## 1. Cartographie Complète du Moteur

### Fichiers Critiques du Projet
*   **`/server.ts`** : Point d'entrée de l'application serveur Express. Gère l'infrastructure web, le téléversement (limites de tailles fixées à 50 Mo pour supporter de larges fichiers), le routage des requêtes API (`/api/extract`, `/api/config`, `/api/health`) et l'interfaçage avec les services d'extraction.
*   **`/server/extractor.ts`** : Le cœur algorithmique du moteur. Contient l'intégralité des modules de nettoyage du texte, de parsing heuristique, d'Auto-Validation multi-passe, de scoring de confiance, de filtrage anti-bruit et de raffinement par IA (Gemini).
*   **`/src/types.ts`** : Contient l'ensemble des définitions de types TypeScript (interfaces, types de confiance, objets de métriques, structures des statistiques d'analyse du document).
*   **`/src/App.tsx`** : Interface utilisateur React unifiée avec tableau de bord analytique de preuve de lecture, filtres interactifs, et prévisualiseur contextuel.

### Logique et Points de Décision Importants
1.  **Dépistage initial de l'E-mail** : Situé dans `performBaseExtraction()` (l. 325, `extractor.ts`). C'est le point de départ de tout le traitement.
2.  **Choix du Meilleur Candidat de Nom** : Situé dans la boucle d'évaluation de fenêtre de `performBaseExtraction()` (l. 359, `extractor.ts`). C'est ici que sont appliqués les scores de proximité et de forme pour retenir le meilleur segment de nom près d'un e-mail.
3.  **Filtrage Anti-Bruit Système** : Situé dans le handler de route Express dans `/server.ts` (l. 58) et affiné par `verifyNameQuality()` (l. 547, `extractor.ts`).
4.  **Auto-Validation et Correction** : Situé dans `runAutoValidationRound()` (l. 631, `extractor.ts`). Analyse la cohérence globale (ex: doubles associations d'un même nom à des e-mails différents, rejet des titres métier).
5.  **Raffinement IA (Gemini)** : Situé dans `refineContactsWithAI()` (l. 876, `extractor.ts`). Intervient en option finale pour lever les doutes sur les contacts à confiance moyenne/basse.

---

## 2. Pipeline Complet d'Exécution

Lorsqu'un document brut est soumis à l'API (`POST /api/extract`), il traverse le pipeline suivant :

```
[Texte Brut]
     │
     ▼
┌─────────────────────────┐
│  1. Normalisation       │ ◄── cleanText() (Suppression balises HTML en préservant
└────────────┬────────────┘                  les adresses sous angle brackets <...>)
             │
             ▼
┌─────────────────────────┐
│  2. Ingestion Initiale  │ ◄── performBaseExtraction() (Recherche Regex e-mails et
└────────────┬────────────┘                  évaluation de fenêtre de voisinage [-5, +3])
             │
             ▼
┌─────────────────────────┐
│  3. Auto-Validation     │ ◄── runAutoValidationRound() (Boucle auto-correctrice
│   (Multi-passe, max 3)  │                  jusqu'à stabilisation de l'index de contacts)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  4. Option: Filtre Anti-│ ◄── Rejet des adresses système (l. 41, SYSTEM_EMAIL_PREFIXES)
│      Bruit Système      │      et critères l. 556 (interface, adresses, départements)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  5. Option: IA Refine   │ ◄── refineContactsWithAI() (Envoi sélectif des blocs douteux
│      (Gemini-3.5-Flash) │                  à Gemini avec timeout de sauvegarde de 15s)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  6. Analyse Globale     │ ◄── analyzeFileContent() (Extraction de métriques de lecture :
│       du Fichier        │                  lignes réelles, distribution par hébergeur...)
└────────────┬────────────┘
             │
             ▼
 [JSON Résultat Final]
```

---

## 3. Algorithmes de Scoring et Heuristiques

Le moteur calcule pour chaque contact un **Confidence Score** (0 à 100) converti en **Confidence Level** (`High` >= 75, `Medium` >= 45, `Low` < 45).

### Algorithme de Scoring Heuristique (`computeConfidence`)
Le score de base démarre à **30 points** pour un e-mail valide et est ajusté selon les critères suivants :

*   **Présence d'un nom valide** : `+20 points` (si le nom n'est pas "Inconnu" et n'est pas identique au préfixe d'e-mail).
*   **Domaine Corporate** (Professionnel) : `+10 points` (détecté par exclusion des webmails grand public comme Gmail, Yahoo, Outlook, FAI français).
*   **Adresse Système / Spam** : `-15 points` (si le préfixe commence par `support`, `info`, `noreply`, `admin`, etc.).
*   **Distance Ligne-Nom (Proximité)** :
    *   Même ligne : `+20 points` (et note de proximité à 10/10)
    *   Ligne adjacente supérieure (-1) : `+15 points` (note 8/10)
    *   Ligne adjacente inférieure (+1) : `+10 points` (note 5/10)
    *   Distance <= 4 lignes : `+5 points` (note 3/10)
*   **Correspondance Structurelle Nom-Email** : `+15 points` si des éléments du nom (initiales, prénom ou nom) se retrouvent dans le préfixe de l'adresse e-mail (ex: "Jean Dupont" avec `j.dupont@...`).
*   **Indicateurs Contextuels de Signature** : `+10 points` si présence de mots-clés de politesse (`cordialement`, `sincèrement`, `best regards`, `de:`, `tél`) dans le voisinage direct.

---

## 4. Filtres Anti-Bruit et Nettoyage

Pour garantir l'intégrité de la base de contacts, plusieurs couches de filtrage rigoureuses sont appliquées :

1.  **Anti-bruit de segment (`isLikelyNoise`)** : Écarte immédiatement les segments trop courts (< 2) ou trop longs (> 50), ceux contenant majoritairement des chiffres/caractères spéciaux (ratio lettres/longueur < 0.4), et les expressions de navigation Web courantes (`http`, `www`, `cliquez ici`, `mentions légales`, `copyright`).
2.  **Index de mots d'interface (`verifyNameQuality`)** : Rejette systématiquement les libellés de mise en page UI français/anglais (`sujet`, `date`, `envoyé`, `pièce jointe`, `coordonnées`, `ne pas répondre`).
3.  **Détecteur d'adresses postales** : Exclut les segments contenant des indicateurs d'adresse (`rue`, `avenue`, `boulevard`, `chemin`, `cedex`, `bp` ou des codes postaux à 5 chiffres) pour éviter d'associer un bloc d'adresse à un e-mail à proximité.
4.  **Détecteur de Départements et Fonctions** : Écarte les mots de rôles ou départements purs (`marketing`, `service`, `direction`, `rh`, `comptabilité`, `directeur`, `responsable`, `assistant`) lorsqu'ils sont isolés, garantissant que seuls les individus réels soient identifiés comme noms.

---

## 5. Mécanismes d'Auto-Validation et Anti-Régression

### Auto-Validation Multi-Passe (`runAutoValidationRound`)
C'est le mécanisme de validation le plus avancé du moteur. Il s'exécute de façon autonome (sans appel externe) pour résoudre les incohérences de l'analyse séquentielle :
*   **Résolution des Doubles Associations** : Si un même nom est associé à plusieurs e-mails distincts dans le document, l'algorithme compare les scores de confiance de chaque association. Il attribue le nom au contact ayant le score le plus élevé et réévalue le second contact. Le contact perdant repasse automatiquement par une recherche locale (fenêtre [-5, +3]) pour identifier un autre nom disponible, ou à défaut, rétrograde vers un nom dérivé de son préfixe ou "Inconnu".
*   **Cycle Stabilisé** : La boucle s'exécute jusqu'à un maximum de 3 passes ou jusqu'à ce que plus aucune modification ne soit apportée à l'index de contacts (`isStable === true`), prévenant ainsi les oscillations de correction.

### Mécanismes Anti-Régression
*   **Robustesse du Nettoyage HTML** : Le filtre HTML utilise une expression régulière à lookahead négatif `/<(?![a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12})[^>]+>/g` afin de nettoyer les balises de mise en page tout en garantissant qu'aucune adresse e-mail entourée de caractères `<` et `>` (format standard d'en-tête de message) ne soit altérée.
*   **Graceful Fallback d'API** : Le raffinement par IA (Gemini) est encapsulé dans une promesse de course (`Promise.race`) munie d'un **timeout strict de 15 secondes**. Si l'API Gemini subit un ralentissement, une coupure réseau ou si la clé API est absente/invalide, le système intercepte l'erreur, loggue l'alerte et bascule instantanément sur l'extraction heuristique pure et l'auto-validation pour garantir une continuité de service.

---

## 6. Risques Techniques, Limites et Évolutions Futures

### Points Faibles Restants (Risques à surveiller)
1.  **Limites de Tokens Gemini** : En cas d'activation de l'amélioration IA sur des documents géants (> 5 Mo), l'extraction sélective filtre et n'envoie que les **6 candidats les plus incertains** à l'API. C'est une sécurité contre l'explosion des coûts et de la latence, mais cela signifie que les contacts incertains au-delà du rang 6 reposent uniquement sur les heuristiques.
2.  **Ambiguïté Homonymique** : Dans les fichiers contenant des homonymes (ex: deux "Jean Dupont" avec des adresses différentes), l'algorithme de double association peut forcer une correction injustifiée si les deux occurrences sont réelles et distinctes.

### Améliorations Possibles à Moyen/Long Terme
*   **Base de Données de Prénoms (Local) :** Intégrer un dictionnaire de prénoms fréquents (ex: liste INSEE/US Census) pour ajouter un bonus de score de `+15 points` lorsqu'un segment évalué contient un prénom officiel connu, augmentant ainsi la fiabilité heuristique face au texte hautement désordonné.
*   **Traitement Multilingue Avancé :** Étendre les ensembles de filtres anti-bruit (`FALSE_NAMES`, `SYSTEM_EMAIL_PREFIXES`) à d'autres langues d'Europe (allemand, espagnol, italien) pour maintenir un niveau de filtrage équivalent sur les documents multilingues.
*   **Mise en cache des requêtes Gemini :** Mettre en œuvre un cache Redis ou un stockage local en mémoire pour les blocs de contexte identiques déjà soumis à l'IA afin de réduire la latence à zéro lors d'analyses répétitives.

---

## 7. Graphe des Appels de Fonctions (Call-Graph)

Voici le chaînage d'exécution des fonctions lors d'une extraction complète :

```
[Route Handler: POST /api/extract]
  │
  ├──► [cleanText] ──► Normalisation et protection des brackets d'e-mails
  │
  ├──► [parseTextHeuristically]
  │     │
  │     ├──► [performBaseExtraction]
  │     │     │
  │     │     ├──► [isLikelyNoise] ──► Filtrage des lignes de bruit
  │     │     ├──► [extractNameFromEmailPrefix] ──► Fallback de nom
  │     │     └──► [computeConfidence] ──► Calcul du score (0-100)
  │     │
  │     └──► [runAutoValidationRound] (Boucle max 3 passes)
  │           │
  │           ├──► [verifyNameQuality] ──► Évaluation qualité du nom
  │           ├──► [cleanName] ──► Formatage final (Cas & Tirets)
  │           └──► [computeConfidence] ──► Recalcul du score corrigé
  │
  ├──► [refineContactsWithAI] (Optionnel)
  │     │
  │     ├──► [getAiClient] ──► Initialisation lazy du SDK Gemini
  │     └──► [cleanName] ──► Formatage des noms corrigés par l'IA
  │
  └──► [analyzeFileContent] ──► Statistiques globales de lecture pour l'UI
```

---
*Ce rapport technique constitue la documentation de référence de la Release Candidate. Le code est entièrement typé, exempt de régressions critiques, et prêt pour l'intégration en production.*
