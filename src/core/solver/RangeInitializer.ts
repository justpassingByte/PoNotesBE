/**
 * RangeInitializer — Root Node Range Factory
 *
 * Bootstraps the root RangeState from spot template and stack depth.
 * Delegates to PreflopRangeTemplates.
 */

import { PreflopRangeTemplates } from './PreflopRangeTemplates';
import { RangeState } from './RangeState';
import type { SpotTemplateBucket, StackDepthBucket } from './types';

export class RangeInitializer {
    /**
     * Initialize a root RangeState for solver tree traversal.
     */
    static init(spot: SpotTemplateBucket, stack: StackDepthBucket): RangeState {
        return PreflopRangeTemplates.getTemplate(spot, stack);
    }
}
