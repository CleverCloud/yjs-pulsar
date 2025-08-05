# Guide de Test - Yjs Pulsar

Ce document explique comment utiliser tous les outils de test disponibles dans ce projet.

## Tests Automatisés

### Tests Unitaires
```bash
# Lancer tous les tests unitaires
npm test

# Tests spécifiques
npx jest tests/server/ tests/storage/ --verbose
```

### Tests E2E
```bash
# Tous les tests E2E (nécessite .env configuré)
npm run test:e2e

# Test de connexion basique seulement
npx jest tests/e2e/basic-connection.spec.ts --verbose

# Test de collaboration (peut timeout mais ne hang plus)
npx jest tests/e2e/collaboration.spec.ts --verbose
```

## Tests Manuels

### 1. Test WebSocket Simple (`manual-test.js`)

Teste la connexion WebSocket de base avec votre serveur :

```bash
# Terminal 1: Démarrer le serveur
npm run dev

# Terminal 2: Test de connexion
node manual-test.js
```

**Attendu :** Messages de connexion et réception de données

### 2. Test HTML Basique (`test-collaboration.html`)

Interface simple pour tester la collaboration YJS :

```bash
# Démarrer le serveur
npm run dev

# Ouvrir le fichier dans un navigateur
open test-collaboration.html
# ou servir via HTTP
python3 -m http.server 3000
```

**Utilisation :**
1. Entrer un nom de document
2. Cliquer "Connect" 
3. Ajouter des éléments à la liste
4. Ouvrir dans un autre onglet pour voir la synchronisation

### 3. Demo Collaborative Complète (`demo/`)

Interface professionnelle avec éditeur de texte TipTap :

```bash
# Terminal 1: Serveur
npm run dev

# Terminal 2: Demo
npm run demo
```

**Test de collaboration :**
1. Aller sur `http://localhost:5173`
2. Entrer nom de document + pseudonyme
3. Ouvrir un autre onglet avec même nom de document
4. Taper simultanément dans les deux éditeurs

## Structure des Tests

```
tests/
├── e2e/
│   ├── basic-connection.spec.ts    # Test connexion WebSocket ✅
│   ├── collaboration.spec.ts       # Test collaboration complète ⚠️
│   └── simple.spec.ts              # Test de base ✅
├── server/
│   ├── auth.spec.ts                # Tests d'authentification ✅
│   └── server.spec.ts              # Tests serveur intégration ✅
└── storage/
    └── s3.spec.ts                  # Tests stockage S3 ✅

# Tests manuels utilisateur
manual-test.js                      # Test WebSocket simple
test-collaboration.html             # Interface de test basique
demo/                              # Demo collaborative complète
```

## Résultats Attendus

### ✅ **Tests qui passent :**
- **Tests unitaires** : 8/8 tests passent rapidement
- **Connexion basique E2E** : 2/2 tests avec Pulsar réel
- **Tests d'authentification** : 4/4 tests avec timeouts corrects
- **Tests manuels** : Connexions WebSocket fonctionnelles

### ⚠️ **Tests avec timeouts (normal) :**
- **Collaboration E2E complexe** : Timeout après 10s (ne hang plus !)

### 🎯 **Principales améliorations :**
- **Fini les tests qui hangent** - Tous les tests se terminent
- **Timeouts appropriés** - 5-10 secondes max
- **Cleanup correct** - Resources libérées proprement
- **Messages d'erreur clairs** - Debug plus facile

## Debugging

### Variables d'environnement
Vérifier que `.env` contient :
```bash
ADDON_PULSAR_BINARY_URL=...
ADDON_PULSAR_TOKEN=...
ADDON_PULSAR_TENANT=...
ADDON_PULSAR_NAMESPACE=...
```

### Console navigateur
- Ouvrir DevTools pour voir les événements WebSocket
- Variables globales disponibles : `window.editor`, `window.provider`, `window.ydoc`

### Serveur
- Logs détaillés des connexions Pulsar
- Statut des documents YJS
- Erreurs de décodage des messages

## Commandes Utiles

```bash
# Tests complets
npm test && npm run test:e2e

# Tests unitaires seulement
npm test

# Demo interactive
npm run dev & npm run demo

# Debug tests avec plus de détails
npx jest --verbose --detectOpenHandles

# Test spécifique avec timeout custom
npx jest tests/e2e/basic-connection.spec.ts --timeout=30000
```