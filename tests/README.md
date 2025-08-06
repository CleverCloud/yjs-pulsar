# Tests Yjs-Pulsar

## Structure des tests

### Tests unitaires (`/tests/storage/`)
- `pulsar-storage.spec.ts` - Tests unitaires pour PulsarStorage avec mocks
- `snapshot-format.spec.ts` - Tests du format JSON des snapshots
- `s3-minio.spec.ts` - Tests d'intégration S3 avec MinIO
- `s3.spec.ts` - Tests unitaires S3 existants

### Tests E2E (`/tests/e2e/`)
- `snapshot-storage.spec.ts` - Tests de persistence avec snapshots
- `collaboration.spec.ts` - Tests de collaboration temps réel
- `basic-connection.spec.ts` - Tests de connexion WebSocket

### Tests CI (`/tests/`)
- `ci-smoke-test.spec.ts` - Tests basiques sans dépendances externes

## Exécution locale

### Tests unitaires (avec mocks)
```bash
npm test
```

### Tests spécifiques
```bash
# Tests du format snapshot
npx jest tests/storage/snapshot-format.spec.ts

# Tests smoke CI
npx jest tests/ci-smoke-test.spec.ts
```

### Tests avec MinIO local
```bash
# Démarrer MinIO
docker run -d -p 9000:9000 --name minio \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  minio/minio server /data

# Configurer les variables
export S3_ACCESS_KEY_ID=minioadmin
export S3_SECRET_ACCESS_KEY=minioadmin
export S3_ENDPOINT=http://localhost:9000
export S3_BUCKET=test-bucket

# Créer le bucket
mc alias set myminio http://localhost:9000 minioadmin minioadmin
mc mb myminio/test-bucket

# Exécuter les tests
npm test
```

## GitHub Actions

### Secrets requis
- `ADDON_PULSAR_BINARY_URL` - URL Pulsar
- `ADDON_PULSAR_TOKEN` - Token d'authentification Pulsar
- `ADDON_PULSAR_TENANT` - Tenant Pulsar
- `ADDON_PULSAR_NAMESPACE` - Namespace Pulsar

**Note**: Pas besoin de secrets S3 ! MinIO est utilisé automatiquement en CI.

### Workflows
1. **CI/CD Pipeline** (`.github/workflows/ci.yml`)
   - Tests unitaires sur toutes les PRs
   - Tests E2E avec Pulsar réel sur `main`
   - MinIO automatiquement configuré pour S3

2. **Test Snapshot** (`.github/workflows/test-snapshot.yml`)
   - Workflow dédié aux tests de snapshot
   - Peut être déclenché manuellement
   - Utilise MinIO comme service

## Variables d'environnement

### Pour les tests
- `NODE_ENV=test` - Mode test
- `STORAGE_TYPE=pulsar` - Active le mode hybride Pulsar+S3
- `SNAPSHOT_INTERVAL=30` - Nombre de messages entre snapshots
- `PULSAR_TOPIC_PREFIX=test-` - Préfixe des topics de test

### Pour MinIO (automatique en CI)
- `S3_ACCESS_KEY_ID=minioadmin`
- `S3_SECRET_ACCESS_KEY=minioadmin`
- `S3_ENDPOINT=http://localhost:9000`
- `S3_BUCKET=test-bucket`

## Mocks

Les tests unitaires utilisent :
- Mock de `pulsar-client` pour éviter les connexions réelles
- Mock de `S3Storage` pour les tests isolés
- MinIO pour les tests d'intégration S3

## Conseils

1. **Tests rapides** : Utilisez les mocks pour développer
2. **Tests complets** : MinIO + mocks Pulsar pour CI
3. **Tests E2E** : Nécessitent Pulsar réel (sur `main` uniquement)
4. **Debugging** : Les smoke tests aident à identifier les problèmes d'environnement