import { z } from 'zod';

export const createNoteSchema = z.object({
    player_id: z.string().uuid('Invalid player ID'),
    street: z.string().refine(
        (val) => ['Preflop', 'Postflop', 'Flop', 'Turn', 'River'].includes(val),
        { message: "Street must be Preflop, Postflop, Flop, Turn, or River" }
    ),
    note_type: z.enum(['Template', 'Custom']),
    content: z.string().min(1, 'Note content cannot be empty'),
    source: z.enum(['template', 'custom']).default('custom'),
});

export const updateNoteSchema = z.object({
    street: z.string().refine(
        (val) => ['Preflop', 'Postflop', 'Flop', 'Turn', 'River'].includes(val),
        { message: "Street must be Preflop, Postflop, Flop, Turn, or River" }
    ).optional(),
    note_type: z.enum(['Template', 'Custom']).optional(),
    content: z.string().min(1).optional(),
    source: z.enum(['template', 'custom']).optional(),
});
