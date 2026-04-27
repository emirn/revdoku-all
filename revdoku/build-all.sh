echo "Building all applications and services..."
echo "========================================"
echo "Building shared packages..."
cd apps/shared/js-packages/revdoku-lib && npm run build && cd ../../../../

# Build backend services
echo "========================================="
echo "Building backend services..."
cd apps/services/revdoku-doc-api && npm run build && cd ../../..

# Build frontend application
echo "========================================="
echo "Building frontend application..."
cd apps/web && npm run build && cd ../..

