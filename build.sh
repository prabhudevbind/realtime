#!/bin/bash

echo "Building Real-time Call App..."

# Install backend dependencies
echo "Installing backend dependencies..."
npm install

# Install and build frontend
echo "Installing and building frontend..."
cd client/vite-project
npm install
npm run build
cd ../..

echo "Build complete! Run 'npm start' to start the server."
echo "The app will be available at http://localhost:5000"
