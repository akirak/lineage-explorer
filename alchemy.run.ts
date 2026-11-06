import * as Alchemy from 'alchemy';
import { localState } from 'alchemy/State';
import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Effect from 'effect/Effect';

export default Alchemy.Stack(
  'lineage-explorer',
  {
    providers: Cloudflare.providers(),
    // No R2/DO state backend or paid services. Keep .alchemy/state backed up
    // and use the same checkout/state for deploys and destroys.
    state: localState(),
  },
  Effect.gen(function* () {
    const site = yield* Cloudflare.Website.StaticSite('Website', {
      command: 'pnpm build:cloudflare',
      outdir: 'dist/client',
      // Always regenerate the snapshot, even if inputs live outside the repo.
      memo: false,
      assets: {
        notFoundHandling: 'single-page-application',
      },
      // Deliberately no main/script: all requests use the free asset layer,
      // including the database, WASM, worker scripts, and deep-link fallback.
    });
    return { url: site.url };
  }),
);
