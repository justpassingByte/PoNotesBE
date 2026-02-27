import { z } from 'zod';

export const createTemplateSchema = z.object({
    label: z.string().min(1, 'Label is required').max(100),
    category: z.string().min(1, 'Category is required').max(50),
    weight: z.number().int().default(0)
});

export const updateTemplateSchema = createTemplateSchema.extend({
    // Make all fields optional for updates
    label: z.string().min(1, 'Label cannot be empty').max(100).optional(),
    category: z.string().min(1, 'Category cannot be empty').max(50).optional(),
    weight: z.number().int().optional()
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
