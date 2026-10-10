# 🚀 WhatsApp Sender Pro & Lead Engine (Full Project)

Moteur complet d'envoi et d'automatisation WhatsApp, couplé à un extracteur multi-moteurs de contacts (Email, Téléphones Tunisie/International, Fiches Google Maps / Scraping, Base SQLite et Centre d'Affaires).

---

## 🌟 Fonctionnalités Principales

1. **WhatsApp Sender Engine (`whatsapp-web.js` + Chromium / Puppeteer)** :
   - Connexion par **QR Code** et persistance de session (`LocalAuth`).
   - Algorithme de temporisation **Anti-Ban** (délais adaptatifs, pauses, variations de typage humain).
   - Moteur **Spintax** multi-niveaux (ex: `{Bonjour|Salut} {Docteur|Chère équipe}`).
   - Gestion automatique des **Désabonnements / Opt-Out** (mots-clés `STOP`, `DÉSACTIVER`, etc.) avec mise en liste noire immédiate.
   - Suivi des accusés de réception temps réel : `sent`, `delivered`, `read`, `held_undelivered`.
   - Arrêt d'urgence (*Kill-Switch*) et contrôle de quota journalier.

2. **Moteurs d'Extraction & Centre d'Affaires** :
   - **Extracteur E-mails & Noms** avec scoring de confiance et nettoyage automatique.
   - **Extracteur WhatsApp / Tunisie** avec détection d'opérateurs (Ooredoo, Orange, Tunisie Telecom).
   - **Scraper / Importateur B2B** (Fiches professionnelles, coordonnées).
   - **Base de Données Locale SQLite** (persistance des contacts, jobs, campagnes et logs).

---

## 📦 Installation et Démarrage

### Prérequis
- **Node.js** >= 18 ou 20
- **npm** ou **bun**

### 1. Cloner ou Décompresser le projet
```bash
unzip whatsapp-sender-project.zip -d whatsapp-sender
cd whatsapp-sender
```

### 2. Installer les dépendances
```bash
npm install
```

### 3. Configurer l'environnement (Optionnel)
Créez un fichier `.env` si vous souhaitez utiliser l'enrichissement IA avec Google Gemini :
```env
GEMINI_API_KEY=votre_cle_api_ici
PORT=3000
```

### 4. Lancer l'application en mode Développement
```bash
npm run dev
```
L'application démarre sur `http://localhost:3000` (Backend Express + Frontend Vite avec HMR).

### 5. Compiler et Lancer en Production
```bash
npm run build
npm start
```

---

## 📂 Structure du Projet

```text
├── server.ts                       # Point d'entrée principal serveur Express
├── server/
│   ├── sender/
│   │   ├── whatsappSenderEngine.ts # Cœur du moteur WhatsApp (whatsapp-web.js)
│   │   └── spintaxEngine.ts        # Moteur Spintax & détection Opt-out
│   ├── database/
│   │   ├── senderDb.ts             # SQLite pour les jobs, sessions, blacklist
│   │   └── leadDb.ts               # SQLite pour les leads et contacts
│   ├── routes/
│   │   ├── senderRoutes.ts         # Routes API WhatsApp Sender
│   │   ├── leadRoutes.ts           # Routes API Leads & Campagnes
│   │   └── businessCenterRoutes.ts # Routes Centre d'Affaires
│   ├── extractor.ts                # Algorithme d'extraction E-mails
│   └── whatsappExtractor.ts        # Algorithme d'extraction Téléphones & Opérateurs
├── src/
│   ├── components/
│   │   ├── sender/                 # Interface graphique WhatsApp Sender
│   │   ├── business-center/        # Interface Centre d'Affaires
│   │   └── lead-extractor/         # Interface Extracteur
│   ├── types/                      # Définitions TypeScript
│   └── App.tsx                     # Application React principale
├── data/                           # Fichiers SQLite et stockage de session
└── package.json
```

---

## 📥 Téléchargement Direct du Projet ZIP
Vous pouvez également générer ou télécharger le fichier zip complet à tout moment via l'endpoint :
`GET /api/download-project-zip`
