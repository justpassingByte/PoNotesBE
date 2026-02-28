import { z } from 'zod';

export const bulkImportSchema = z.array(z.object({
    name: z.string().min(1, 'Name is required'),
    platform_id: z.string().uuid('Invalid platform ID'),
    playstyle: z.string().optional().default('UNKNOWN'),
    notes: z.array(z.object({
        street: z.string().refine(
            (val) => ['Preflop', 'Postflop', 'Flop', 'Turn', 'River'].includes(val),
            { message: "Street must be Preflop, Postflop, Flop, Turn, or River" }
        ).optional().default('Preflop'),
        note_type: z.string().optional().default('Custom'),
        content: z.string().min(1, 'Note content cannot be empty')
    })).optional().default([])
}));

export const createPlayerSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    platform_id: z.string().uuid('Invalid platform ID'),
    playstyle: z.string().optional().default('UNKNOWN'),
});

export const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
    cursor: z.string().uuid('Invalid cursor ID').optional(),
});
