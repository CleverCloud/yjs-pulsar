# GitHub Actions CI/CD

Ce projet utilise GitHub Actions pour automatiser les tests et la validation.

## Workflows

### `ci.yml` - Pipeline Principal

Le workflow se déclenche sur :
- Push vers `main` ou `develop`
- Pull requests vers `main`

#### Jobs

1. **test** - Tests Unitaires
   - Matrice Node.js 18.x et 20.x
   - Vérification TypeScript
   - Tests unitaires (mocké)
   - Tests E2E basiques (simple.spec.ts)

2. **test-with-pulsar** - Tests E2E Complets
   - Uniquement sur push vers `main`
   - Tests avec vrai Pulsar (nécessite secrets)
   - Variables d'environnement sécurisées

3. **build-demo** - Build de la Demo
   - Compilation de la demo Vite
   - Upload des artifacts (7 jours)

4. **security** - Audit de Sécurité
   - `npm audit` pour vulnérabilités
   - Niveau de sévérité modéré

## Configuration des Secrets

Dans les paramètres GitHub, configurez ces secrets :

```
ADDON_PULSAR_BINARY_URL=pulsar+ssl://your-pulsar-url:6651
ADDON_PULSAR_TOKEN=your-pulsar-token
ADDON_PULSAR_TENANT=your-tenant
ADDON_PULSAR_NAMESPACE=your-namespace
```

## Tests Automatiques vs Manuels

- **Tests unitaires** : Toujours exécutés (fast, mocked)
- **Tests E2E basiques** : Toujours exécutés (mock)
- **Tests E2E Pulsar** : Seulement sur main (real Pulsar)
- **Tests manuels** : Disponibles localement (`TESTING.md`)

## Statut des Tests

Grâce aux corrections apportées :

✅ **Plus de tests qui hangent** - Tous se terminent correctement
✅ **Timeouts appropriés** - 5-10 secondes max
✅ **Cleanup correct** - Resources libérées
✅ **Tests parallèles** - Matrice Node.js versions

## Artifacts

- **demo-build** : Fichiers compilés de la demo (7 jours)
- **test-results** : Rapports de tests (si ajoutés)