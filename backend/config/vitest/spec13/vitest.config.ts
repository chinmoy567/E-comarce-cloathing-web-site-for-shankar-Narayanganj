import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * The spec 13 suite on its own — homepage-CMS visibility computation, product
 * resolution (incl. ON_SALE), content_config validation, atomic reorder/attach,
 * the public homepage endpoint, admin preview isolation, RBAC, and audit rows.
 *
 * Files listed explicitly rather than matched by a glob, like every other
 * per-slice config here.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    include: [
      'tests/spec-13-homepage-cms/visibility.unit.test.ts',
      'tests/spec-13-homepage-cms/homepage.campaignInteraction.test.ts',
      'tests/spec-13-homepage-cms/homepage.serverTimeOnly.test.ts',
      'tests/spec-13-homepage-cms/homepage.renderingOrder.test.ts',
      'tests/spec-13-homepage-cms/homepageSections.reorder.repository.test.ts',
      'tests/spec-13-homepage-cms/homepage.emptyCarouselOmitted.test.ts',
      'tests/spec-13-homepage-cms/productResolution.automaticRules.test.ts',
      'tests/spec-13-homepage-cms/productResolution.onSale.test.ts',
      'tests/spec-13-homepage-cms/productResolution.manualSelection.test.ts',
      'tests/spec-13-homepage-cms/contentConfig.validation.test.ts',
      'tests/spec-13-homepage-cms/homepageSections.sectionTypeImmutable.test.ts',
      'tests/spec-13-homepage-cms/homepageCms.urlValidation.test.ts',
      'tests/spec-13-homepage-cms/homepageCms.richTextSanitization.test.ts',
      'tests/spec-13-homepage-cms/homepageCms.visualThemeConstrained.test.ts',
      'tests/spec-13-homepage-cms/homepage.previewIsolation.test.ts',
      'tests/spec-13-homepage-cms/homepageCms.permissions.test.ts',
      'tests/spec-13-homepage-cms/homepage.noDuplicatedCatalogueData.test.ts',
      'tests/spec-13-homepage-cms/homepage.publicProjection.test.ts',
      'tests/spec-13-homepage-cms/homepage.imageFallback.test.ts',
      'tests/spec-13-homepage-cms/homepageCms.audit.test.ts',
      'tests/spec-13-homepage-cms/homepageImages.upload.test.ts',
      'tests/spec-13-homepage-cms/campaigns.crud.test.ts',
    ],
  },
});
