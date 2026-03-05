import { PotType, PositionalAdvantage, SpotTemplateBucket } from './types';
import { potTypeSchema, positionalAdvantageSchema } from '../../../validators/context.schema';

/**
 * Phase 4.2: Spot Abstraction - Spot Template
 * 
 * Deterministically concatenates the pre-normalized Pot Type and Relative Position.
 * This explicitly avoids resolving absolute seats (e.g. BTN vs BB) to prevent
 * architectural leaks regarding table size formats (Heads-Up vs 6-max).
 */
export class SpotTemplateParser {

    /**
     * Builds the Spot Template Bucket. No AI allowed.
     */
    public static categorize(potType: PotType, heroRelativePosition: PositionalAdvantage): SpotTemplateBucket {

        // Strict runtime validation of inputs to ensure string safety before concatenating
        const potResult = potTypeSchema.safeParse(potType);
        const posResult = positionalAdvantageSchema.safeParse(heroRelativePosition);

        if (!potResult.success || !posResult.success) {
            return "UNKNOWN";
        }

        // Direct, rigid string concatenation forming the strict SpotTemplateBucket enum
        return `${potResult.data}_${posResult.data}` as SpotTemplateBucket;
    }
}
