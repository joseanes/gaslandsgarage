
import type { ServerResponse } from 'node:http';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

/** sirv's mime map has no .ico, so it sends an empty Content-Type and Chrome drops the icon. */
function iconContentTypes(): Plugin {
  const types: Record<string, string> = {
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json'
  };
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    const type = Object.entries(types).find(([ext]) => path.endsWith(ext))?.[1];
    if (type) forceContentType(res, type);
    next();
  };
  return {
    name: 'icon-content-types',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
}

function forceContentType(res: ServerResponse, type: string) {
  const writeHead = res.writeHead.bind(res);
  res.writeHead = ((statusCode: number, statusMessage?: unknown, headers?: unknown) => {
    if (typeof statusMessage === 'object' && statusMessage) {
      (statusMessage as Record<string, unknown>)['Content-Type'] = type;
    } else if (typeof headers === 'object' && headers) {
      (headers as Record<string, unknown>)['Content-Type'] = type;
    } else {
      res.setHeader('Content-Type', type);
    }
    return writeHead(statusCode, statusMessage as never, headers as never);
  }) as ServerResponse['writeHead'];
}

export default defineConfig({
  plugins: [iconContentTypes(), sveltekit()],
  ssr: {
    // List of dependencies to exclude from SSR processing
    noExternal: ['firebase', 'firebase/app', 'firebase/auth', 'firebase/firestore']
  },
  optimizeDeps: {
    include: ['firebase/app', 'firebase/auth', 'firebase/firestore']
  }
  // CSS processing is configured in postcss.config.js
});

