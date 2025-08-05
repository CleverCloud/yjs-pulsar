// tests/resolver.js

// This custom resolver is needed to map the .js extension in import paths
// to the corresponding .ts source files. This is necessary because the project
// is configured to output ESM-compatible JavaScript with .js extensions, but
// Jest runs on the TypeScript source code.

const fs = require('fs');
const path = require('path');

module.exports = (request, options) => {
  const { defaultResolver } = options;

  // If the request ends with .js, try to resolve it to a .ts or .tsx file
  if (request.endsWith('.js')) {
    const tsPath = request.slice(0, -3) + '.ts';
    try {
      // Check if the .ts file exists relative to the basedir
      const resolvedPath = path.resolve(options.basedir, tsPath);
      if (fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
    } catch (e) {
      // Fallback to default resolver if path resolution fails
    }
  }

  // For all other requests, use the default resolver
  return defaultResolver(request, options);
};
