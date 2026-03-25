export default [
  {
    context: ['/api'],
    target: process.env.BACKEND_URL || 'http://localhost:3000',
    secure: false,
    changeOrigin: true,
    logLevel: "debug",
    // Prevent proxy from closing long-lived SSE connections
    proxyTimeout: 0,
    timeout: 0,
  },
  {
    context: ['/ws'],
    target: process.env.BACKEND_URL || 'http://localhost:3000',
    secure: false,
    ws: true,
  },
];
