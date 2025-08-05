#!/bin/bash

# Script de déploiement Yjs Pulsar Demo sur Clever Cloud
set -e

echo "🚀 Deploying Yjs Pulsar Demo to Clever Cloud..."

# Vérifier si clever-tools est installé
if ! command -v clever &> /dev/null; then
    echo "❌ clever-tools not found. Installing..."
    npm install -g clever-tools
fi

# Vérifier la connexion
echo "🔍 Checking Clever Cloud login..."
clever profile

# Nom de l'application
APP_NAME="yjs-pulsar-demo"

# Créer l'application Node.js
echo "📦 Creating Clever Cloud application..."
clever create "$APP_NAME" --type node

# Ajouter l'add-on Pulsar
echo "📡 Adding Pulsar add-on..."
clever addon create pulsar-addon addon-pulsar

# Lier l'add-on à l'application
echo "🔗 Linking Pulsar add-on..."
clever addon link pulsar-addon

# Configurer les variables d'environnement
echo "⚙️  Setting environment variables..."
clever env set NODE_ENV production
clever env set PULSAR_TOPIC_PREFIX yjs-demo-
clever env set STORAGE_TYPE none

# Déployer
echo "🚢 Deploying application..."
clever deploy

echo "✅ Deployment complete!"
echo ""
echo "📱 Your demo is available at:"
clever open
echo ""
echo "🔧 To check logs:"
echo "clever logs"
echo ""
echo "📊 To check application status:"
echo "clever status"