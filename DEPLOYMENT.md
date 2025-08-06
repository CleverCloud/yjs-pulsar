# Deployment Guide - Clever Cloud

This guide explains how to deploy the Yjs Pulsar demo to Clever Cloud with a dedicated Pulsar add-on.

## 🚀 Quick Deploy

### Prerequisites

1. **Clever Cloud account** logged in
2. **clever-tools CLI** installed:
   ```bash
   npm install -g clever-tools
   clever login
   ```

### Automated Deployment

Run the deployment script:

```bash
./deploy-clever.sh
```

This script will:
- ✅ Create a Node.js application on Clever Cloud
- ✅ Add and configure a Pulsar add-on
- ✅ Set up environment variables
- ✅ Deploy the unified demo server

## 🔧 Manual Deployment

### Step 1: Create Application

```bash
# Create Node.js application
clever create yjs-pulsar-demo --type node

# Set up Git remote
clever link yjs-pulsar-demo
```

### Step 2: Add Pulsar Add-on

```bash
# Create Pulsar add-on
clever addon create pulsar-addon addon-pulsar

# Link to application
clever addon link pulsar-addon
```

### Step 3: Configure Environment

```bash
# Set environment variables
clever env set NODE_ENV production
clever env set PULSAR_TOPIC_PREFIX yjs-demo-
clever env set STORAGE_TYPE none
```

### Step 4: Deploy

```bash
# Build and deploy
npm run build
clever deploy
```

## 🏗️ Architecture

The deployed application includes:

- **Unified Server** (`src/server/production.ts`)
  - Serves static demo files
  - Handles WebSocket connections for Yjs
  - Single port for both HTTP and WebSocket

- **Demo Frontend** (built from `demo/`)
  - Collaborative text editor (TipTap)
  - Real-time cursors and awareness
  - Connection status indicators

- **Pulsar Integration**
  - Dedicated Pulsar add-on instance
  - Document synchronization via topics
  - Automatic topic creation per document

## 📁 Build Process

### Production Build
```bash
npm run build
```

This runs:
1. `build:demo` - Vite builds the frontend to `demo/dist/`
2. `build:server` - TypeScript compiles server to `dist/`

### Local Testing
```bash
# Test production build locally
npm run start:production
```

## 🌐 Usage

Once deployed:

1. **Open the demo URL** (provided after deployment)
2. **Enter a document name** and your nickname
3. **Share the URL** with others using the same document name
4. **Start typing** to see real-time collaboration!

## 📊 Monitoring

### Check Application Status
```bash
clever status
```

### View Logs
```bash
clever logs
```

### View Environment Variables
```bash
clever env
```

### Pulsar Add-on Info
```bash
clever addon info pulsar-addon
```

## 🔗 Environment Variables

The application automatically uses these Clever Cloud variables:

```bash
# Automatically set by Pulsar add-on
ADDON_PULSAR_BINARY_URL=pulsar+ssl://...
ADDON_PULSAR_TOKEN=...
ADDON_PULSAR_TENANT=...
ADDON_PULSAR_NAMESPACE=...

# Manually configured
NODE_ENV=production
PULSAR_TOPIC_PREFIX=yjs-demo-
STORAGE_TYPE=s3
S3_ENDPOINT=https://cellar-c2.services.clever-cloud.com
S3_BUCKET=yjs-test-bucket
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
PORT=8080  # Set by Clever Cloud
```

## 🛠️ Configuration Files

- `clevercloud/node.json` - Build and run configuration
- `clevercloud/environment.json` - Environment variables
- `vite.config.ts` - Frontend build configuration
- `tsconfig.json` - TypeScript compilation
- `deploy-clever.sh` - Automated deployment script

## 🚨 Troubleshooting

### Build Issues
```bash
# Clean and rebuild
rm -rf dist demo/dist node_modules
npm install
npm run build
```

### WebSocket Connection Issues
- Check that the Pulsar add-on is properly linked
- Verify environment variables are set
- Check application logs for connection errors

### Demo Not Loading
- Ensure `demo/dist/` exists after build
- Check that static files are being served correctly
- Verify the production server is serving from the right path

## 💡 Custom Domain

To use a custom domain:

```bash
clever domain add your-domain.com
```

Don't forget to configure your DNS to point to Clever Cloud!

## 🔐 Security

The demo includes:
- ✅ **No authentication** (public demo)
- ✅ **Document isolation** via unique topic names
- ✅ **Secure Pulsar connection** (TLS)
- ✅ **Environment-based configuration**

For production use, consider adding authentication strategies from the main codebase.