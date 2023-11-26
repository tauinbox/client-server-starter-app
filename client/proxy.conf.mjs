export default [
  {
    context: ['/api'],
    target: process.env.BACKEND_URL || 'http://localhost:3000',
    secure: false,
    changeOrigin: true,
    logLevel: "debug"
  },
  {
    context: ['/ws'],
    target: process.env.BACKEND_URL || 'http://localhost:3000',
    secure: false,
    ws: true,
  },
];
