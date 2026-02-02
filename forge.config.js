module.exports = {
  packagerConfig: {
    asar: true,
    icon: './build/icon', // Will use icon.icns on Mac, icon.ico on Windows
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  electronLaunchArgs: [
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-hardware-acceleration',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--in-process-gpu'
  ],
};