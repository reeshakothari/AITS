import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Pages render on request so content published from the admin goes live immediately.
export default defineConfig({
  site: 'https://aits.services',
  trailingSlash: 'always',
  output: 'server',
  adapter: vercel(),
  // The dev toolbar would sit on top of the inline editor's own toolbar.
  devToolbar: { enabled: false },
});
