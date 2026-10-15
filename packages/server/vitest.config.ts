import { mergeConfig } from 'vitest/config';

import { definePackageConfig } from '../../config/vitest.package.ts';

export default mergeConfig(definePackageConfig(import.meta.dirname), {
    test: {
        // Database tests share one database: their files run one after the other.
        fileParallelism: false,
    },
});
