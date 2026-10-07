import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://aits.services',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
