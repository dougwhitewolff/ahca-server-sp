const os = require('os');
const path = require('path');

const platform = os.platform();
const arch = os.arch();

function getFolderName(platform, arch) {
  return `${platform}-${arch}`;
}

const folderName = getFolderName(platform, arch);
const binaryDir = path.join(__dirname, 'bin', folderName);

// 3. If necessary, set the library path (macOS, Linux). This is optional 
//    if your .node files are compiled with an rpath or if your system can 
//    already locate the .so/.dylib in the same folder.
// macOS:
if (platform === 'darwin') {
  process.env.DYLD_LIBRARY_PATH = binaryDir +
    (process.env.DYLD_LIBRARY_PATH ? `:${process.env.DYLD_LIBRARY_PATH}` : '');
}
// Linux:
if (platform === 'linux') {
  process.env.LD_LIBRARY_PATH = binaryDir +
    (process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : '');
}

// 4. Load the .node addon
const addonPath = path.join(binaryDir, 'krisp_audio.node');
const krispAudio = require(addonPath);

module.exports = krispAudio;