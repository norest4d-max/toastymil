const { createProxyMiddleware } = require('http-proxy-middleware');

// CRA will load this in development only.
// This keeps browser requests same-origin (http://localhost:3000) while proxying to Ollama.
module.exports = function (app) {
  app.use(
    '/ollama',
    createProxyMiddleware({
      target: 'http://localhost:11434',
      changeOrigin: true,
      pathRewrite: {
        '^/ollama': '',
      },
    })
  );
};
