#!/usr/bin/env node

const { spawn } = require('child_process');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

console.log('Starting frontend watch-and-build...');

// Paths
const srcPath = path.join(__dirname, 'src');
const outPath = path.join(__dirname, 'out');
const railsPublicPath = path.join(__dirname, '../../apps/web/public/ui/envelopes');

// Debounce timer
let buildTimeout;
let isBuilding = false;

// Build function
function build() {
  if (isBuilding) {
    console.log('Build already in progress, queuing another build...');
    clearTimeout(buildTimeout);
    buildTimeout = setTimeout(build, 1000);
    return;
  }

  isBuilding = true;
  console.log('\n🔨 Building frontend...');
  
  const buildProcess = spawn('npm', ['run', 'build'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  buildProcess.on('close', (code) => {
    if (code === 0) {
      console.log('✅ Build successful, copying files to Rails...');
      
      // Remove old files
      try {
        if (fs.existsSync(railsPublicPath)) {
          fs.rmSync(railsPublicPath, { recursive: true, force: true });
        }
        fs.mkdirSync(railsPublicPath, { recursive: true });
        
        // Copy new files
        const copyProcess = spawn('cp', ['-r', `${outPath}/.`, railsPublicPath], {
          stdio: 'inherit',
          shell: true
        });
        
        copyProcess.on('close', (copyCode) => {
          if (copyCode === 0) {
            console.log('✅ Files copied to Rails public folder');
            console.log(`📁 Static files available at: http://localhost:3000/ui/envelopes`);
          } else {
            console.error('❌ Failed to copy files');
          }
          isBuilding = false;
        });
      } catch (error) {
        console.error('❌ Error copying files:', error);
        isBuilding = false;
      }
    } else {
      console.error('❌ Build failed');
      isBuilding = false;
    }
  });
}

// Initial build
build();

// Watch for changes
const watcher = chokidar.watch(srcPath, {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true
});

watcher
  .on('add', path => {
    console.log(`File ${path} has been added`);
    clearTimeout(buildTimeout);
    buildTimeout = setTimeout(build, 1000);
  })
  .on('change', path => {
    console.log(`File ${path} has been changed`);
    clearTimeout(buildTimeout);
    buildTimeout = setTimeout(build, 1000);
  })
  .on('unlink', path => {
    console.log(`File ${path} has been removed`);
    clearTimeout(buildTimeout);
    buildTimeout = setTimeout(build, 1000);
  });

console.log(`👀 Watching for changes in ${srcPath}...`);
console.log('Press Ctrl+C to stop');

// Handle exit
process.on('SIGINT', () => {
  console.log('\nStopping watch-and-build...');
  watcher.close();
  process.exit(0);
});