const fs = require('fs');
const path = require('path');

class DistManager {
    static DIST_PATH = path.resolve(__dirname, 'dist');

    static ensureDistDirectory() {
        if (!fs.existsSync(DistManager.DIST_PATH)) {
            fs.mkdirSync(DistManager.DIST_PATH);
            console.log('Created dist directory');
        } else {
            console.log('Dist directory already exists');
        }
    }
}

const distPath = path.resolve(__dirname, 'dist');

if (!fs.existsSync(distPath)) {
  fs.mkdirSync(distPath);
  console.log('Created dist directory');
} else {
  console.log('Dist directory already exists');
}

DistManager.ensureDistDirectory();
