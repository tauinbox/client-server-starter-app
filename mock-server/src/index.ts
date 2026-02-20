import { createApp } from './app';

const app = createApp();
const port = process.env['MOCK_SERVER_PORT'] || 3000;

app.listen(port, () => {
  console.log(`Mock server running on http://localhost:${port}`);
  console.log(`Control API: http://localhost:${port}/__control/state`);
});

export default app;
